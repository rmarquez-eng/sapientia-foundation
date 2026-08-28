# Sapientia Foundation — sapientiafoundation.net

Static site + a few Cloudflare Pages Functions. Design system carried over
from vermilionvitez.com (dark navy, Playfair Display + Inter, vermilion/gold,
pill buttons, grain overlay) — see `assets/style.css`.

## Pages
- `/` home — overview + mission + stats
- `/program/` — the Fair Credit & Debt Program (4 components, participant flow)
- `/who-we-serve/` — priority communities, geography
- `/workshops/` — workshop series, clinic flow, notice list
- `/partners/` — who we work with, division of labor, train-the-trainer
- `/about/` — trust structure, board, safeguards
- `/credit-tool/` — the free guided self-help tool (see below)

## Build
Pages are generated from fragments in `.build/src/*.html` wrapped by
`.build/build.py` (stdlib only, no deps). The dot-prefix keeps `.build/` out
of the deployed site.

```
npm run build     # regenerate every <name>/index.html
npm test          # build + assert pages/functions are intact
```

Edit content in `.build/src/`, not the generated `*/index.html`.

## The free credit tool  (`/credit-tool/` + `functions/`)

Ported from vermilionvitez.com's `_worker.js`:

| Piece | File | Notes |
|---|---|---|
| Report text extraction + tradeline detection | `functions/api/credit-report/extract.js` | `unpdf`. PDF read in memory, never stored. IP rate-limited via the `RL` KV namespace. |
| Letter drafting (dispute / validation / goodwill) | client-side in `/credit-tool/` | The participant is the author and sender. Download `.txt` or print to PDF. |
| "Sapientia mails it for me" | `functions/api/letters/mail.js` + `.../status.js` | **Off by default.** LetterStream port, free to the participant (Foundation absorbs cost). Enable by setting the two secrets below. Daily + per-IP caps protect the prepay balance. |

### Setup for the Functions (Cloudflare Pages only — see hosting note)

```
npx wrangler kv namespace create sapientia-rl
# paste the id into wrangler.toml under [[kv_namespaces]] binding = "RL"

# optional — only if the Foundation opts into mailing letters:
npx wrangler pages secret put LETTERSTREAM_API_ID
npx wrangler pages secret put LETTERSTREAM_API_KEY
```

Without the KV namespace the rate limits fail open (tool still works).
Without the secrets the mailing option stays hidden and only the
self-send flow is offered.

## Hosting

**The Functions need Cloudflare Pages** (or Workers). They do not run on
GitHub Pages — there, the static pages work, letter drafting works, but PDF
upload analysis and the mail option do not (paste-text analysis still works
as a fallback).

Deploy to Cloudflare Pages (domain already on the account):

```
npm run deploy
# then: dashboard > Workers & Pages > sapientia-foundation > Custom domains
#       > add sapientiafoundation.net and www
```

The repo also builds on GitHub Pages as-is (degraded credit tool). Pick one
host and point DNS at it — don't run both.

## Content source
`~/Desktop/Sapientia Foundation - Grant Package/` (grant application +
program description). Keep copy and those documents in sync.
