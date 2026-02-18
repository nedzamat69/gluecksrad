import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tldsPath = path.resolve(__dirname, "..", "tlds.json");
const tlds = JSON.parse(await readFile(tldsPath, "utf8"));
const ASCII_TLD_RE = /^[a-z]{2,63}$/;
const PUNYCODE_TLD_RE = /^xn--[a-z0-9-]{1,59}$/;

function isValidTldToken(token) {
  return token.length <= 63 && (ASCII_TLD_RE.test(token) || PUNYCODE_TLD_RE.test(token));
}

const VALID_TLDS = new Set(
  tlds
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(isValidTldToken)
);

function validateEmail(email) {
  const normalized = String(email ?? "").trim().toLowerCase();
  if (!normalized) return { ok: false, normalized, error: "E-Mail darf nicht leer sein" };
  if (normalized.length < 6) return { ok: false, normalized, error: "E-Mail ist zu kurz" };
  if (normalized.length > 254) return { ok: false, normalized, error: "E-Mail ist zu lang" };
  if (/[^\x00-\x7F]/.test(normalized)) return { ok: false, normalized, error: "Nur ASCII-Zeichen sind erlaubt" };
  if (/\s/.test(normalized)) return { ok: false, normalized, error: "E-Mail darf keine Leerzeichen enthalten" };

  const atCount = (normalized.match(/@/g) || []).length;
  if (atCount !== 1) return { ok: false, normalized, error: "E-Mail muss genau ein @ enthalten" };

  const [localPart, domainPart] = normalized.split("@");
  if (!localPart || !domainPart) return { ok: false, normalized, error: "E-Mail ist unvollstaendig" };
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
  if (tld.length < 2) return { ok: false, normalized, error: "Top-Level-Domain ist zu kurz" };
  if (!VALID_TLDS.has(tld)) return { ok: false, normalized, error: "Top-Level-Domain ist nicht gueltig" };

  for (const label of labels) {
    if (!label || label.length > 63 || label.startsWith("-") || label.endsWith("-")) {
      return { ok: false, normalized, error: "Domain ist ungueltig" };
    }
  }

  return { ok: true, normalized };
}

const tests = [
  { input: "test@example.com", expectedOk: true, expectedErrorLike: "" },
  { input: "up.vizijadogodkov@cups.si", expectedOk: true, expectedErrorLike: "" },
  { input: "first.last+tag@sub.example.co.uk", expectedOk: true, expectedErrorLike: "" },
  { input: "test@email.ff", expectedOk: false, expectedErrorLike: "Top-Level-Domain ist nicht gueltig" },
  { input: "test@domain.invalidtld", expectedOk: false, expectedErrorLike: "Top-Level-Domain ist nicht gueltig" },
  { input: "test@domain.osterreich", expectedOk: false, expectedErrorLike: "Top-Level-Domain ist nicht gueltig" },
  { input: "test@domain.österreich", expectedOk: false, expectedErrorLike: "ASCII" },
  { input: " ab@cd.e ", expectedOk: false, expectedErrorLike: "Top-Level-Domain ist zu kurz" },
  { input: "john..doe@example.com", expectedOk: false, expectedErrorLike: "Zwei Punkte" },
  { input: ".john@example.com", expectedOk: false, expectedErrorLike: "Lokaler Teil" },
  { input: "john@example..com", expectedOk: false, expectedErrorLike: "Zwei Punkte" },
  { input: "john@example", expectedOk: false, expectedErrorLike: "Punkt enthalten" },
  { input: "john doe@example.com", expectedOk: false, expectedErrorLike: "Leerzeichen" }
];

let failed = 0;
for (const test of tests) {
  const result = validateEmail(test.input);
  const okMatch = result.ok === test.expectedOk;
  const errorMatch = test.expectedOk
    ? true
    : String(result.error || "").toLowerCase().includes(test.expectedErrorLike.toLowerCase());
  const pass = okMatch && errorMatch;

  if (!pass) {
    failed += 1;
    console.error("FAIL", { input: test.input, expected: test, got: result });
  } else {
    console.log("PASS", test.input, "=>", result.ok, result.error || "");
  }
}

if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log(`All ${tests.length} tests passed`);
}
