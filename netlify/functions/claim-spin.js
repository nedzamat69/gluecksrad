const CLAIM_TTL_MS = 10 * 60 * 1000;
const claims = new Map();

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(payload)
  };
}

function normalizeEmail(input) {
  return String(input || "").trim().toLowerCase();
}

function cleanup(now = Date.now()) {
  for (const [email, ts] of claims.entries()) {
    if (now - ts > CLAIM_TTL_MS) {
      claims.delete(email);
    }
  }
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, message: "Method Not Allowed" });
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { ok: false, message: "Invalid JSON body" });
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return json(400, { ok: false, message: "E-Mail darf nicht leer sein" });
  }

  cleanup();

  if (claims.has(email)) {
    return json(409, { ok: false, message: "Diese E-Mail wurde bereits verwendet." });
  }

  claims.set(email, Date.now());
  return json(200, { ok: true, message: "OK – 1 Dreh freigeschaltet" });
};
