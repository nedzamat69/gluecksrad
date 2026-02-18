const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;
const ROOT_DIR = path.join(__dirname, "..");
const EMAILS_PATH = path.join(__dirname, "emails.txt");
const TLDS_PATH = path.join(ROOT_DIR, "tlds.json");
const ASCII_TLD_RE = /^[a-z]{2,63}$/;
const PUNYCODE_TLD_RE = /^xn--[a-z0-9-]{1,59}$/;
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:63342"
]);
let VALID_TLDS = new Set();
let tldsLoaded = false;

function isValidTldToken(token) {
  return token.length <= 63 && (ASCII_TLD_RE.test(token) || PUNYCODE_TLD_RE.test(token));
}

function loadTlds() {
  try {
    const raw = fs.readFileSync(TLDS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("tlds.json is not an array");
    const cleaned = parsed
      .map((v) => String(v || "").trim().toLowerCase())
      .filter(isValidTldToken);
    VALID_TLDS = new Set(cleaned);
    tldsLoaded = VALID_TLDS.size > 0;
  } catch {
    VALID_TLDS = new Set();
    tldsLoaded = false;
  }
}

function ensureEmailsFile() {
  if (!fs.existsSync(EMAILS_PATH)) {
    fs.writeFileSync(EMAILS_PATH, "", "utf8");
  }
}

function readEmails() {
  ensureEmailsFile();
  const raw = fs.readFileSync(EMAILS_PATH, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
}

function appendEmail(email) {
  fs.appendFileSync(EMAILS_PATH, `${email}\n`, "utf8");
}

function parseJson(req, res) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  const json = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json)
  });
  res.end(json);
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".json":
      return "application/json; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const resolved = path.join(ROOT_DIR, safePath);

  if (!resolved.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const filePath = pathname === "/" ? path.join(ROOT_DIR, "index.html") : resolved;

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const data = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": getContentType(filePath) });
  res.end(data);
}

function validateEmail(email) {
  const normalized = String(email ?? "").trim().toLowerCase();

  if (!normalized) {
    return { ok: false, normalized, error: "E-Mail darf nicht leer sein" };
  }

  if (normalized.length < 6) {
    return { ok: false, normalized, error: "E-Mail ist zu kurz" };
  }

  if (normalized.length > 254) {
    return { ok: false, normalized, error: "E-Mail ist zu lang" };
  }

  if (/[^\x00-\x7F]/.test(normalized)) {
    return { ok: false, normalized, error: "Nur ASCII-Zeichen sind erlaubt" };
  }

  if (/\s/.test(normalized)) {
    return { ok: false, normalized, error: "E-Mail darf keine Leerzeichen enthalten" };
  }

  const atCount = (normalized.match(/@/g) || []).length;
  if (atCount !== 1) {
    return { ok: false, normalized, error: "E-Mail muss genau ein @ enthalten" };
  }

  const [localPart, domainPart] = normalized.split("@");
  if (!localPart || !domainPart) {
    return { ok: false, normalized, error: "E-Mail ist unvollstaendig" };
  }

  if (localPart.startsWith(".") || localPart.endsWith(".")) {
    return { ok: false, normalized, error: "Lokaler Teil darf nicht mit Punkt starten oder enden" };
  }

  if (localPart.includes("..") || domainPart.includes("..")) {
    return { ok: false, normalized, error: "Zwei Punkte hintereinander sind nicht erlaubt" };
  }

  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart)) {
    return { ok: false, normalized, error: "Lokaler Teil enthaelt ungueltige Zeichen" };
  }

  if (
    domainPart.startsWith("-") ||
    domainPart.endsWith("-") ||
    domainPart.startsWith(".") ||
    domainPart.endsWith(".")
  ) {
    return { ok: false, normalized, error: "Domain ist ungueltig" };
  }

  if (!/^[a-z0-9.-]+$/.test(domainPart)) {
    return { ok: false, normalized, error: "Domain enthaelt ungueltige Zeichen" };
  }

  if (!domainPart.includes(".")) {
    return { ok: false, normalized, error: "Domain muss einen Punkt enthalten" };
  }

  const labels = domainPart.split(".");
  const tld = labels[labels.length - 1] || "";

  if (tld.length < 2) {
    return { ok: false, normalized, error: "Top-Level-Domain ist zu kurz" };
  }

  if (!tldsLoaded || !VALID_TLDS.size) {
    return { ok: false, normalized, error: "TLD-Liste ist nicht geladen" };
  }

  if (!VALID_TLDS.has(tld)) {
    return { ok: false, normalized, error: "Top-Level-Domain ist nicht gueltig" };
  }

  for (const label of labels) {
    if (!label || label.length > 63 || label.startsWith("-") || label.endsWith("-")) {
      return { ok: false, normalized, error: "Domain ist ungueltig" };
    }
  }

  return { ok: true, normalized };
}

function isValidEmail(email) {
  return validateEmail(email).ok;
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/api/claim-spin") {
    try {
      const body = await parseJson(req, res);
      const validation = validateEmail(body.email);
      const email = validation.normalized;

      if (!validation.ok) {
        sendJson(res, 400, {
          ok: false,
          error: "INVALID_EMAIL",
          message: validation.error || "Ungueltige E-Mail"
        });
        return;
      }

      const emails = readEmails();
      if (emails.includes(email)) {
        sendJson(res, 409, {
          ok: false,
          error: "EMAIL_USED",
          message: "Diese E-Mail wurde bereits verwendet."
        });
        return;
      }

      appendEmail(email);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: "SERVER_ERROR" });
    }
    return;
  }

  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      tldsLoaded,
      tldsCount: VALID_TLDS.size
    });
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  res.writeHead(405);
  res.end("Method Not Allowed");
});

ensureEmailsFile();
loadTlds();
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
