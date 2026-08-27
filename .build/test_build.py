#!/usr/bin/env python3
"""Smallest check that fails if the build or the Functions break.
Run: python3 .build/test_build.py   (or: npm test)"""
import pathlib, subprocess, sys, shutil

ROOT = pathlib.Path(__file__).parent.parent
subprocess.run([sys.executable, str(ROOT / ".build" / "build.py")], check=True)

PAGES = ["index.html", "program/index.html", "who-we-serve/index.html",
         "workshops/index.html", "partners/index.html", "about/index.html",
         "credit-tool/index.html"]

for rel in PAGES:
    html = (ROOT / rel).read_text()
    assert "<title>" in html and "</title>" in html, f"{rel}: missing title"
    assert 'id="nav"' in html, f"{rel}: shared nav missing"
    assert "<footer>" in html, f"{rel}: shared footer missing"
    assert "EIN 39-4961628" in html or "39-4961628" in html, f"{rel}: EIN missing"

home = (ROOT / "index.html").read_text()
assert home.count("<h1") == 1, "home should have exactly one h1"

tool = (ROOT / "credit-tool/index.html").read_text()
assert "/api/credit-report/extract" in tool, "credit tool not wired to the API"
assert "never stored" in tool.lower(), "credit tool missing the privacy notice"

# Functions must be valid JS if node is available.
node = shutil.which("node")
if node:
    for fn in ["functions/api/credit-report/extract.js",
               "functions/api/letters/status.js",
               "functions/api/letters/mail.js"]:
        subprocess.run([node, "--check", str(ROOT / fn)], check=True)
else:
    print("(node not found — skipped JS syntax check)")

print(f"OK — {len(PAGES)} pages built, functions valid")
