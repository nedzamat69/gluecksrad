const wheel = document.getElementById("wheel");
const ctx = wheel.getContext("2d");
const spinBtn = document.getElementById("spinBtn");
const resultEl = document.getElementById("result");
const prizeList = document.getElementById("prizeList");
const recentWinsEl = document.getElementById("recentWins");
const themeToggle = document.getElementById("themeToggle");
const emailInput = document.getElementById("emailInput");
const emailConfirmBtn = document.getElementById("emailConfirmBtn");
const emailStatus = document.getElementById("emailStatus");

function toApiBaseOrEmpty(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().replace(/\/+$/, "");
  if (!normalized) return "";

  try {
    const parsed = new URL(normalized, window.location.href);
    const cleanPath = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${cleanPath}`;
  } catch {
    return "";
  }
}

function resolveConfiguredApiBase() {
  const fromConfig = toApiBaseOrEmpty(window.WHEEL_CONFIG?.apiOrigin);
  if (fromConfig) return fromConfig;

  const fromGlobal = toApiBaseOrEmpty(window.WHEEL_API_ORIGIN);
  if (fromGlobal) return fromGlobal;

  const fromQuery = toApiBaseOrEmpty(new URLSearchParams(window.location.search).get("api"));
  if (fromQuery) return fromQuery;

  return "";
}

function resolveClaimEndpoint() {
  const configured = resolveConfiguredApiBase();
  if (configured) return `${configured}/api/claim-spin`;

  const host = window.location.hostname;
  const isLocalhost = host === "localhost" || host === "127.0.0.1";
  if (isLocalhost && window.location.port && window.location.port !== "3000") {
    return "http://localhost:3000/api/claim-spin";
  }

  return "/api/claim-spin";
}

const CLAIM_ENDPOINT = resolveClaimEndpoint();
const TLDS_URL = new URL("tlds.json", window.location.href).toString();
const IS_GITHUB_PAGES = window.location.hostname.endsWith(".github.io");

function hasSpinStore() {
  return Boolean(
    window.SpinStore &&
      typeof window.SpinStore.claimSpin === "function" &&
      typeof window.SpinStore.consumeSpin === "function"
  );
}

function shouldUseLocalSpinStoreFallback() {
  return IS_GITHUB_PAGES && hasSpinStore();
}

const prizes = [
  { label: "80% Rabatt", weight: 0.4 },
  { label: "3% Rabatt", weight: 35 },
  { label: "5% Rabatt", weight: 30 },
  { label: "10% Rabatt", weight: 20 },
  { label: "15% Rabatt", weight: 10 },
  { label: "25% Rabatt", weight: 4.6 }
];

const segmentCount = prizes.length;
const TAU = Math.PI * 2;
const segmentAngle = TAU / segmentCount;
const colors = ["#d62828", "#ffffff"];
const pointerAngle = -Math.PI / 2; // 12 o'clock
const drawOffset = 0; // drawing starts at 3 o'clock
const RECENT_WINS_KEY = "wheel_recent_wins";

let currentRotation = 0;
let spinning = false;
let spinUnlocked = false;
let confetti = [];
let recentWins = [];
let claimInFlight = false;
let claimSeq = 0;
let claimAbort = null;
let lastClaim = { email: "", ok: false, time: 0 };

const ASCII_TLD_RE = /^[a-z]{2,63}$/;
const PUNYCODE_TLD_RE = /^xn--[a-z0-9-]{1,59}$/;
let VALID_TLDS = new Set();
let tldsLoadFailed = false;

function isValidTldToken(token) {
  return token.length <= 63 && (ASCII_TLD_RE.test(token) || PUNYCODE_TLD_RE.test(token));
}

function toValidTldSet(list) {
  if (!Array.isArray(list)) return new Set();
  const cleaned = list
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(isValidTldToken);
  if (!cleaned.length) return new Set();
  return new Set(cleaned);
}

async function loadTlds() {
  try {
    const response = await fetch(TLDS_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load tlds.json");

    const list = await response.json();
    VALID_TLDS = toValidTldSet(list);
    if (!VALID_TLDS.size) {
      throw new Error("Empty or invalid TLD list");
    }

    tldsLoadFailed = false;
    if (emailConfirmBtn) emailConfirmBtn.disabled = false;
    setEmailStatus(`TLD-Liste geladen (${VALID_TLDS.size})`, "info");
  } catch {
    VALID_TLDS = new Set();
    tldsLoadFailed = true;
    if (emailConfirmBtn) emailConfirmBtn.disabled = true;
    setEmailStatus(
      "TLD-Liste konnte nicht geladen werden – tlds.json fehlt oder wird nicht ausgeliefert.",
      "error"
    );
  }
}
const tldsReady = loadTlds();

function updateSpinButton() {
  spinBtn.disabled = spinning || !spinUnlocked;
}

function setEmailStatus(message, type = "info") {
  if (!emailStatus) return;
  emailStatus.textContent = message;
  emailStatus.className = `email-status ${type}`;
}

function setSpinUnlocked(value) {
  spinUnlocked = value;
  updateSpinButton();
}

function setEmailGateLocked(locked) {
  if (emailInput) emailInput.disabled = locked;
  if (emailConfirmBtn) emailConfirmBtn.disabled = locked;
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
    return { ok: false, normalized, error: "Lokaler Teil enthält ungültige Zeichen" };
  }

  if (
    domainPart.startsWith("-") ||
    domainPart.endsWith("-") ||
    domainPart.startsWith(".") ||
    domainPart.endsWith(".")
  ) {
    return { ok: false, normalized, error: "Domain ist ungültig" };
  }

  if (!/^[a-z0-9.-]+$/.test(domainPart)) {
    return { ok: false, normalized, error: "Domain enthält ungültige Zeichen" };
  }

  if (!domainPart.includes(".")) {
    return { ok: false, normalized, error: "Domain muss einen Punkt enthalten" };
  }

  const labels = domainPart.split(".");
  const tld = labels[labels.length - 1] || "";

  if (tld.length < 2) {
    return { ok: false, normalized, error: "Top-Level-Domain ist zu kurz" };
  }

  if (!VALID_TLDS.has(tld)) {
    return { ok: false, normalized, error: "Top-Level-Domain ist nicht gültig" };
  }

  for (const label of labels) {
    if (!label || label.length > 63 || label.startsWith("-") || label.endsWith("-")) {
      return { ok: false, normalized, error: "Domain ist ungültig" };
    }
  }

  return { ok: true, normalized };
}

function isValidEmail(email) {
  return validateEmail(email).ok;
}

async function claimSpin() {
  if (!emailInput || !emailConfirmBtn) return;
  if (claimInFlight) {
    setEmailStatus("Wird bereits geprüft…", "info");
    return;
  }

  claimInFlight = true;
  const seq = ++claimSeq;
  setEmailGateLocked(true);
  emailConfirmBtn.textContent = "Prüfe...";
  setEmailStatus("E-Mail wird geprüft...", "info");

  await tldsReady;

  if (tldsLoadFailed || !VALID_TLDS.size) {
    claimInFlight = false;
    setEmailGateLocked(false);
    emailConfirmBtn.textContent = "E-Mail bestätigen";
    setSpinUnlocked(false);
    setEmailStatus(
      "TLD-Liste konnte nicht geladen werden – tlds.json fehlt oder wird nicht ausgeliefert.",
      "error"
    );
    return;
  }

  const validation = validateEmail(emailInput.value);

  if (!validation.ok) {
    claimInFlight = false;
    setEmailGateLocked(false);
    emailConfirmBtn.textContent = "E-Mail bestätigen";
    setSpinUnlocked(false);
    setEmailStatus(validation.error || "Ungültige E-Mail", "error");
    return;
  }

  const normalizedEmail = validation.normalized;
  emailInput.value = normalizedEmail;

  if (shouldUseLocalSpinStoreFallback()) {
    const localClaim = window.SpinStore.claimSpin();
    claimInFlight = false;
    setEmailGateLocked(false);
    emailConfirmBtn.textContent = "E-Mail bestätigen";

    if (localClaim && localClaim.ok) {
      setSpinUnlocked(true);
      lastClaim = { email: normalizedEmail, ok: true, time: Date.now() };
      setEmailStatus(localClaim.message || "OK – 1 Dreh freigeschaltet", "success");
      return;
    }

    setSpinUnlocked(false);
    setEmailStatus(
      (localClaim && localClaim.message) || "Diese E-Mail wurde bereits verwendet.",
      "error"
    );
    return;
  }

  if (claimAbort) claimAbort.abort();
  claimAbort = new AbortController();
  const timeoutId = setTimeout(() => {
    if (claimAbort) claimAbort.abort();
  }, 8000);

  try {
    const response = await fetch(CLAIM_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: normalizedEmail }),
      signal: claimAbort.signal
    });

    if (seq !== claimSeq) return;

    if (response.ok) {
      setSpinUnlocked(true);
      lastClaim = { email: normalizedEmail, ok: true, time: Date.now() };
      setEmailStatus("OK – 1 Dreh freigeschaltet", "success");
    } else if (response.status === 409) {
      if (
        lastClaim.ok &&
        lastClaim.email === normalizedEmail &&
        Date.now() - lastClaim.time < 2000
      ) {
        setSpinUnlocked(true);
        setEmailStatus("OK – 1 Dreh freigeschaltet", "success");
        return;
      }

      setSpinUnlocked(false);
      let message = "Fehler beim Prüfen der E-Mail.";
      try {
        const payload = await response.json();
        if (payload && typeof payload.message === "string" && payload.message.trim()) {
          message = payload.message.trim();
        }
      } catch {
        // Keep fallback message.
      }
      setEmailStatus(message, "error");
    } else {
      setSpinUnlocked(false);
      let message = "Fehler beim Prüfen der E-Mail.";
      try {
        const payload = await response.json();
        if (payload && typeof payload.message === "string" && payload.message.trim()) {
          message = payload.message.trim();
        }
      } catch {
        // Keep fallback message.
      }
      setEmailStatus(message, "error");
    }
  } catch {
    if (seq !== claimSeq) return;
    setSpinUnlocked(false);
    setEmailStatus("Server nicht erreichbar.", "error");
  } finally {
    clearTimeout(timeoutId);
    if (seq !== claimSeq) return;
    claimInFlight = false;
    claimAbort = null;
    if (!spinUnlocked) {
      setEmailGateLocked(false);
    }
    emailConfirmBtn.textContent = "E-Mail bestätigen";
  }
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggle.querySelector(".toggle-label").textContent =
    theme === "dark" ? "Dark" : "Light";
  localStorage.setItem("wheel-theme", theme);
}

function initTheme() {
  const saved = localStorage.getItem("wheel-theme");
  setTheme(saved === "dark" ? "dark" : "light");
}

function loadRecentWins() {
  try {
    const raw = localStorage.getItem(RECENT_WINS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    recentWins = Array.isArray(parsed) ? parsed.slice(0, 6) : [];
  } catch {
    recentWins = [];
  }
}

function saveRecentWins() {
  localStorage.setItem(RECENT_WINS_KEY, JSON.stringify(recentWins));
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderRecentWins() {
  if (!recentWinsEl) return;
  recentWinsEl.innerHTML = "";

  if (recentWins.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Noch keine Gewinne";
    recentWinsEl.appendChild(li);
    return;
  }

  recentWins.forEach((win) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${formatTime(win.time)}</span><span>${win.label}</span>`;
    recentWinsEl.appendChild(li);
  });

  const remaining = 6 - recentWins.length;
  for (let i = 0; i < remaining; i++) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "–";
    recentWinsEl.appendChild(li);
  }
}

