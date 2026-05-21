/* ═══════════════════════════════════════════════════════════════
   ZENITH — Session Replay Analytics  (#10)
   ─────────────────────────────────────────────────────────────
   Tracks what actually happens during each focus session and
   renders three new visualisations in the Stats section.

   What it tracks:
     · Tab switches (from DistractionLock visibilitychange)
     · Idle periods  (from DistractionLock idle detection)
     · Distraction captures (from app.js captureDistraction)
     · Session start / end timestamps

   New metrics computed per session:
     · Discipline Score  — (focused_ms / total_ms) × 100
     · Focus continuity  — longest uninterrupted focus streak
     · Interruption rate — events per hour

   UI added to Stats section (injected, no index.html edit needed):
     1. Discipline Score gauge  — big ring, live after each session
     2. Focus Timeline          — session-by-session swimlane chart
     3. Session Replay Cards    — last 5 sessions with event detail

   HTML injection target: #statsSection > .desktop-stats-grid
     (appended as the last card automatically)

   CSS: phase3.css
   Requires: zenith-db.js loaded first (ZenithDB)
═══════════════════════════════════════════════════════════════ */
"use strict";

/* ════════════════════════════════════════════
   EVENT BUS — receives events from lock + app
════════════════════════════════════════════ */
const SessionReplay = (() => {

  const LS_KEY    = "zenith_replay_sessions_v1";
  const MAX_STORE = 50;            // keep last 50 sessions

  let _currentSession = null;      // active recording
  let _allSessions    = null;      // lazy-loaded cache

  /* ── Load / Save ── */
  function _load() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); }
    catch { return []; }
  }

  function _save(sessions) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(sessions.slice(-MAX_STORE)));
    } catch { /* quota — drop oldest */ }
  }

  /* ════════════════════════════════════════════
     RECORDING API
  ════════════════════════════════════════════ */

  /** Called by DistractionLock for every in-session event */
  function logEvent(ev) {
    if (!_currentSession) return;
    _currentSession.events.push({ ...ev, ts: ev.ts ?? Date.now() });
  }

  /** Start a new replay recording */
  function startSession(meta = {}) {
    _currentSession = {
      id:        Date.now(),
      startTs:   Date.now(),
      endTs:     null,
      mode:      meta.mode       ?? window.activeMode ?? "standard",
      duration:  meta.duration   ?? (window.settings?.focus ?? 25),
      events:    [],
    };
  }

  /** Finalise the recording and persist it */
  function endSession() {
    if (!_currentSession) return null;

    _currentSession.endTs  = Date.now();
    _currentSession.score  = _computeScore(_currentSession);

    const all = _load();
    all.push(_currentSession);
    _save(all);
    _allSessions = null; // bust cache

    /* Also write to IndexedDB if available */
    window.ZenithDB?.onReady?.(() => {
      window.ZenithDB.replay
        .addBatch(_currentSession.events, _currentSession.id)
        .catch(() => {});
    });

    const finished = _currentSession;
    _currentSession = null;

    /* Re-render dashboard */
    SessionReplayUI.render();

    return finished;
  }

  /* ════════════════════════════════════════════
     DISCIPLINE SCORE  [0 → 100]
  ════════════════════════════════════════════ */
  function _computeScore(session) {
    const totalMs  = (session.endTs ?? Date.now()) - session.startTs;
    if (totalMs <= 0) return 100;

    /* Accumulate idle time */
    let idleMs   = 0;
    let idleOpen = null;

    for (const ev of session.events) {
      if (ev.type === "idle_start") { idleOpen = ev.ts; }
      if (ev.type === "idle_end"  && idleOpen) {
        idleMs  += (ev.ts - idleOpen);
        idleOpen = null;
      }
    }
    /* Close any open idle that reached session end */
    if (idleOpen) idleMs += (session.endTs ?? Date.now()) - idleOpen;

    /* Tab switches cost 30 s each (soft penalty) */
    const switches   = session.events.filter(e => e.type === "tab_switch").length;
    const switchPen  = switches * 30_000;

    const focusedMs  = Math.max(0, totalMs - idleMs - switchPen);
    return Math.round((focusedMs / totalMs) * 100);
  }

  /* ════════════════════════════════════════════
     TIMELINE BUILDER
     Returns segment array for the swimlane chart:
     [{start, end, type: "focus"|"idle"|"switch"}]
  ════════════════════════════════════════════ */
  function buildTimeline(session) {
    const total  = (session.endTs ?? Date.now()) - session.startTs;
    const segs   = [];
    let   cursor = session.startTs;

    const sorted = [...session.events].sort((a, b) => a.ts - b.ts);

    for (const ev of sorted) {
      const elapsed = ev.ts - cursor;

      if (ev.type === "idle_start" && elapsed > 0) {
        segs.push({ type: "focus", start: cursor, end: ev.ts });
        cursor = ev.ts;
      }

      if (ev.type === "idle_end") {
        segs.push({ type: "idle", start: cursor, end: ev.ts });
        cursor = ev.ts;
      }

      if (ev.type === "tab_switch") {
        /* Point event — show a 15s marker */
        const markerEnd = Math.min(ev.ts + 15_000, session.endTs ?? Date.now());
        if (ev.ts > cursor) {
          segs.push({ type: "focus", start: cursor, end: ev.ts });
        }
        segs.push({ type: "switch", start: ev.ts, end: markerEnd });
        cursor = markerEnd;
      }
    }

    /* Close with remaining focus */
    const sessionEnd = session.endTs ?? Date.now();
    if (cursor < sessionEnd) {
      segs.push({ type: "focus", start: cursor, end: sessionEnd });
    }

    /* Normalise to 0-1 range */
    return segs.map(s => ({
      type:  s.type,
      from:  (s.start - session.startTs) / total,
      to:    (s.end   - session.startTs) / total,
    }));
  }

  /* ── Data access ── */
  function getAllSessions() {
    if (!_allSessions) _allSessions = _load();
    return _allSessions;
  }

  function getLastSessions(n = 10) {
    return getAllSessions().slice(-n).reverse();
  }

  function getAverageScore() {
    const all = getAllSessions().filter(s => s.score != null);
    if (!all.length) return null;
    return Math.round(all.reduce((s, e) => s + e.score, 0) / all.length);
  }

  return {
    logEvent,
    startSession,
    endSession,
    getAllSessions,
    getLastSessions,
    getAverageScore,
    buildTimeline,
    _computeScore,
  };
})();

