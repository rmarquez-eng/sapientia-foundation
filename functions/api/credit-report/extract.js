// POST /api/credit-report/extract
// Ported from vermilionvitez.com's _worker.js (handleCreditReportExtract +
// extractCreditReportCandidates). Public and unauthenticated: a PDF is read
// once, in memory, to pull out text and detect tradelines. Nothing is
// written to KV, R2, a database, or a log — this is someone's full credit
// report. Rate-limited by IP when a KV namespace named RL is bound.
import { getDocumentProxy, extractText } from "unpdf";

const MAX_BYTES = 12 * 1024 * 1024;

const HEADER_WORDS = /^(personal information|account (history|summary|information)|public records|inquiries|credit report|page \d|summary|score|report date|date of birth|current address|previous address|employment|creditor contacts)/i;
const NEGATIVE_WORDS = /(collection|charge[\s-]?off|repossession|delinquent|late payment|past due|derogatory|write[\s-]?off|foreclosure|judgment)/i;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
}

// Fixed-window counter. Fails open if RL isn't bound (tool still works,
// just unthrottled) — see README for how to add the namespace.
async function rateLimited(env, key, limit, windowSec) {
  if (!env.RL) return false;
  const bucket = `${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  const current = parseInt((await env.RL.get(bucket)) || "0", 10);
  if (current >= limit) return true;
  await env.RL.put(bucket, String(current + 1), { expirationTtl: windowSec });
  return false;
}

function extractCandidates(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const acctRe = /(?:account|acct)\.?\s*(?:number|no\.?|#)?\s*[:#-]?\s*([Xx*\d-]{4,20})/i;
  const seen = new Set();
  const candidates = [];
  for (let i = 0; i < lines.length && candidates.length < 40; i++) {
    const m = lines[i].match(acctRe);
    if (!m || seen.has(m[1])) continue;
    let creditorName = "";
    for (let j = i; j >= Math.max(0, i - 3); j--) {
      const cand = lines[j].replace(acctRe, "").trim();
      if (cand.length >= 3 && cand.length <= 60 && !HEADER_WORDS.test(cand) && /[A-Za-z]/.test(cand)) {
        creditorName = cand;
        break;
      }
    }
    if (!creditorName) continue;
    const windowText = lines.slice(Math.max(0, i - 2), i + 3).join(" ");
    seen.add(m[1]);
    candidates.push({ creditorName, accountNumber: m[1], flagged: NEGATIVE_WORDS.test(windowText) });
  }
  return candidates;
}

export async function onRequestPost({ request, env }) {
  const ip = clientIp(request);
  if (await rateLimited(env, `credit-report-extract:${ip}`, 8, 3600)) {
    return json({ error: "Too many uploads — please try again in a bit." }, 429);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "invalid upload" }, 400);
  }
  const file = form.get("report");
  if (!file || typeof file.arrayBuffer !== "function") return json({ error: "no PDF file provided" }, 400);
  if (file.size > MAX_BYTES) return json({ error: "File is too large (12MB max)." }, 400);

  let text;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(bytes);
    // mergePages:false keeps each page's real line breaks — mergePages:true
    // flattens the whole report to one line and breaks line-based parsing.
    const result = await extractText(pdf, { mergePages: false });
    text = Array.isArray(result.text) ? result.text.join("\n") : result.text || "";
  } catch {
    return json({ error: "Could not read that PDF — make sure it is not a scanned image and try again." }, 400);
  }
  if (!text || text.trim().length < 20) return json({ error: "No readable text found in that PDF." }, 400);

  return json({ ok: true, candidates: extractCandidates(text), text: text.slice(0, 20000) });
}

export async function onRequestGet() {
  return json({ error: "POST a multipart form with a 'report' PDF field." }, 405);
}