function addRecentWin(label) {
  recentWins.unshift({ label, time: Date.now() });
  recentWins = recentWins.slice(0, 6);
  saveRecentWins();
  renderRecentWins();
}

function normalizeAngle(angle) {
  return ((angle % TAU) + TAU) % TAU;
}

function weightedPick(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  const roll = Math.random() * total;
  let acc = 0;
  for (let i = 0; i < items.length; i++) {
    acc += items[i].weight;
    if (roll <= acc) return i;
  }
  return items.length - 1;
}

function computeFinalRotation(targetIndex, startRotation) {
  const mid = targetIndex * segmentAngle + segmentAngle / 2;
  let desired = pointerAngle - (mid + drawOffset);
  desired = normalizeAngle(desired);

  const spins = 4 + Math.floor(Math.random() * 4); // 4..7
  const jitter = (Math.random() * 0.7 - 0.35) * segmentAngle; // within segment

  const normalizedStart = normalizeAngle(startRotation);
  let delta = desired - normalizedStart;
  if (delta < 0) delta += TAU;
  delta += spins * TAU + jitter;

  return startRotation + delta;
}

function getSegmentIndexFromRotation(rotation) {
  const angleUnderPointer = normalizeAngle(pointerAngle - (rotation + drawOffset));
  const index = Math.floor(angleUnderPointer / segmentAngle);
  return Math.min(Math.max(index, 0), segmentCount - 1);
}

