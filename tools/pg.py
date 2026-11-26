"""A tiny PostgreSQL client in plain Python, for applying the beacon
database's SQL to the Supabase project (no psql or drivers needed).

    python tools/pg.py supabase/migrations/0001_shared_map.sql   # run a file
    python tools/pg.py -c "select count(*) from public.grids"    # run a statement

Reads the connection from .env.supabase (SUPABASE_DB_URL, and
SUPABASE_DB_PASSWORD when the URL has none), which git ignores. It never
prints them. TLS is always verified against Supabase's root certificate
(supabase/prod-ca-2021.crt); there is no way to turn that off.

Speaks just enough of the protocol: TLS, SCRAM-SHA-256 sign-in, and simple
queries (several statements per file are fine; they run as one transaction
unless the file says otherwise).
"""
import base64
import hashlib
import hmac
import os
import pathlib
import socket
import ssl
import struct
import sys
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[1]
CA = ROOT / "supabase" / "prod-ca-2021.crt"


def load_env() -> dict:
    env = {}
    path = ROOT / ".env.supabase"
    if not path.exists():
        sys.exit("No .env.supabase (it holds the database address and password).")
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


class PgError(Exception):
    pass


class Conn:
    def __init__(self, url: str, password: str | None = None):
        u = urllib.parse.urlparse(url)
        self.user = urllib.parse.unquote(u.username or "postgres")
        self.password = urllib.parse.unquote(u.password) if u.password else password
        if not self.password:
            raise PgError("no database password")
        self.db = (u.path or "/postgres").lstrip("/") or "postgres"
        raw = socket.create_connection((u.hostname, u.port or 5432), timeout=30)
        raw.sendall(struct.pack("!ii", 8, 80877103))  # SSLRequest
        if raw.recv(1) != b"S":
            raise PgError("the server refused TLS")
        ctx = ssl.create_default_context(cafile=str(CA))
        ctx.check_hostname = True
        ctx.verify_mode = ssl.CERT_REQUIRED
        self.sock = ctx.wrap_socket(raw, server_hostname=u.hostname)
        self.buf = b""
        self._startup()

    # -------------------------------------------------------------- wire

    def _send(self, tag: bytes, body: bytes) -> None:
        self.sock.sendall(tag + struct.pack("!i", len(body) + 4) + body)

    def _read(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise PgError("connection closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _msg(self):
        tag = self._read(1)
        (length,) = struct.unpack("!i", self._read(4))
        return tag, self._read(length - 4)

    @staticmethod
    def _fields(body: bytes) -> dict:
        out = {}
        for part in body.split(b"\0"):
            if part:
                out[chr(part[0])] = part[1:].decode("utf-8", "replace")
        return out

    # -------------------------------------------------------------- sign-in

    def _startup(self) -> None:
        params = b"".join(k.encode() + b"\0" + v.encode() + b"\0" for k, v in
                          (("user", self.user), ("database", self.db), ("client_encoding", "UTF8"), ("application_name", "musicbeacon-tools")))
        body = struct.pack("!i", 196608) + params + b"\0"
        self.sock.sendall(struct.pack("!i", len(body) + 4) + body)
        nonce = base64.b64encode(os.urandom(18)).decode()
        first_bare = f"n=,r={nonce}"
        server_sig = None
        while True:
            tag, body = self._msg()
            if tag == b"R":
                (code,) = struct.unpack("!i", body[:4])
                if code == 0:
                    continue
                if code == 10:  # SASL: mechanisms
                    if b"SCRAM-SHA-256" not in body:
                        raise PgError("the server doesn't offer SCRAM-SHA-256")
                    data = ("n,," + first_bare).encode()
                    self._send(b"p", b"SCRAM-SHA-256\0" + struct.pack("!i", len(data)) + data)
                elif code == 11:  # server-first
                    sf = body[4:].decode()
                    attrs = dict(x.split("=", 1) for x in sf.split(","))
                    if not attrs["r"].startswith(nonce):
                        raise PgError("bad server nonce")
                    salted = hashlib.pbkdf2_hmac("sha256", self.password.encode(), base64.b64decode(attrs["s"]), int(attrs["i"]))
                    client_key = hmac.new(salted, b"Client Key", "sha256").digest()
                    stored = hashlib.sha256(client_key).digest()
                    final_bare = f"c=biws,r={attrs['r']}"
                    auth_msg = f"{first_bare},{sf},{final_bare}".encode()
                    sig = hmac.new(stored, auth_msg, "sha256").digest()
                    proof = bytes(a ^ b for a, b in zip(client_key, sig))
                    server_key = hmac.new(salted, b"Server Key", "sha256").digest()
                    server_sig = base64.b64encode(hmac.new(server_key, auth_msg, "sha256").digest()).decode()
                    self._send(b"p", f"{final_bare},p={base64.b64encode(proof).decode()}".encode())
                elif code == 12:  # server-final
                    if body[4:].decode() != f"v={server_sig}":
                        raise PgError("the server's signature didn't check out")
                else:
                    raise PgError(f"unsupported sign-in method {code}")
            elif tag == b"E":
                raise PgError(self._fields(body).get("M", "sign-in failed"))
            elif tag == b"Z":
                return

    # -------------------------------------------------------------- queries

    def query(self, sql: str) -> list:
        """Runs SQL (one or more statements). Returns [(command, columns, rows)] per statement."""
        self._send(b"Q", sql.encode("utf-8") + b"\0")
        results, cols, rows, err = [], [], [], None
        while True:
            tag, body = self._msg()
            if tag == b"T":
                (n,) = struct.unpack("!h", body[:2])
                cols, pos = [], 2
                for _ in range(n):
                    end = body.index(b"\0", pos)
                    cols.append(body[pos:end].decode())
                    pos = end + 1 + 18
                rows = []
            elif tag == b"D":
                (n,) = struct.unpack("!h", body[:2])
                pos, row = 2, []
                for _ in range(n):
                    (ln,) = struct.unpack("!i", body[pos:pos + 4])
                    pos += 4
                    if ln < 0:
                        row.append(None)
                    else:
                        row.append(body[pos:pos + ln].decode("utf-8", "replace"))
                        pos += ln
                rows.append(row)
            elif tag == b"C":
                results.append((body.rstrip(b"\0").decode(), cols, rows))
                cols, rows = [], []
            elif tag == b"E":
                f = self._fields(body)
                err = f"{f.get('M', 'error')}" + (f" ({f['D']})" if "D" in f else "") + (f" at character {f['P']}" if "P" in f else "")
            elif tag == b"N":
                f = self._fields(body)
                print("notice:", f.get("M", ""))
            elif tag == b"Z":
                if err:
                    raise PgError(err)
                return results

    def close(self) -> None:
        try:
            self._send(b"X", b"")
            self.sock.close()
        except OSError:
            pass


def connect() -> Conn:
    env = load_env()
    return Conn(env["SUPABASE_DB_URL"], env.get("SUPABASE_DB_PASSWORD"))


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    sql = argv[1] if argv[0] == "-c" else pathlib.Path(argv[0]).read_text(encoding="utf-8")
    conn = connect()
    try:
        for cmd, cols, rows in conn.query(sql):
            if cols:
                print(" | ".join(cols))
                for r in rows:
                    print(" | ".join("" if v is None else v for v in r))
            print(cmd)
    except PgError as e:
        print("error:", e, file=sys.stderr)
        return 1
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
