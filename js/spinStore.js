(function attachSpinStore(globalScope) {
  const STORAGE_KEY = "gluecksrad_spin_state_v1";
  const CLAIM_DEBOUNCE_MS = 2000;
  let claimLock = false;

  function toLocalDayKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function toNextLocalMidnightTs(nowTs = Date.now()) {
    const next = new Date(nowTs);
    next.setHours(24, 0, 0, 0);
    return next.getTime();
  }

  function normalizeState(raw) {
    const spinsLeft = Number.isFinite(raw?.spinsLeft) ? Math.max(0, Math.floor(raw.spinsLeft)) : 0;
    const lastClaimTs = Number.isFinite(raw?.lastClaimTs) ? Math.max(0, Math.floor(raw.lastClaimTs)) : 0;
    const lastClaimDay = typeof raw?.lastClaimDay === "string" ? raw.lastClaimDay : "";
    const lastAttemptTs = Number.isFinite(raw?.lastAttemptTs)
      ? Math.max(0, Math.floor(raw.lastAttemptTs))
      : 0;

    return {
      spinsLeft,
      lastClaimTs,
      lastClaimDay,
      lastAttemptTs
    };
  }

  function loadState() {
    try {
      const raw = globalScope.localStorage.getItem(STORAGE_KEY);
      if (!raw) return normalizeState({});
      return normalizeState(JSON.parse(raw));
    } catch {
      return normalizeState({});
    }
  }

  function saveState(state) {
    const normalized = normalizeState(state);
    globalScope.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function getSpinState() {
    const state = loadState();
    const todayKey = toLocalDayKey();
    const claimedToday = state.lastClaimDay === todayKey;
    return {
      spinsLeft: state.spinsLeft,
      lastClaimTs: state.lastClaimTs,
      claimedToday,
      nextClaimAt: claimedToday ? toNextLocalMidnightTs() : null
    };
  }

  function claimSpin() {
    if (claimLock) {
      return { ok: false, message: "Bitte kurz warten." };
    }

    claimLock = true;
    try {
      const now = Date.now();
      const todayKey = toLocalDayKey();
      const state = loadState();

      if (state.lastAttemptTs > 0 && now - state.lastAttemptTs < CLAIM_DEBOUNCE_MS) {
        saveState({ ...state, lastAttemptTs: now });
        return { ok: false, message: "Bitte kurz warten." };
      }

      state.lastAttemptTs = now;

      if (state.lastClaimDay === todayKey) {
        const persisted = saveState(state);
        return {
          ok: false,
          spinsLeft: persisted.spinsLeft,
          message: "Heute schon geclaimt. Morgen wieder."
        };
      }

      state.spinsLeft += 1;
      state.lastClaimTs = now;
      state.lastClaimDay = todayKey;
      const persisted = saveState(state);
      return {
        ok: true,
        spinsLeft: persisted.spinsLeft,
        message: "1 Spin erhalten!"
      };
    } finally {
      claimLock = false;
    }
  }

  function consumeSpin() {
    const state = loadState();
    if (state.spinsLeft <= 0) {
      return { ok: false, spinsLeft: 0 };
    }

    state.spinsLeft -= 1;
    const persisted = saveState(state);
    return {
      ok: true,
      spinsLeft: persisted.spinsLeft
    };
  }

  globalScope.SpinStore = {
    getSpinState,
    claimSpin,
    consumeSpin
  };
})(window);
