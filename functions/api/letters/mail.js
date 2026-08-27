// POST /api/letters/mail
// Ported from vermilionvitez.com's _worker.js LetterStream helpers, trimmed
// to Sapientia's model: the letter is FREE to the participant. There is no
// Stripe step and no member account — the Foundation absorbs LetterStream's
// per-piece cost. Flow is preauth (validates address + PDF, returns cost)
// then immediate doauth release.
//
// Disabled until BOTH secrets are set:
//   npx wrangler pages secret put LETTERSTREAM_API_ID
//   npx wrangler pages secret put LETTERSTREAM_API_KEY
//
// Abuse controls: IP rate limit (needs the RL KV namespace) + a hard daily
// cap so a scripted flood cannot drain the Foundation's LetterStream prepay
// balance. Tune LETTERS_PER_DAY / per-IP limits to the grant budget.
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createHash } from "node:crypto";

const LS_URL = "https://www.letterstream.com/apis/index.php";
const MAILTYPES = ["firstclass", "certified", "certifiedreturn"];
const LETTERS_PER_DAY = 40;
const LETTERS_PER_IP_DAY = 3;

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const ip = (r) => r.headers.get("cf-connecting-ip") || "unknown";

async function bump(env, key, limit, windowSec) {
  if (!env.RL) return false; // fails open; see README
  const k = `${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  const n = parseInt((await env.RL.get(k)) || "0", 10);
  if (n >= limit) return true;
  await env.RL.put(k, String(n + 1), { expirationTtl: windowSec });
  return false;
}

function lsUniqueId() {
  return String(Date.now());
}
function lsHash(apiKey, uid) {
  const s = String(uid).slice(-6) + apiKey + String(uid).slice(0, 6);
  return createHash("md5").update(btoa(s), "utf8").digest("hex");
}
function addr(parts) {
  return parts.map((p) => String(p == null ? "" : p).replace(/:/g, " ").trim()).join(":");
}
function authForm(apiId, apiKey) {
  const uid = lsUniqueId();
  const f = new FormData();
  f.set("a", apiId);
  f.set("h", lsHash(apiKey, uid));
  f.set("t", uid);
  f.set("responseformat", "json");
  f.set("debug", "3");
  return f;
}
function resultMessage(data) {
  if (!data) return null;
  const msgs = Array.isArray(data.message) ? data.message : data.message ? [data.message] : [];
  return (
    msgs.find((m) => m && (m.authcode !== undefined || (m.doc && m.doc.job !== undefined))) ||
    msgs.find((m) => m && (!m["@attributes"] || m["@attributes"].type !== "info")) ||
    msgs[msgs.length - 1] ||
    null
  );
}
async function post(form) {
  const res = await fetch(LS_URL, { method: "POST", body: form });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  const rm = data ? resultMessage(data) : null;
  return { text, rm, code: rm ? Number(rm.code) : NaN };
}

async function renderPdf(bodyText) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const W = 612, H = 792, margin = 72, size = 11, lh = size * 1.4, maxW = W - margin * 2;
  const lines = [];
  for (const para of String(bodyText).split("\n")) {
    if (!para.trim()) { lines.push(""); continue; }
    let cur = "";
    for (const word of para.split(/\s+/)) {
      const test = cur ? cur + " " + word : word;
      if (cur && font.widthOfTextAtSize(test, size) > maxW) { lines.push(cur); cur = word; }
      else cur = test;
    }
    if (cur) lines.push(cur);
  }
  let page = doc.addPage([W, H]);
  let y = H - margin;
  for (const line of lines) {
    if (y - lh < margin) { page = doc.addPage([W, H]); y = H - margin; }
    if (line) page.drawText(line, { x: margin, y, size, font });
    y -= lh;
  }
  return doc.save();
}

const REQUIRED = [
  "body_text", "recipient_name", "recipient_address1", "recipient_city", "recipient_state", "recipient_zip",
  "sender_name", "sender_address1", "sender_city", "sender_state", "sender_zip",
];

export async function onRequestPost({ request, env }) {
  const apiId = env.LETTERSTREAM_API_ID, apiKey = env.LETTERSTREAM_API_KEY;
  if (!apiId || !apiKey) return json({ error: "Mailing service is not enabled." }, 503);

  if (await bump(env, `letters-ip:${ip(request)}`, LETTERS_PER_IP_DAY, 86400))
    return json({ error: "You have reached the daily limit for mailed letters from this connection. Bring the letter to a clinic, or mail it yourself." }, 429);
  if (await bump(env, "letters-global", LETTERS_PER_DAY, 86400))
    return json({ error: "The mailing service has hit its daily cap. Please try tomorrow or mail the letter yourself." }, 429);

  let b;
  try {
    b = await request.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  for (const k of REQUIRED) if (!String(b[k] || "").trim()) return json({ error: `${k.replace(/_/g, " ")} is required` }, 400);

  const mailtype = MAILTYPES.includes(b.mail_class) ? b.mail_class : "firstclass";
  let pdfBytes, pages;
  try {
    const doc = await PDFDocument.load(await renderPdf(b.body_text));
    pages = doc.getPageCount();
    pdfBytes = await doc.save();
  } catch {
    return json({ error: "Could not build the letter PDF." }, 500);
  }

  const jobName = ("SAP" + Date.now()).slice(0, 20);
  const preauth = authForm(apiId, apiKey);
  preauth.set("job", jobName);
  preauth.append("to[]", addr([jobName, b.recipient_name, "", b.recipient_address1, b.recipient_address2 || "", b.recipient_city, b.recipient_state, b.recipient_zip]));
  preauth.set("from", addr([b.sender_name, "", b.sender_address1, b.sender_address2 || "", b.sender_city, b.sender_state, b.sender_zip]));
  preauth.set("pages", String(pages || 1));
  preauth.set("mailtype", mailtype);
  preauth.set("coversheet", "true");
  preauth.set("duplex", "N");
  preauth.set("ink", "B");
  preauth.set("paper", "W");
  preauth.set("returnenv", "N");
  preauth.set("affidavit", "N");
  preauth.set("preauth", "1");
  preauth.set("single_file", new Blob([pdfBytes], { type: "application/pdf" }), "letter.pdf");

  const pa = await post(preauth);
  if (pa.code !== -200) return json({ error: (pa.rm && pa.rm.details) || "Address or PDF was rejected by the mail service." }, 400);
  const authcode = pa.rm.authcode;
  if (!authcode) return json({ error: "Mail service did not return an authorization." }, 502);

  const release = authForm(apiId, apiKey);
  release.set("doauth", String(authcode));
  const rl = await post(release);
  if (rl.code !== -200) return json({ error: (rl.rm && rl.rm.details) || "Mail service could not release the job." }, 502);

  return json({
    ok: true,
    jobId: (pa.rm.doc && pa.rm.doc.job) || jobName,
    mailType: mailtype,
    costCents: Math.round(Number(pa.rm.cost || 0) * 100),
    message: "Your letter has been sent to the mail house. Keep the job number for your records.",
  });
}
