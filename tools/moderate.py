"""Reviewing reported beacons (beacon database, step 3).

A shared grid, planted song, map or song hides itself after reports from 3
different people. This lists what's hidden or reported, and restores or
deletes it. Uses the database connection in .env.supabase (tools/pg.py).

    python tools/moderate.py                     # hidden things, and anything reported
    python tools/moderate.py restore plants <id> # put it back (its reports are cleared)
    python tools/moderate.py delete plants <id>  # remove it for good
"""
import sys

from pg import PgError, connect

KINDS = ("grids", "plants", "maps", "songs")


def q(v: str) -> str:
    return "'" + v.replace("'", "''") + "'"


def main(argv: list[str]) -> int:
    conn = connect()
    try:
        if not argv:
            sql = """
              select r.target_kind, r.target_id, coalesce(g.status, p.status, m.status, s.status, 'gone') as status,
                     count(*) as reports, string_agg(distinct r.reason, ', ') as reasons, max(r.created_at)::date as last
              from public.reports r
              left join public.grids g on r.target_kind = 'grids' and g.id = r.target_id
              left join public.plants p on r.target_kind = 'plants' and p.id = r.target_id
              left join public.maps m on r.target_kind = 'maps' and m.id = r.target_id
              left join public.songs s on r.target_kind = 'songs' and s.id = r.target_id
              group by 1, 2, 3 order by 3 desc, 4 desc"""
            for _, cols, rows in conn.query(sql):
                if not rows:
                    print("Nothing reported.")
                for r in rows:
                    print(" | ".join(str(x) for x in r))
            return 0
        if len(argv) != 3 or argv[0] not in ("restore", "delete") or argv[1] not in KINDS:
            print(__doc__)
            return 2
        action, kind, target = argv
        if action == "restore":
            conn.query(f"begin; update public.{kind} set status = 'live' where id = {q(target)}; "
                       f"delete from public.reports where target_kind = {q(kind)} and target_id = {q(target)}; commit;")
        else:
            conn.query(f"begin; delete from public.{kind} where id = {q(target)}; "
                       f"delete from public.reports where target_kind = {q(kind)} and target_id = {q(target)}; commit;")
        print(f"{action}d {kind} {target}")
        return 0
    except PgError as e:
        print("error:", e, file=sys.stderr)
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
