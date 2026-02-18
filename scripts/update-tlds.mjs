import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const IANA_TLDS_URL = "https://data.iana.org/TLD/tlds-alpha-by-domain.txt";
const ASCII_TLD_RE = /^[a-z]{2,63}$/;
const PUNYCODE_TLD_RE = /^xn--[a-z0-9-]{1,59}$/;

function isValidTldToken(token) {
  return token.length <= 63 && (ASCII_TLD_RE.test(token) || PUNYCODE_TLD_RE.test(token));
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outPath = path.resolve(__dirname, "..", "tlds.json");

const response = await fetch(IANA_TLDS_URL, {
  headers: { "user-agent": "spin-the-wheel-tld-updater/1.2" }
});

if (!response.ok) {
  throw new Error(`Download failed: ${response.status} ${response.statusText}`);
}

const body = await response.text();
const tlds = body
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => line.toLowerCase())
  .filter(isValidTldToken);

const uniqueSorted = Array.from(new Set(tlds)).sort();
await writeFile(outPath, `${JSON.stringify(uniqueSorted, null, 2)}\n`, "utf8");

console.log(`Wrote ${uniqueSorted.length} TLDs to ${outPath}`);
