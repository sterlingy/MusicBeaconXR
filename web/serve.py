"""Local server for Chord Master XR.

    python web/serve.py [port]            http://127.0.0.1:8765, this PC only
    python web/serve.py --https [port]    https on every network address (default 8443),
                                          so a phone on the same Wi-Fi can use GPS

Browsers only give location to secure pages: localhost, or HTTPS. A phone
can't reach this PC's localhost, so --https serves the page over HTTPS with a
self-signed certificate made on first run (web/.cert/, kept out of git). The
phone shows a certificate warning once; accept it to open the page.

Wraps index.html in the same <!doctype html> skeleton the published artifact gets.
"""
import http.server
import json
import pathlib
import shutil
import socket
import ssl
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent
CERT_DIR = ROOT / ".cert"
HEAD = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
        'body{margin:0}[hidden]{display:none!important}</style>'
        '<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon.svg">'
        '<meta name="theme-color" content="#0e131a">'
        '<script>window.BEACON_DEV_LOG=true</script></head><body>')


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
                      ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8",
                      ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path.split("?")[0] in ("/", "/index.html"):
            body = (HEAD + (ROOT / "index.html").read_text(encoding="utf-8") + "</body></html>").encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.split("?")[0] in ("/ar.html", "/play.html"):
            # A full page already; just switch on the dev handle like the main page.
            html = (ROOT / self.path.split("?")[0].lstrip("/")).read_text(encoding="utf-8")
            body = html.replace("<head>", "<head><script>window.BEACON_DEV_LOG=true</script>", 1).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        # Location diagnostics from the page (see devLog in src/app.js), printed here.
        if self.path != "/__log":
            self.send_error(404)
            return
        n = min(int(self.headers.get("Content-Length") or 0), 4096)
        raw = self.rfile.read(n).decode("utf-8", "replace")
        try:
            msg = json.dumps(json.loads(raw), ensure_ascii=False)
        except ValueError:
            msg = repr(raw)
        print(f"[page {self.client_address[0]}] {msg}", flush=True)
        self.send_response(204)
        self.end_headers()

    def translate_path(self, path):
        # Never serve the certificate's private key, however the path is spelled.
        p = pathlib.Path(super().translate_path(path)).resolve()
        if p == CERT_DIR or CERT_DIR in p.parents:
            return str(ROOT / "__not_found__")
        return str(p)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def local_ips():
    ips = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    try:  # the address used for outgoing traffic (no packet is sent)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith(("127.", "169.254.")))


def find_openssl():
    found = shutil.which("openssl")
    if found:
        return found
    for p in (r"C:\Program Files\Git\usr\bin\openssl.exe", r"C:\Program Files\Git\mingw64\bin\openssl.exe"):
        if pathlib.Path(p).exists():
            return p
    sys.exit("--https needs openssl (it comes with Git for Windows).")


def ensure_cert(ips):
    """A self-signed certificate for localhost and this PC's addresses. Remade when the addresses change."""
    CERT_DIR.mkdir(exist_ok=True)
    cert, key, names = CERT_DIR / "cert.pem", CERT_DIR / "key.pem", CERT_DIR / "names.txt"
    san = ",".join(["DNS:localhost", "IP:127.0.0.1"] + [f"IP:{ip}" for ip in ips])
    if cert.exists() and key.exists() and names.exists() and names.read_text() == san:
        return cert, key
    subprocess.run([find_openssl(), "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "825",
                    "-keyout", str(key), "-out", str(cert), "-subj", "/CN=Chord Master XR (local)",
                    "-addext", f"subjectAltName={san}"], check=True, capture_output=True)
    names.write_text(san)
    return cert, key


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    https = "--https" in sys.argv
    port = int(args[0]) if args else (8443 if https else 8765)
    if not https:
        print(f"Chord Master XR on http://127.0.0.1:{port}")
        http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
    ips = local_ips()
    cert, key = ensure_cert(ips)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert, key)

    class TLSServer(http.server.ThreadingHTTPServer):
        # Handshake per connection, so a device that connects but rejects the
        # certificate shows up in the console instead of failing silently.
        def get_request(self):
            sock, addr = self.socket.accept()
            sock.settimeout(15)
            try:
                tls = ctx.wrap_socket(sock, server_side=True)
            except (ssl.SSLError, OSError) as e:
                print(f"[tls {addr[0]}] handshake failed: {e}", flush=True)
                sock.close()
                raise
            tls.settimeout(None)
            return tls, addr

    server = TLSServer(("0.0.0.0", port), Handler)
    print("Chord Master XR over HTTPS. Open one of these on your phone (same network),")
    print("accept the certificate warning once, then choose Local grid:")
    for ip in ips:
        print(f"  https://{ip}:{port}")
    print(f"  https://localhost:{port}  (this PC)")
    server.serve_forever()
