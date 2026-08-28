#!/usr/bin/env python3
"""Smallest check that fails if the build or the Functions break.
Run: python3 .build/test_build.py   (or: npm test)"""
import pathlib, subprocess, sys, shutil

ROOT = pathlib.Path(__file__).parent.parent
subprocess.run([sys.executable, str(ROOT / ".build" / "build.py")], check=True)

PAGES = ["index.html", "about/index.html", "governance/index.html",
         "programs/index.html", "who-we-serve/index.html", "workshops/index.html",
         "partners/index.html", "toolkit/index.html", "transparency/index.html",
         "contact/index.html", "privacy/index.html", "terms/index.html"]

for rel in PAGES:
    html = (ROOT / rel).read_text()
    assert "<title>" in html and "</title>" in html, f"{rel}: missing title"
    assert 'id="nav"' in html, f"{rel}: shared nav missing"
    assert "<footer>" in html, f"{rel}: shared footer missing"
    assert "Sapientia Foundation" in html, f"{rel}: org name missing"
    assert "39-4961628" not in html, f"{rel}: EIN must not appear on the site"
    # things that must never appear on the site
    low = html.lower()
    for banned in ["boost your score", "results guaranteed", "guaranteed results",
                   "we will contact the bureau", "we contact the bureaus", "packages start at",
                   "before and after score"]:
        assert banned not in low, f"{rel}: contains banned phrase {banned!r}"
    # "credit repair" is only OK in a negation ("not a credit repair organization")
    import re as _re
    for m in _re.finditer(r"credit repair", low):
        pre = low[max(0, m.start() - 90):m.start()]
        assert _re.search(r"\bnot\b", pre) or "commercial" in pre, f"{rel}: 'credit repair' not in a disclaiming context"

home = (ROOT / "index.html").read_text()
assert home.count("<h1") == 1, "home should have exactly one h1"
assert "what we do" in home.lower(), "home missing 'what we do'"

tk = (ROOT / "toolkit/index.html").read_text()
assert "/assets/dispute.js" in tk, "toolkit not loading the wizard"
assert 'id="dispute-center"' in tk, "toolkit missing the wizard mount"

for req in ["privacy/index.html", "terms/index.html", "transparency/index.html"]:
    assert (ROOT / req).exists(), f"missing required page {req}"

node = shutil.which("node")
if node:
    for fn in ["functions/api/credit-report/extract.js", "functions/api/letters/status.js",
               "functions/api/letters/mail.js", "assets/dispute.js", "assets/site.js"]:
        subprocess.run([node, "--check", str(ROOT / fn)], check=True)
else:
    print("(node not found — skipped JS syntax check)")

print(f"OK — {len(PAGES)} pages built, scripts valid, banned phrases absent")
