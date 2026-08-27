# Sapientia Foundation — sapientiafoundation.com

Static one-page site. Design system carried over from vermilionvitez.com
(dark navy ground, Playfair Display + Inter, vermilion/gold accents, pill
buttons, grain overlay) — see `assets/style.css`.

## Files
- `index.html` — the whole site (one-pager, anchored sections)
- `404.html`
- `assets/style.css` — shared design system
- `_headers` — security headers + asset caching (Cloudflare Pages)
- `robots.txt`, `sitemap.xml`

## Deploy (Cloudflare Pages)

Domain is already in Cloudflare. Cheapest path — no build step, no Worker:

```
npx wrangler pages project create sapientia-foundation --production-branch main
npx wrangler pages deploy . --project-name sapientia-foundation
```

Then in the Cloudflare dashboard: Pages → sapientia-foundation → Custom
domains → add `sapientiafoundation.com` and `www.sapientiafoundation.com`.
Cloudflare adds the CNAME automatically since the zone is on the account.

To preview locally: `npx wrangler pages dev .`

## Content source
All copy is from `~/Desktop/Sapientia Foundation - Grant Package/`
(grant application + program description). Update those and this together.

## Not built yet (add when real)
- The free self-help credit-dispute tool (linked as "coming" — currently the
  program section just describes it).
- Real donation flow — "Support the work" is a mailto for now. Add Stripe /
  a donor platform when there's an account to point at.
- Workshop schedule — mailto notice list until partner agreements land.
