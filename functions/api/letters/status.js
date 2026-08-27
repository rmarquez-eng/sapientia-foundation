// GET /api/letters/status — the credit tool calls this to decide whether to
// offer "Sapientia can mail this for me". Stays disabled until the Foundation
// sets its LetterStream API credentials as Pages secrets (LETTERSTREAM_API_ID
// and LETTERSTREAM_API_KEY). See functions/api/letters/mail.js.
export function onRequestGet({ env }) {
  const enabled = !!(env.LETTERSTREAM_API_ID && env.LETTERSTREAM_API_KEY);
  return new Response(
    JSON.stringify({
      enabled,
      message: enabled
        ? "Sapientia can print and mail this letter by first-class or certified mail on your behalf, at the Foundation's cost, with tracking."
        : null,
    }),
    { headers: { "content-type": "application/json", "cache-control": "no-store" } }
  );
}
