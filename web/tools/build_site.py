"""Builds the static website from web/ (for GitHub Pages or any static host).

    python web/tools/build_site.py [out_dir]     default: build/site

Copies the pages, scripts, manifest and icon; leaves out tests, tools, the dev
server and Godot's import files. index.html is a fragment (it's also published
as an artifact), so it gets the same <!doctype html> skeleton web/serve.py
serves it in, without the local-only dev flag.
"""
import pathlib
import shutil
import sys

WEB = pathlib.Path(__file__).resolve().parents[1]
SKIP_DIRS = {"tests", "tools", ".cert", "__pycache__"}
SKIP_FILES = {"serve.py", "README.md"}
HEAD = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
        'body{margin:0}[hidden]{display:none!important}</style>'
        '<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon.svg">'
        '<meta name="theme-color" content="#0e131a"></head><body>')


def build(out: pathlib.Path) -> list[str]:
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    copied = []
    for src in sorted(WEB.rglob("*")):
        rel = src.relative_to(WEB)
        if src.is_dir() or rel.parts[0] in SKIP_DIRS or rel.name in SKIP_FILES or src.suffix == ".import":
            continue
        dst = out / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if rel.as_posix() == "index.html":
            dst.write_text(HEAD + src.read_text(encoding="utf-8") + "</body></html>", encoding="utf-8")
        else:
            shutil.copy2(src, dst)
        copied.append(rel.as_posix())
    (out / ".nojekyll").write_text("")  # serve files as they are
    return copied


if __name__ == "__main__":
    target = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else WEB.parent / "build" / "site"
    files = build(target)
    print(f"built {len(files)} files into {target}")
