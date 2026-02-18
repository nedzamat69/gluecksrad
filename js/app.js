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
const spinStore = window.SpinStore || null;

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

function getSpinStateSafe() {
  if (!spinStore) {
    return { spinsLeft: 0, lastClaimTs: 0, claimedToday: false, nextClaimAt: null };
  }
  return spinStore.getSpinState();
}

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

function setClaimGateLocked(locked) {
  if (emailInput) emailInput.disabled = locked;
  if (emailConfirmBtn) emailConfirmBtn.disabled = locked;
}

function formatNextClaimTime(ts) {
  return new Date(ts).toLocaleString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit"
  });
}

function setClaimDefaultStatus() {
  const state = getSpinStateSafe();
  if (state.spinsLeft > 0) {
    setEmailStatus(`Verfügbare Spins: ${state.spinsLeft}`, "success");
    return;
  }

  if (state.claimedToday) {
    const nextAt = state.nextClaimAt ? formatNextClaimTime(state.nextClaimAt) : "morgen";
    setEmailStatus(`Heute schon geclaimt. Nächster Claim: ${nextAt}`, "info");
    return;
  }

  setEmailStatus("Hole dir deinen täglichen Spin über \"Claim Spin\".", "info");
}

function syncClaimUi() {
  const state = getSpinStateSafe();
  const claimBlockedToday = state.claimedToday;

  if (emailConfirmBtn) {
    emailConfirmBtn.disabled = claimInFlight || claimBlockedToday || !spinStore;
    emailConfirmBtn.textContent = claimInFlight
      ? "Claim..."
      : claimBlockedToday
        ? "Heute geclaimt"
        : "Claim Spin";
  }

  if (emailInput) {
    emailInput.value = "";
    emailInput.placeholder = "Statischer Modus: kein Backend nötig";
    emailInput.disabled = true;
  }

  setSpinUnlocked(state.spinsLeft > 0);
}

async function claimSpin() {
  if (!spinStore || !emailConfirmBtn) {
    setEmailStatus("Spin-Store nicht verfügbar.", "error");
    return;
  }

  if (claimInFlight) {
    setEmailStatus("Bitte kurz warten.", "info");
    return;
  }

  claimInFlight = true;
  setClaimGateLocked(true);
  syncClaimUi();

  try {
    const result = spinStore.claimSpin();
    if (result.ok) {
      setEmailStatus(`${result.message} Verfügbare Spins: ${result.spinsLeft}`, "success");
    } else {
      setEmailStatus(result.message || "Claim nicht möglich.", "error");
    }
  } finally {
    claimInFlight = false;
    setClaimGateLocked(false);
    syncClaimUi();
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
  if (spinning || !spinStore) return;
  const consumeResult = spinStore.consumeSpin();
  if (!consumeResult.ok) {
    setSpinUnlocked(false);
    setEmailStatus("Kein Spin verfügbar. Bitte zuerst claimen.", "error");
    syncClaimUi();
    return;
  }

  spinning = true;
  setSpinUnlocked(consumeResult.spinsLeft > 0);
  setEmailStatus(`Spin gestartet. Verbleibende Spins: ${consumeResult.spinsLeft}`, "info");
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
  updateSpinButton();

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

  syncClaimUi();
  setClaimDefaultStatus();
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
syncClaimUi();
if (!spinStore) {
  setEmailStatus("Lokaler Spin-Store konnte nicht geladen werden.", "error");
} else {
  setClaimDefaultStatus();
}
// debugSimulateSpins(1000);
