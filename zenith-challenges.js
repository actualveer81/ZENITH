/* ═══════════════════════════════════════════════════════════════
   ZENITH — Focus Challenges  (#15)
   ─────────────────────────────────────────────────────────────
   Three high-retention challenge modes that modify how sessions
   are recorded and what rewards are given.

   Challenges:
     1. 7-Day Discipline Reset
        One session per day for 7 days straight.
        Resets burnout risk. Awards 500 XP + badge on completion.

     2. Deep Work Marathon
        Complete 5 × 50-min deep sessions in 72 hours.
        Awards 1000 XP + "Deep Architect" skill unlock.

     3. Dopamine Detox Mode
        For 24 hours: only standard/recovery modes, no music,
        distraction lock auto-engages, phone-friendly session caps.
        Awards 300 XP + "Stillness" skill unlock.

   Storage: zenith_challenges_v1  (single localStorage key)
   UI: a Challenges card injected into the Stats section.
   Hook: piggybacks on window.updateFocusScore (no app.js edits).
═══════════════════════════════════════════════════════════════ */
"use strict";

const ZenithChallenges = (() => {

  const STORE_KEY = "zenith_challenges_v1";

  /* ════════════════════════════════════════════
     CHALLENGE DEFINITIONS
  ════════════════════════════════════════════ */
  const DEFINITIONS = {
    discipline_reset: {
      id:          "discipline_reset",
      name:        "7-Day Discipline Reset",
      icon:        "🔥",
      color:       "#f59e0b",
      tagline:     "One session a day for 7 days straight.",
      description: "Rebuild your baseline. A single focus session each day counts — quality beats quantity. Completes at midnight on day 7.",
      durationDays: 7,
      xpReward:    500,
      skillUnlock: null,
      badge:       "discipline_reset_complete",
      rules: {
        sessionsPerDay: 1,      // minimum 1 session per calendar day
        minDurationMin: 15,     // session must be ≥ 15 min to count
        anyMode:        true,
      },
    },

    deep_marathon: {
      id:          "deep_marathon",
      name:        "Deep Work Marathon",
      icon:        "🎯",
      color:       "#00e5c0",
      tagline:     "5 × 50-minute deep sessions in 72 hours.",
      description: "Push into extended focus. Only Deep Work or Creative sessions of 45 min or longer count toward the marathon.",
      durationDays: 3,
      xpReward:    1000,
      skillUnlock: "deep_arch",
      badge:       "deep_marathon_complete",
      rules: {
        targetSessions: 5,
        minDurationMin: 45,
        allowedModes:   ["deep", "creative"],
      },
    },

    dopamine_detox: {
      id:          "dopamine_detox",
      name:        "Dopamine Detox Mode",
      icon:        "🧘",
      color:       "#a78bfa",
      tagline:     "24 hours of intentional, distraction-free work.",
      description: "No music. Distraction lock auto-engages. Only standard or recovery modes. A single distraction capture fails the session.",
      durationDays: 1,
      xpReward:    300,
      skillUnlock: "stillness",
      badge:       "dopamine_detox_complete",
      rules: {
        noMusic:          true,
        autoLock:         true,
        allowedModes:     ["standard", "recovery", "burnout"],
        maxDistractions:  0,    // 0 = none allowed per session
      },
    },
  };

  /* ════════════════════════════════════════════
     STATE  (persisted to localStorage)
   {
     active: null | { id, startTs, progress:{} }
     history: [{ id, startTs, endTs, completed, xpEarned }]
   }
  ════════════════════════════════════════════ */
  function _load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); }
    catch { return {}; }
  }

  function _save(state) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
  }

  function _state() {
    const s = _load();
    return {
      active:  s.active  ?? null,
      history: s.history ?? [],
    };
  }

  /* ════════════════════════════════════════════
     START / STOP / ABANDON
  ════════════════════════════════════════════ */
  function startChallenge(id) {
    const def = DEFINITIONS[id];
    if (!def) return { ok: false, error: "Unknown challenge" };

    const current = _state();
    if (current.active) return { ok: false, error: "A challenge is already active. Abandon it first." };

    const active = {
      id,
      startTs:  Date.now(),
      progress: _initProgress(def),
    };

    _save({ active, history: current.history });
    _applyRules(def);
    render();

    return { ok: true };
  }

  function abandonChallenge() {
    const s = _state();
    if (!s.active) return;

    s.history.push({
      id:        s.active.id,
      startTs:   s.active.startTs,
      endTs:     Date.now(),
      completed: false,
      xpEarned:  0,
    });

    _removeRules(s.active.id);
    _save({ active: null, history: s.history });
    render();
  }

  function _initProgress(def) {
    if (def.id === "discipline_reset") {
      return { daysCompleted: 0, lastDay: null, sessionsToday: 0 };
    }
    if (def.id === "deep_marathon") {
      return { sessionsCompleted: 0, target: def.rules.targetSessions };
    }
    if (def.id === "dopamine_detox") {
      return { sessionsCompleted: 0, failed: false };
    }
    return {};
  }

  /* ════════════════════════════════════════════
     RULE ENFORCEMENT
     Called on startChallenge to activate constraints.
  ════════════════════════════════════════════ */
  function _applyRules(def) {
    /* Dopamine Detox specific overrides */
    if (def.id === "dopamine_detox") {
      /* Disable music — persist so app.js reads it */
      localStorage.setItem("zenith_challenge_no_music", "1");
      /* Auto-engage lock on next session start (handled in session hook) */
      localStorage.setItem("zenith_challenge_auto_lock", "1");
    }
  }

  function _removeRules(id) {
    const def = DEFINITIONS[id];
    if (!def) return;
    if (def.id === "dopamine_detox") {
      localStorage.removeItem("zenith_challenge_no_music");
      localStorage.removeItem("zenith_challenge_auto_lock");
    }
  }

  /* ════════════════════════════════════════════
     SESSION HOOK — called after every focus session
  ════════════════════════════════════════════ */
  function onSessionComplete(sessionMeta) {
    const s = _state();
    if (!s.active) return;

    const def = DEFINITIONS[s.active.id];
    if (!def) return;

    /* Check expiry */
    const elapsed = Date.now() - s.active.startTs;
    const maxMs   = def.durationDays * 24 * 60 * 60 * 1000;
    if (elapsed > maxMs) {
      _expireChallenge(s, def);
      return;
    }

    const mode     = sessionMeta.mode     ?? window.activeMode ?? "standard";
    const duration = sessionMeta.duration ?? 25;
    const today    = new Date().toDateString();

    /* ── 7-Day Discipline Reset ── */
    if (def.id === "discipline_reset") {
      const p = s.active.progress;
      if (duration < def.rules.minDurationMin) {
        _showToast("Session too short to count for the reset. Need ≥ 15 min.", "warn");
        _save(s); return;
      }
      if (p.lastDay !== today) {
        p.daysCompleted++;
        p.lastDay       = today;
        p.sessionsToday = 1;
        _showToast(`🔥 Day ${p.daysCompleted}/7 complete!`, "ok");
      } else {
        p.sessionsToday++;
      }
      if (p.daysCompleted >= 7) { _completeChallenge(s, def); return; }
    }

    /* ── Deep Work Marathon ── */
    if (def.id === "deep_marathon") {
      const p = s.active.progress;
      const allowed = def.rules.allowedModes;
      if (!allowed.includes(mode)) {
        _showToast(`Only ${allowed.join(" / ")} sessions count for the marathon.`, "warn");
        _save(s); return;
      }
      if (duration < def.rules.minDurationMin) {
        _showToast(`Session must be ≥ ${def.rules.minDurationMin} min for the marathon.`, "warn");
        _save(s); return;
      }
      p.sessionsCompleted++;
      _showToast(`🎯 ${p.sessionsCompleted}/${p.target} marathon sessions done!`, "ok");
      if (p.sessionsCompleted >= p.target) { _completeChallenge(s, def); return; }
    }

    /* ── Dopamine Detox ── */
    if (def.id === "dopamine_detox") {
      const p = s.active.progress;
      if (p.failed) { _save(s); return; }

      const allowed = def.rules.allowedModes;
      if (!allowed.includes(mode)) {
        p.failed = true;
        _showToast(`🧘 Detox broken — ${mode} mode not allowed. Challenge failed.`, "fail");
        _expireChallenge(s, def, /* failed= */ true);
        return;
      }
      p.sessionsCompleted++;
      _showToast("🧘 Detox session complete. Stay intentional.", "ok");
    }

    _save(s);
    render();
  }

  /* ── Complete ── */
  function _completeChallenge(s, def) {
    /* Award XP */
    if (def.xpReward > 0) {
      try {
        /* xp is a let in app.js — write via localStorage and trigger update */
        const currentXp = Number(localStorage.getItem("xp") || 0);
        localStorage.setItem("xp", currentXp + def.xpReward);
        if (typeof checkSkillUnlocks === "function") checkSkillUnlocks(currentXp + def.xpReward);
        if (typeof updateUI === "function") updateUI();
      } catch {}
    }

    /* Unlock skill */
    if (def.skillUnlock) {
      try {
        const skills = JSON.parse(localStorage.getItem("unlockedSkills") || "[]");
        if (!skills.includes(def.skillUnlock)) {
          skills.push(def.skillUnlock);
          localStorage.setItem("unlockedSkills", JSON.stringify(skills));
        }
      } catch {}
    }

    /* Record badge */
    try {
      const achievements = JSON.parse(localStorage.getItem("unlockedAchievements") || "{}");
      achievements[def.badge] = new Date().toISOString();
      localStorage.setItem("unlockedAchievements", JSON.stringify(achievements));
    } catch {}

    /* Record in history */
    s.history.push({
      id:        s.active.id,
      startTs:   s.active.startTs,
      endTs:     Date.now(),
      completed: true,
      xpEarned:  def.xpReward,
    });

    _removeRules(s.active.id);
    _save({ active: null, history: s.history });

    /* Completion modal */
    _showCompletionModal(def);
    render();

    /* Sync if connected */
    window.ZenithSync?.push?.(["xp", "unlockedSkills", "unlockedAchievements"]);
  }

  function _expireChallenge(s, def, failed = false) {
    s.history.push({
      id:        s.active.id,
      startTs:   s.active.startTs,
      endTs:     Date.now(),
      completed: false,
      xpEarned:  0,
      expired:   !failed,
      failed:    failed,
    });
    _removeRules(s.active.id);
    _save({ active: null, history: s.history });
    if (!failed) _showToast(`${def.icon} ${def.name} expired. Start again when ready.`, "warn");
    render();
  }

  /* ════════════════════════════════════════════
     COMPLETION MODAL
  ════════════════════════════════════════════ */
  function _showCompletionModal(def) {
    const existing = document.getElementById("znChallengeModal");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.id        = "znChallengeModal";
    modal.className = "znch-modal-wrap";
    modal.innerHTML = `
      <div class="znch-modal" style="--ch-color:${def.color}">
        <div class="znch-modal-icon">${def.icon}</div>
        <div class="znch-modal-glow" aria-hidden="true"></div>
        <h2 class="znch-modal-title">Challenge Complete</h2>
        <p class="znch-modal-name">${def.name}</p>
        <div class="znch-modal-rewards">
          <div class="znch-reward-pill">+${def.xpReward} XP</div>
          ${def.skillUnlock ? `<div class="znch-reward-pill">🔓 ${def.skillUnlock} unlocked</div>` : ""}
          <div class="znch-reward-pill">🏅 Badge earned</div>
        </div>
        <button class="znch-modal-close" onclick="document.getElementById('znChallengeModal').remove()">
          Claim Rewards
        </button>
      </div>
    `;

    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add("znch-modal-in"));
  }

  /* ════════════════════════════════════════════
     UI — CHALLENGES CARD
  ════════════════════════════════════════════ */
  function _ensureCard() {
    if (document.getElementById("znChallengesCard")) return;

    const grid = document.querySelector(".desktop-stats-grid")
      || document.getElementById("statsSection");
    if (!grid) return;

    const card = document.createElement("div");
    card.className = "card";
    card.id        = "znChallengesCard";
    card.innerHTML = `
      <div class="card-label">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
        </svg>
        Focus Challenges
      </div>
      <div id="znChallengesBody"></div>
    `;

    grid.appendChild(card);
  }

  function render() {
    _ensureCard();
    const body = document.getElementById("znChallengesBody");
    if (!body) return;

    const s       = _state();
    const active  = s.active ? DEFINITIONS[s.active.id] : null;
    const history = s.history;

    /* Active challenge block */
    const activeHtml = active ? _renderActive(s.active, active) : "";

    /* Available challenges */
    const availHtml = Object.values(DEFINITIONS).map(def => {
      const isActive    = s.active?.id === def.id;
      const completions = history.filter(h => h.id === def.id && h.completed).length;
      return _renderChallengeRow(def, isActive, completions, !!s.active && !isActive);
    }).join("");

    /* History */
    const histHtml = history.length
      ? `<div class="znch-history-label">Recent</div>` +
        history.slice(-5).reverse().map(h => {
          const def = DEFINITIONS[h.id];
          const dt  = new Date(h.endTs).toLocaleDateString("en", { month:"short", day:"numeric" });
          return `
            <div class="znch-history-row">
              <span>${def?.icon ?? "?"}</span>
              <span class="znch-history-name">${def?.name ?? h.id}</span>
              <span class="znch-history-result ${h.completed ? "znch-ok" : "znch-fail"}">
                ${h.completed ? `+${h.xpEarned} XP ✓` : "abandoned"}
              </span>
              <span class="znch-history-date">${dt}</span>
            </div>`;
        }).join("")
      : "";

    body.innerHTML = activeHtml + availHtml + histHtml;
  }

  function _renderActive(active, def) {
    const elapsed    = Date.now() - active.startTs;
    const maxMs      = def.durationDays * 24 * 60 * 60 * 1000;
    const pct        = Math.min(100, Math.round((elapsed / maxMs) * 100));
    const remaining  = Math.max(0, Math.ceil((maxMs - elapsed) / 3_600_000));
    const p          = active.progress;

    let progressLine = "";
    if (def.id === "discipline_reset") {
      const bars = Array.from({length:7},(_,i)=>
        `<span class="znch-day-dot ${i < p.daysCompleted ? "znch-dot-done":""}" title="Day ${i+1}"></span>`
      ).join("");
      progressLine = `<div class="znch-day-row">${bars}</div>
        <div class="znch-prog-label">${p.daysCompleted}/7 days · ${remaining}h left</div>`;
    } else if (def.id === "deep_marathon") {
      progressLine = `<div class="znch-prog-label">${p.sessionsCompleted}/${p.target} sessions · ${remaining}h left</div>`;
    } else if (def.id === "dopamine_detox") {
      progressLine = `<div class="znch-prog-label">${p.sessionsCompleted} sessions · ${remaining}h left${p.failed?" · FAILED":""}</div>`;
    }

    return `
      <div class="znch-active-block" style="--ch-color:${def.color}">
        <div class="znch-active-header">
          <span class="znch-active-icon">${def.icon}</span>
          <div class="znch-active-info">
            <div class="znch-active-name">${def.name}</div>
            <div class="znch-active-tag">Active</div>
          </div>
          <button class="znch-abandon-btn"
            onclick="ZenithChallenges._confirmAbandon()"
            title="Abandon challenge">✕</button>
        </div>
        <div class="znch-active-progress">
          <div class="znch-prog-track">
            <div class="znch-prog-fill" style="width:${pct}%"></div>
          </div>
          ${progressLine}
        </div>
      </div>`;
  }

  function _renderChallengeRow(def, isActive, completions, blocked) {
    return `
      <div class="znch-row ${blocked ? "znch-row-blocked" : ""}">
        <div class="znch-row-icon" style="color:${def.color}">${def.icon}</div>
        <div class="znch-row-info">
          <div class="znch-row-name">${def.name}</div>
          <div class="znch-row-tag">${def.tagline}</div>
          ${completions > 0
            ? `<div class="znch-row-completions">Completed ${completions}× · +${def.xpReward} XP each</div>`
            : `<div class="znch-row-reward">+${def.xpReward} XP${def.skillUnlock ? " + skill unlock" : ""}</div>`}
        </div>
        <button class="znch-start-btn"
          style="--ch-color:${def.color}"
          ${isActive || blocked ? "disabled" : ""}
          onclick="ZenithChallenges._startFromUI('${def.id}')">
          ${isActive ? "Active" : "Start"}
        </button>
      </div>`;
  }

  /* ── Confirm abandon ── */
  function _confirmAbandon() {
    if (confirm("Abandon this challenge? Progress will be lost.")) {
      abandonChallenge();
    }
  }

  function _startFromUI(id) {
    const result = startChallenge(id);
    if (!result.ok) _showToast(result.error, "warn");
    else {
      const def = DEFINITIONS[id];
      _showToast(`${def.icon} ${def.name} started! Good luck.`, "ok");
    }
  }

  /* ════════════════════════════════════════════
     TOAST
  ════════════════════════════════════════════ */
  function _showToast(msg, type = "ok") {
    const t = document.createElement("div");
    t.className   = `znch-toast znch-toast-${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("znch-toast-in"));
    setTimeout(() => {
      t.classList.add("znch-toast-out");
      setTimeout(() => t.remove(), 400);
    }, type === "fail" ? 6000 : 3500);
  }

  /* ════════════════════════════════════════════
     AUTO-INTEGRATION
  ════════════════════════════════════════════ */
  function _checkExpiry() {
    const s = _state();
    if (!s.active) return;
    const def     = DEFINITIONS[s.active.id];
    const elapsed = Date.now() - s.active.startTs;
    const maxMs   = def.durationDays * 24 * 60 * 60 * 1000;
    if (elapsed > maxMs) _expireChallenge(s, def);
  }

  document.addEventListener("DOMContentLoaded", () => {
    render();
    _checkExpiry();

    /* Hook session complete */
    const origUpdateFocus = window.updateFocusScore;
    window.updateFocusScore = function (...args) {
      origUpdateFocus?.apply(this, args);

      /* Gather session metadata — prefer live Session object which is always
         populated at completion time; only fall back to the log if needed. */
      const currentMode     = window.activeMode ?? "standard";
      const currentDuration = window.Session?.total
        ? Math.round(window.Session.total / 60)
        : (window.settings?.focus ?? 25);

      /* Also try the session log as a cross-check */
      let logDuration = currentDuration;
      try {
        const log = JSON.parse(localStorage.getItem("zenith_session_log_v2") || "[]");
        if (log.length > 0) {
          const last = log[log.length - 1];
          if (last?.duration) logDuration = last.duration;
        }
      } catch { /* ignore — use live values */ }

      onSessionComplete({
        mode:     currentMode,
        duration: logDuration,
      });
    };

    /* Enforce dopamine detox rules on session start */
    const origToggleTimer = window.toggleTimer;
    if (typeof origToggleTimer === "function") {
      window.toggleTimer = function (...args) {
        /* No-music enforcement */
        if (localStorage.getItem("zenith_challenge_no_music") === "1") {
          if (typeof handleFocusMusic === "function") handleFocusMusic("stop");
        }
        /* Auto-lock */
        if (localStorage.getItem("zenith_challenge_auto_lock") === "1") {
          if (window.Session?.state === "idle" || window.Session?.state === "completed") {
            setTimeout(() => window.DistractionLock?.engage?.("Dopamine Detox"), 300);
          }
        }
        return origToggleTimer.apply(this, args);
      };
    }

    /* Re-render when stats tab opens */
    const statsSection = document.getElementById("statsSection");
    if (statsSection) {
      new MutationObserver(() => {
        if (statsSection.classList.contains("active")) render();
      }).observe(statsSection, { attributes: true, attributeFilter: ["class"] });
    }

    /* Check expiry every hour */
    setInterval(_checkExpiry, 60 * 60 * 1000);
  });

  return {
    startChallenge, abandonChallenge, onSessionComplete, render,
    _startFromUI, _confirmAbandon, getState: _state,
  };
})();

window.ZenithChallenges = ZenithChallenges;