function drawWheel(rotation = 0) {
  const { width, height } = wheel;
  const radius = width / 2;
  ctx.clearRect(0, 0, width, height);

  for (let i = 0; i < segmentCount; i++) {
    const startAngle = i * segmentAngle + rotation + drawOffset;
    const endAngle = startAngle + segmentAngle;

    ctx.beginPath();
    ctx.moveTo(radius, radius);
    ctx.arc(radius, radius, radius - 6, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();

    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1;
    ctx.stroke();

    const textAngle = startAngle + segmentAngle / 2;
    ctx.save();
    ctx.translate(radius, radius);
    ctx.rotate(textAngle);
    ctx.textAlign = "right";
    ctx.font = "600 20px 'Space Grotesk', sans-serif";
    ctx.fillStyle = i % 2 === 0 ? "#ffffff" : "#111827";
    ctx.fillText(prizes[i].label, radius - 24, 8);
    ctx.restore();
  }

  if (confetti.length) drawConfetti();
}

function spin() {
  if (spinning || !spinUnlocked) return;
  spinning = true;
  updateSpinButton();

  const targetIndex = weightedPick(prizes);
  const finalRotation = computeFinalRotation(targetIndex, currentRotation);

  const startRotation = currentRotation;
  const duration = 4200 + Math.random() * 800;
  const start = performance.now();

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function animate(now) {
    const elapsed = now - start;
    const t = Math.min(elapsed / duration, 1);
    const eased = easeOutCubic(t);
    currentRotation = startRotation + (finalRotation - startRotation) * eased;
    drawWheel(currentRotation);

    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      finishSpin(targetIndex, finalRotation);
    }
  }

  requestAnimationFrame(animate);
}