window.SessionReplay = SessionReplay;


/* ════════════════════════════════════════════
   SESSION REPLAY UI RENDERER
════════════════════════════════════════════ */
const SessionReplayUI = (() => {

  /* ── Inject card into stats grid on first call ── */
  function _ensureCard() {
    if (document.getElementById("replayCard")) return;

    const grid = document.querySelector(".desktop-stats-grid")
      || document.getElementById("statsSection");
    if (!grid) return;

    const card = document.createElement("div");
    card.className = "card";
    card.id        = "replayCard";
    card.innerHTML = `
      <!-- DISCIPLINE SCORE -->
      <div class="card-label">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        Session Replay Analytics
      </div>

      <div class="sr-discipline-row">
        <div class="sr-gauge-wrap">
          <svg class="sr-gauge-svg" viewBox="0 0 100 100" id="srGaugeSvg"></svg>
          <div class="sr-gauge-center">
            <div class="sr-gauge-val" id="srGaugeVal">--</div>
            <div class="sr-gauge-lbl">Discipline</div>
          </div>
        </div>
        <div class="sr-score-meta">
          <div class="sr-meta-row">
            <span class="sr-meta-label">Avg Discipline</span>
            <span class="sr-meta-val" id="srAvgScore">--</span>
          </div>
          <div class="sr-meta-row">
            <span class="sr-meta-label">Tab Switches (last)</span>
            <span class="sr-meta-val" id="srSwitches">--</span>
          </div>
          <div class="sr-meta-row">
            <span class="sr-meta-label">Idle Time (last)</span>
            <span class="sr-meta-val" id="srIdleTime">--</span>
          </div>
          <div class="sr-meta-row">
            <span class="sr-meta-label">Sessions Recorded</span>
            <span class="sr-meta-val" id="srTotalRec">--</span>
          </div>
        </div>
      </div>

      <hr class="card-divider">

      <!-- FOCUS TIMELINE -->
      <div class="card-label" style="margin-top:0">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        Focus Timeline
      </div>
      <p class="sr-timeline-hint">Each row is one session. <span class="sr-legend">
        <span class="sr-leg-focused">Focused</span>
        <span class="sr-leg-idle">Idle</span>
        <span class="sr-leg-switch">Switch</span>
      </span></p>
      <div class="sr-timeline" id="srTimeline">
        <div class="sr-empty">Complete sessions to build replay data.</div>
      </div>

      <hr class="card-divider">

      <!-- RECENT SESSION CARDS -->
      <div class="card-label" style="margin-top:0">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2">
          <rect x="2" y="3" width="20" height="14" rx="2"/>
          <line x1="8" y1="21" x2="16" y2="21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        Session Breakdown
      </div>
      <div class="sr-sessions-list" id="srSessionsList">
        <div class="sr-empty">No sessions recorded yet.</div>
      </div>
    `;

    grid.appendChild(card);
  }

  /* ── Main render ── */
  function render() {
    _ensureCard();

    const sessions = SessionReplay.getLastSessions(8);
    const avgScore = SessionReplay.getAverageScore();
    const allSess  = SessionReplay.getAllSessions();
    const last     = sessions[0] ?? null;

    /* Gauge */
    _renderGauge(last?.score ?? null);
    _setText("srGaugeVal",  last?.score != null ? last.score : "--");
    _setText("srAvgScore",  avgScore != null ? `${avgScore}/100` : "--");
    _setText("srTotalRec",  allSess.length);

    if (last) {
      const switches = last.events.filter(e => e.type === "tab_switch").length;
      const idleMs   = last.events
        .filter(e => e.type === "idle_end" && e.duration)
        .reduce((s, e) => s + e.duration, 0);
      _setText("srSwitches", switches);
      _setText("srIdleTime",  idleMs > 0 ? `${Math.round(idleMs / 60000)}m` : "0m");
    }

    /* Timeline */
    _renderTimeline(sessions);

    /* Session cards */
    _renderSessionCards(sessions);
  }

  /* ── Discipline Score Ring ── */
  function _renderGauge(score) {
    const svg = document.getElementById("srGaugeSvg");
    if (!svg) return;

    const R   = 38;
    const C   = 2 * Math.PI * R;
    const pct = score != null ? Math.max(0, Math.min(100, score)) : 0;
    const dash = (pct / 100) * C;

    const color =
      pct >= 80 ? "var(--accent, #00e5c0)" :
      pct >= 60 ? "#4f9cf9"  :
      pct >= 40 ? "#f59e0b"  : "#f87171";

    svg.innerHTML = `
      <circle cx="50" cy="50" r="${R}" fill="none"
        stroke="rgba(255,255,255,.07)" stroke-width="9"/>
      <circle cx="50" cy="50" r="${R}" fill="none"
        stroke="${color}" stroke-width="9"
        stroke-linecap="round"
        stroke-dasharray="${dash.toFixed(1)} ${C.toFixed(1)}"
        stroke-dashoffset="${(C / 4).toFixed(1)}"
        style="transition:stroke-dasharray .9s cubic-bezier(.34,1.56,.64,1)"/>
    `;
  }

  /* ── Swimlane Timeline ── */
  function _renderTimeline(sessions) {
    const container = document.getElementById("srTimeline");
    if (!container) return;

    if (!sessions.length) {
      container.innerHTML = `<div class="sr-empty">Complete sessions to build replay data.</div>`;
      return;
    }

    container.innerHTML = sessions.map(sess => {
      const segs   = SessionReplay.buildTimeline(sess);
      const mode   = sess.mode ?? "standard";
      const score  = sess.score ?? 0;
      const dur    = sess.duration ?? Math.round(((sess.endTs ?? sess.startTs) - sess.startTs) / 60000);
      const label  = new Date(sess.startTs).toLocaleDateString("en", { weekday:"short", month:"short", day:"numeric" });

      const bars = segs.map(s => {
        const w = Math.max(0.5, (s.to - s.from) * 100);
        return `<div class="sr-seg sr-seg-${s.type}" style="width:${w.toFixed(1)}%" title="${s.type}"></div>`;
      }).join("");

      const scoreClass = score >= 80 ? "sr-score-elite" : score >= 60 ? "sr-score-ok" : "sr-score-low";

      return `
        <div class="sr-row">
          <div class="sr-row-label">
            <span class="sr-row-date">${label}</span>
            <span class="sr-row-mode">${mode}</span>
          </div>
          <div class="sr-bar-wrap">${bars}</div>
          <div class="sr-row-score ${scoreClass}">${score}</div>
        </div>`;
    }).join("");
  }

  /* ── Session Detail Cards ── */
  function _renderSessionCards(sessions) {
    const container = document.getElementById("srSessionsList");
    if (!container) return;

    if (!sessions.length) {
      container.innerHTML = `<div class="sr-empty">No sessions recorded yet.</div>`;
      return;
    }

    container.innerHTML = sessions.slice(0, 5).map(sess => {
      const switches   = sess.events.filter(e => e.type === "tab_switch").length;
      const idles      = sess.events.filter(e => e.type === "idle_start").length;
      const distracts  = sess.events.filter(e => e.type === "distraction").length;
      const score      = sess.score ?? 0;
      const time       = new Date(sess.startTs).toLocaleTimeString("en", { hour:"2-digit", minute:"2-digit" });
      const date       = new Date(sess.startTs).toLocaleDateString("en", { month:"short", day:"numeric" });
      const dur        = Math.round(((sess.endTs ?? sess.startTs) - sess.startTs) / 60000);
      const earlyExit  = sess.events.some(e => e.type === "early_exit");

      const scoreColor =
        score >= 80 ? "#00e5c0" : score >= 60 ? "#4f9cf9" : score >= 40 ? "#f59e0b" : "#f87171";

      return `
        <div class="sr-card">
          <div class="sr-card-head">
            <div class="sr-card-title">
              <span class="sr-card-mode">${sess.mode ?? "standard"}</span>
              <span class="sr-card-time">${date} · ${time}</span>
              ${earlyExit ? `<span class="sr-card-badge-exit">early exit</span>` : ""}
            </div>
            <div class="sr-card-disc" style="color:${scoreColor}">${score}<small>/100</small></div>
          </div>
          <div class="sr-card-stats">
            <span class="sr-card-stat">⏱ ${dur}m</span>
            <span class="sr-card-stat ${switches > 0 ? "sr-stat-warn" : ""}">🔀 ${switches} switch${switches !== 1 ? "es" : ""}</span>
            <span class="sr-card-stat ${idles > 0 ? "sr-stat-dim" : ""}">💤 ${idles} idle${idles !== 1 ? "s" : ""}</span>
            <span class="sr-card-stat">📌 ${distracts} distraction${distracts !== 1 ? "s" : ""}</span>
          </div>
        </div>`;
    }).join("");
  }

  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  return { render };
})();

