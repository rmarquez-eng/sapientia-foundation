#!/usr/bin/env python3
"""Wrap page fragments in the shared shell. No deps. Run: python3 build.py

Each pages/<name>.html starts with 3 header lines:
    title: ...
    desc: ...
    nav: program        (which top-nav link is 'current'; blank for none)
then the <main> inner HTML. Output goes to <name>/index.html
(name 'home' -> ./index.html).
"""
import pathlib, re, html

ROOT = pathlib.Path(__file__).parent.parent
SITE = "https://sapientiafoundation.net"

NAV = [
    ("about",        "/about/",         "About"),
    ("programs",     "/programs/",      "Programs"),
    ("toolkit",      "/toolkit/",       "Toolkit"),
    ("transparency", "/transparency/",  "Transparency"),
    ("contact",      "/contact/",       "Contact"),
]

LOGO_SVG = ('<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="12" fill="#0A2540"/>'
    '<path d="M32 18c-6-4-14-4-18-2v28c4-2 12-2 18 2 6-4 14-4 18-2V16c-4-2-12-2-18 2z" fill="none" '
    'stroke="#B8955A" stroke-width="3" stroke-linejoin="round"/><path d="M32 18v28" stroke="#B8955A" stroke-width="3"/></svg>')

FAVICON = ("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>"
    "<rect width='64' height='64' rx='12' fill='%230A2540'/><path d='M32 18c-6-4-14-4-18-2v28c4-2 12-2 18 2 "
    "6-4 14-4 18-2V16c-4-2-12-2-18 2z' fill='none' stroke='%23B8955A' stroke-width='3' stroke-linejoin='round'/>"
    "<path d='M32 18v28' stroke='%23B8955A' stroke-width='3'/></svg>")

def nav_links(current):
    out = []
    for key, href, label in NAV:
        cur = ' aria-current="page"' if key == current else ''
        out.append(f'      <a href="{href}"{cur}>{label}</a>')
    out.append('      <a class="btn" href="/#support">Support the Work</a>')
    return "\n".join(out)

SHELL = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{canonical}">
<meta property="og:site_name" content="Sapientia Foundation">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:type" content="website">
<meta property="og:url" content="{canonical}">
<meta name="theme-color" content="#0b1220">
<link rel="icon" type="image/svg+xml" href="{favicon}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/style.css">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<nav id="nav">
  <div class="wrap nav-inner">
    <a class="logo" href="/">{logo} Sapientia Foundation</a>
    <div class="nav-links" id="nav-links">
{navlinks}
    </div>
    <button id="menu-btn" aria-label="Menu" aria-expanded="false">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button>
  </div>
</nav>
<main id="main">
{body}
</main>
<footer>
  <div class="wrap">
    <div class="f-grid">
      <div>
        <a class="logo" href="/">{logo} Sapientia Foundation</a>
        <p class="f-tag">Educating people to understand credit, debt, and money &mdash; and to build lasting economic stability.</p>
      </div>
      <div class="f-col">
        <div class="f-h">Explore</div>
        <a href="/about/">About</a>
        <a href="/governance/">Board &amp; Governance</a>
        <a href="/programs/">Programs</a>
        <a href="/toolkit/">Resources &amp; Toolkit</a>
        <a href="/transparency/">Transparency</a>
      </div>
      <div class="f-col">
        <div class="f-h">Contact</div>
        <a href="mailto:r.marquezjr2014@gmail.com">r.marquezjr2014@gmail.com</a>
        <a href="tel:+15714905426">(571) 490-5426</a>
        <a>PO Box 143, Woodbridge, VA 22194</a>
        <a href="/privacy/">Privacy Policy</a>
        <a href="/terms/">Terms &amp; Disclaimer</a>
      </div>
    </div>
    <div class="f-bottom">
      <div class="disclaimer">Sapientia Foundation, A Charitable Trust is an organization described in Section 501(c)(3) of the Internal Revenue Code (EIN 39-4961628), governed by a volunteer Board of Trustees and administered under the laws of Delaware from Woodbridge, Virginia. It charges no fees, sells no products, makes no loans, negotiates no debts on anyone's behalf, and pays or receives no commissions or referral fees. It is not a law firm, a credit counseling agency, or a credit repair organization. Nothing on this site is legal, financial, tax, or investment advice.</div>
      <div>&copy; 2026 Sapientia Foundation, A Charitable Trust</div>
    </div>
  </div>
</footer>
<script src="/assets/site.js" defer></script>
{extra_scripts}
</body>
</html>
"""

def build():
    for src in sorted((ROOT / ".build" / "src").glob("*.html")):
        if src.name.startswith("_"):
            continue
        raw = src.read_text()
        meta = {}
        lines = raw.splitlines()
        i = 0
        while i < len(lines) and re.match(r'^(title|desc|nav|scripts):', lines[i]):
            k, v = lines[i].split(":", 1)
            meta[k.strip()] = v.strip()
            i += 1
        body = "\n".join(lines[i:]).strip()
        name = src.stem
        out_dir = ROOT if name == "home" else ROOT / name
        out_dir.mkdir(exist_ok=True)
        canonical = f"{SITE}/" if name == "home" else f"{SITE}/{name}/"
        extra = "".join(
            f'<script src="{s.strip()}" defer></script>\n'
            for s in meta.get("scripts", "").split(",") if s.strip()
        )
        page = SHELL.format(
            title=html.escape(meta.get("title", "Sapientia Foundation")),
            desc=html.escape(meta.get("desc", "")),
            canonical=canonical, favicon=FAVICON, logo=LOGO_SVG,
            navlinks=nav_links(meta.get("nav", "")), body=body,
            extra_scripts=extra,
        )
        (out_dir / "index.html").write_text(page)
        print("wrote", (out_dir / "index.html").relative_to(ROOT))

if __name__ == "__main__":
    build()