function finishSpin(targetIndex, finalRotation) {
  spinning = false;
  setSpinUnlocked(false);
  updateSpinButton();

  if (shouldUseLocalSpinStoreFallback()) {
    window.SpinStore.consumeSpin();
  }

  const computedWinnerIndex = getSegmentIndexFromRotation(finalRotation);
  const targetLabel = prizes[targetIndex].label;
  const computedLabel = prizes[computedWinnerIndex].label;

  const normalizedFinal = normalizeAngle(finalRotation);
  console.log("Spin Debug", {
    targetIndex,
    targetLabel,
    finalRotation: normalizedFinal,
    computedWinnerIndex,
    computedWinnerLabel: computedLabel
  });

  if (computedWinnerIndex !== targetIndex) {
    console.error("Mismatch: using computed winner for UI consistency");
  }

  const winnerIndex = computedWinnerIndex;
  const prize = prizes[winnerIndex];
  resultEl.textContent = `Gewonnen: ${prize.label}`;
  highlightPrize(winnerIndex);
  addRecentWin(prize.label);
  launchConfetti();

  if (emailInput) emailInput.value = "";
  setEmailGateLocked(false);
  emailConfirmBtn.textContent = "E-Mail bestätigen";
  setEmailStatus("Für den nächsten Dreh neue E-Mail nötig.", "info");
}

function highlightPrize(index) {
  prizeList.querySelectorAll("li").forEach((li) => {
    li.classList.toggle("active", Number(li.dataset.index) === index);
  });
}

function launchConfetti() {
  confetti = Array.from({ length: 80 }, () => ({
    x: wheel.width / 2,
    y: wheel.height / 2,
    vx: (Math.random() - 0.5) * 8,
    vy: Math.random() * -6 - 2,
    life: 60 + Math.random() * 20,
    color: Math.random() > 0.5 ? "#d62828" : "#1d4ed8"
  }));
  requestAnimationFrame(confettiTick);
}

function confettiTick() {
  confetti.forEach((p) => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.2;
    p.life -= 1;
  });
  confetti = confetti.filter((p) => p.life > 0);
  drawWheel(currentRotation);
  if (confetti.length) requestAnimationFrame(confettiTick);
}

function drawConfetti() {
  ctx.save();
  confetti.forEach((p) => {
    ctx.globalAlpha = Math.max(p.life / 80, 0);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 6, 6);
  });
  ctx.restore();
}

function resizeCanvas() {
  const size = Math.min(520, window.innerWidth * 0.86);
  wheel.width = size;
  wheel.height = size;
  drawWheel(currentRotation);
}

function debugSimulateSpins(count = 1000) {
  const freq = Array(segmentCount).fill(0);
  for (let i = 0; i < count; i++) {
    const targetIndex = weightedPick(prizes);
    const finalRotation = computeFinalRotation(targetIndex, 0);
    const computed = getSegmentIndexFromRotation(finalRotation);
    freq[computed] += 1;
  }
  console.log("Debug Sim", freq, "(indexes correspond to prizes order)");
}

spinBtn.addEventListener("click", spin);
emailConfirmBtn.addEventListener("click", claimSpin);

if (emailInput) {
  emailInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      claimSpin();
    }
  });
}

document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" && e.key !== " ") return;
  if (e.repeat) return;

  const target = e.target;
  const tagName = target && target.tagName ? target.tagName.toLowerCase() : "";
  const isEditable =
    tagName === "input" ||
    tagName === "textarea" ||
    (target && target.isContentEditable);

  if (isEditable) return;

  e.preventDefault();
  if (!spinning && spinUnlocked) spinBtn.click();
});

themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  setTheme(current === "dark" ? "light" : "dark");
});

window.addEventListener("resize", resizeCanvas);

initTheme();
loadRecentWins();
renderRecentWins();
resizeCanvas();
setSpinUnlocked(false);
if (emailConfirmBtn) emailConfirmBtn.disabled = true;
setEmailStatus("Lade TLD-Liste...", "info");
// debugSimulateSpins(1000);