window.SessionReplayUI = SessionReplayUI;


/* ════════════════════════════════════════════
   APP.JS INTEGRATION (no app.js edits needed)
════════════════════════════════════════════ */
(function integrateReplay() {

  document.addEventListener("DOMContentLoaded", () => {

    /* ── Start a replay recording when the timer starts ── */
    const origToggleTimer = window.toggleTimer;
    if (typeof origToggleTimer === "function") {
      window.toggleTimer = function (...args) {
        const wasIdle = window.Session?.state === "idle"
          || window.Session?.state === "completed";
        const result = origToggleTimer.apply(this, args);

        if (wasIdle && window.Session?.state === "running" && window.Session?.mode === "focus") {
          SessionReplay.startSession({
            mode:     window.activeMode ?? "standard",
            duration: window.settings?.focus ?? 25,
          });
        }
        return result;
      };
    }

    /* ── End the recording when the focus session completes ── */
    const origUpdateFocus = window.updateFocusScore;
    window.updateFocusScore = function (...args) {
      origUpdateFocus?.apply(this, args);
      SessionReplay.endSession();
    };

    /* ── Log distraction captures ── */
    const origCapture = window.captureDistraction;
    if (typeof origCapture === "function") {
      window.captureDistraction = function (...args) {
        SessionReplay.logEvent({ type: "distraction", ts: Date.now() });
        return origCapture.apply(this, args);
      };
    }

    /* ── Initial render ── */
    SessionReplayUI.render();

    /* ── Re-render when stats tab opens ── */
    const statsSection = document.getElementById("statsSection");
    if (statsSection) {
      new MutationObserver(() => {
        if (statsSection.classList.contains("active")) SessionReplayUI.render();
      }).observe(statsSection, { attributes: true, attributeFilter: ["class"] });
    }
  });
})();
