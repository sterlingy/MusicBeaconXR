"""Builds web/manual.html, the copy of the user manual the server hosts, so
nobody needs a Claude sign-in to read it.

The manual is written in Claude Docs. Save the doc's XML (a docs `read` of its
page node) to a file, then run:

    python web/tools/build-manual.py manual.xml

Headings, paragraphs, lists, tables, bold and code carry over. The byline's
name is left out; the doc's date becomes "Updated <date>".
"""

import html
import re
import sys
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "manual.html"


def inline(el):
    """Text runs of a paragraph or cell as HTML."""
    out = []
    for t in el:
        if t.tag == "text":
            s = html.escape(t.text or "")
            # Marks nest as child elements: <text><bold>x</bold></text>
            def mark(node):
                inner = html.escape(node.text or "") + "".join(mark(c) for c in node)
                tag = {"bold": "strong", "code": "code", "italic": "em"}.get(node.tag)
                return f"<{tag}>{inner}</{tag}>" if tag else inner
            s += "".join(mark(c) for c in t)
            out.append(s)
        elif t.tag == "date":
            out.append(html.escape(t.get("value", "")))
    return "".join(out)


def slug(text, used):
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "section"
    base, n = s, 2
    while s in used:
        s, n = f"{base}-{n}", n + 1
    used.add(s)
    return s


def block(el, toc, used):
    if el.tag == "paragraph":
        level = el.get("heading")
        if level:
            text = inline(el)
            if level == "1":
                return ""  # the page header carries the title
            sid = slug(re.sub("<[^>]+>", "", text), used)
            if level == "2":
                toc.append((sid, text))
            return f'<h{level} id="{sid}">{text}</h{level}>'
        if el.find("mention") is not None or el.find("date") is not None:
            return ""  # byline
        body = inline(el)
        return f"<p>{body}</p>" if body.strip() else ""
    if el.tag == "list":
        tag = "ol" if el.get("kind") == "ordered" else "ul"
        items = []
        for li in el.findall("listItem"):
            parts = [block(c, toc, used) for c in li]
            # A single paragraph inside an item needs no <p>.
            if len(parts) == 1 and parts[0].startswith("<p>"):
                parts = [parts[0][3:-4]]
            items.append("<li>" + "".join(parts) + "</li>")
        return f"<{tag}>" + "".join(items) + f"</{tag}>"
    if el.tag == "table":
        rows = []
        for row in el.findall("row"):
            cells = []
            for cell in row.findall("cell"):
                tag = "th" if cell.get("header") == "true" else "td"
                inner = " ".join(inline(p) for p in cell.findall("paragraph"))
                cells.append(f"<{tag}>{inner}</{tag}>")
            rows.append("<tr>" + "".join(cells) + "</tr>")
        head = rows[0] if 'th>' in rows[0] else ""
        body = rows[1:] if head else rows
        thead = f"<thead>{head}</thead>" if head else ""
        return f'<div class="tw"><table>{thead}<tbody>{"".join(body)}</tbody></table></div>'
    return ""


def main(src):
    root = ET.fromstring(Path(src).read_text(encoding="utf-8"))
    title = "Music Beacon XR User Manual"
    updated = ""
    for p in root.iter("paragraph"):
        if p.get("heading") == "1":
            title = inline(p)
        d = p.find("date")
        if d is not None and not updated:
            updated = date.fromisoformat(d.get("value")).strftime("%b %d, %Y").replace(" 0", " ")
    toc, used = [], set()
    body = "\n".join(b for b in (block(el, toc, used) for el in root) if b)
    nav = "".join(f'<a href="#{sid}">{text}</a>' for sid, text in toc)
    page = TEMPLATE.format(title=title, updated=html.escape(updated), nav=nav, body=body)
    OUT.write_text(page, encoding="utf-8")
    print(f"{OUT}: {len(page)} bytes, {len(toc)} sections")


TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root {{
  --bg: #0e131a; --panel: #151c25; --raise: #1c2531; --line: #2a3644;
  --fg: #e6ebf1; --muted: #8d9aab; --accent: #ffb547;
  --f-display: "Bricolage Grotesque", "Segoe UI", system-ui, sans-serif;
  --f-body: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
  --f-mono: "IBM Plex Mono", Consolas, ui-monospace, monospace;
  color-scheme: dark;
}}
@media (prefers-color-scheme: light) {{
  :root:not([data-theme="dark"]) {{
    --bg: #eef1f5; --panel: #ffffff; --raise: #f4f6f9; --line: #d5dce5; --fg: #17202b; --muted: #5b6878;
    --accent: #c46f00; color-scheme: light;
  }}
}}
:root[data-theme="light"] {{
  --bg: #eef1f5; --panel: #ffffff; --raise: #f4f6f9; --line: #d5dce5; --fg: #17202b; --muted: #5b6878;
  --accent: #c46f00; color-scheme: light;
}}
* {{ box-sizing: border-box; }}
body {{
  margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 var(--f-body);
  padding: 0 max(16px, env(safe-area-inset-right, 0px)) 64px max(16px, env(safe-area-inset-left, 0px));
}}
.wrap {{ max-width: 860px; margin: 0 auto; }}
header {{ padding: 28px 0 8px; border-bottom: 1px solid var(--line); }}
header .back {{ font-size: 14px; color: var(--muted); text-decoration: none; }}
header .back:hover {{ color: var(--accent); }}
h1 {{ font: 800 clamp(28px, 6vw, 40px)/1.1 var(--f-display); margin: 10px 0 4px; letter-spacing: -0.01em; }}
.updated {{ color: var(--muted); font-size: 14px; margin: 0 0 14px; }}
nav {{ display: flex; flex-wrap: wrap; gap: 6px; padding: 14px 0; }}
nav a {{
  font-size: 13px; color: var(--fg); text-decoration: none; background: var(--raise);
  border: 1px solid var(--line); border-radius: 999px; padding: 3px 11px;
}}
nav a:hover {{ border-color: var(--accent); color: var(--accent); }}
h2 {{ font: 700 24px/1.2 var(--f-display); margin: 40px 0 10px; scroll-margin-top: 16px; }}
h3 {{ font: 600 18px/1.3 var(--f-display); margin: 26px 0 8px; }}
p, li {{ max-width: 70ch; }}
strong {{ font-weight: 600; }}
code {{ font: 14px var(--f-mono); background: var(--raise); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; }}
ol, ul {{ padding-left: 1.4em; }}
li {{ margin: 4px 0; }}
.tw {{ overflow-x: auto; margin: 12px 0 18px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }}
table {{ border-collapse: collapse; width: 100%; font-size: 14px; }}
th, td {{ text-align: left; vertical-align: top; padding: 8px 12px; border-bottom: 1px solid var(--line); }}
th {{ background: var(--raise); font-weight: 600; white-space: nowrap; }}
tr:last-child td {{ border-bottom: 0; }}
td:first-child {{ font-weight: 500; }}
a {{ color: var(--accent); }}
</style>
</head>
<body>
<div class="wrap">
<header>
<a class="back" href="./">← Back to Music Beacon XR</a>
<h1>{title}</h1>
<p class="updated">Updated {updated}</p>
</header>
<nav aria-label="Sections">{nav}</nav>
<main>
{body}
</main>
</div>
</body>
</html>
"""

if __name__ == "__main__":
    main(sys.argv[1])
