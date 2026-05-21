/* ═══════════════════════════════════════════════════════════════
   ZENITH — Cognitive Performance Dashboard  (#5 · #10 · #20)
   ─────────────────────────────────────────────────────────────
   Collapses three roadmap items into one finished system:
     #5  Behavioral Analytics Engine  (data collection)
     #10 Session Replay Analytics     (endurance + distraction tracking)
     #20 Cognitive Performance Dashboard (5-metric radar UI)

   Hooks fired by app.js (no app.js edits needed):
     window.updateFocusScore    — called after each focus session
     window.updateRecoveryScore — called after each focus session

   Reads from existing globals (declared in app.js):
     Session.total · activeMode · currentSessionTag
═══════════════════════════════════════════════════════════════ */
"use strict";

/* ════════════════════════════════════════════
   RICH SESSION COLLECTOR
   Stores per-session records with duration,
   distractions, mode, and timestamp.
════════════════════════════════════════════ */
const ZenithCollector = (() => {
  const KEY     = "zenith_session_log_v2";
  const MAX_LOG = 200;

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch { return []; }
  }

  function save(log) {
    try { localStorage.setItem(KEY, JSON.stringify(log.slice(-MAX_LOG))); }
    catch { /* quota exceeded – silently drop oldest */ }
  }

  function record() {
    /* Safely read app.js globals */
    const duration   = Math.round((window.Session?.total ?? 0) / 60); // minutes
    const mode       = window.activeMode ?? "standard";
    const tag        = window.currentSessionTag ?? null;
    const now        = new Date();

    /* Count distractions that happened in the last (duration) minutes */
    const cutoff     = Date.now() - duration * 60 * 1000;
    let distractions = 0;
    try {
      const log = JSON.parse(localStorage.getItem("distractions") || "[]");
      distractions = log.filter(d => d.time > cutoff).length;
    } catch { /* ignore */ }

    const entry = {
      ts:          Date.now(),
      date:        now.toDateString(),
      hour:        now.getHours(),
      dayOfWeek:   now.getDay(),
      duration,        // minutes
      mode,
      tag,
      distractions,
      completed:   true,
    };

    const log = load();
    log.push(entry);
    save(log);

    /* Invalidate analytics cache so next render is fresh */
    window.ZenithAnalytics?.invalidate();
    return entry;
  }

  return { load, record };
})();


/* ════════════════════════════════════════════
   COGNITIVE METRICS COMPUTER
   Extends the base analytics engine with
   Focus Endurance and Distraction Resistance.
════════════════════════════════════════════ */
const ZenithCognitiveMetrics = {

  /**
   * FOCUS ENDURANCE [0-100]
   * Measures ability to sustain long sessions and whether
   * avg session duration is trending up or down.
   */
  focusEndurance(sessions) {
    if (sessions.length < 3) return { score: null, avgMin: 0, trend: "unknown" };

    const MODE_MAX = { deep: 50, creative: 45, standard: 25, sprint: 15, recovery: 10, burnout: 20 };
    const recent   = sessions.slice(-20);
    const older    = sessions.slice(-40, -20);

    const avgRecent = recent.reduce((s, e) => s + e.duration, 0) / recent.length;
    const avgOlder  = older.length
      ? older.reduce((s, e) => s + e.duration, 0) / older.length
      : avgRecent;

    /* Score: proportion of max possible duration in preferred mode */
    const maxPossible = Math.max(...recent.map(e => MODE_MAX[e.mode] || 25));
    const score       = Math.round(Math.min(100, (avgRecent / maxPossible) * 100));

    const trendPct = avgOlder > 0
      ? Math.round(((avgRecent - avgOlder) / avgOlder) * 100)
      : 0;

    const trend = trendPct > 10 ? "improving" : trendPct < -10 ? "declining" : "stable";

    return { score, avgMin: Math.round(avgRecent), trend, trendPct };
  },

  /**
   * DISTRACTION RESISTANCE [0-100]
   * % of sessions with zero distractions, weighted by recency.
   */
  distractionResistance(sessions) {
    if (!sessions.length) return { score: null, rate: 0, cleanSessions: 0 };

    const recent = sessions.slice(-30);
    const n      = recent.length;

    /* Recency-weighted clean sessions */
    let weightedClean = 0, totalWeight = 0;
    recent.forEach((e, i) => {
      const w = 0.5 + 0.5 * (i / n);
      totalWeight += w;
      if (e.distractions === 0) weightedClean += w;
    });

    const score        = Math.round((weightedClean / totalWeight) * 100);
    const cleanSessions = recent.filter(e => e.distractions === 0).length;
    const rate          = parseFloat((recent.reduce((s, e) => s + e.distractions, 0) / n).toFixed(2));

    return { score, rate, cleanSessions, of: n };
  },

  /**
   * Full 5-metric Cognitive Performance report.
   * Returns all five dimensions normalized to [0-100].
   */
  compute() {
    const sessions  = ZenithCollector.load();
    const base      = window.ZenithAnalytics?.compute() ?? {};

    if (!sessions.length && base.insufficient) {
      return { insufficient: true };
    }

    const endurance    = this.focusEndurance(sessions);
    const distraction  = this.distractionResistance(sessions);
    const consistency  = base.consistencyIndex   ?? { score: 0, label: "building" };
    const velocity     = base.sessionVelocity    ?? { direction: "new", pct: 0 };
    const recovery     = base.recoveryEfficiency ?? { score: null };

    /* Normalize velocity to 0-100 */
    const velocityScore =
      velocity.direction === "improving" ? Math.min(100, 75 + Math.abs(velocity.pct))  :
      velocity.direction === "declining" ? Math.max(0,   50 - Math.abs(velocity.pct))  : 62;

    return {
      endurance,
      distraction,
      sessions: sessions.slice(-20),
      /* For radar chart — all 0-100 */
      radar: {
        focusEndurance:        endurance.score      ?? 0,
        recoveryRate:          recovery.score        ?? 0,
        consistencyIndex:      consistency.score     ?? 0,
        productivityVelocity:  velocityScore,
        distractionResistance: distraction.score     ?? 0,
      },
    };
  },
};


/* ════════════════════════════════════════════
   COGNITIVE DASHBOARD RENDERER
════════════════════════════════════════════ */
const ZenithCognitiveDashboard = {

  render() {
    const data = ZenithCognitiveMetrics.compute();
    if (data.insufficient) {
      this._renderEmpty();
      return;
    }
    this._renderRadar(data.radar);
    this._renderMetrics(data);
  },

  /* ── Pentagon Radar Chart ── */
  _renderRadar(radar) {
    const el = document.getElementById("cogRadarSvg");
    if (!el) return;

    const W = 200, H = 200, CX = 100, CY = 105, R = 75;
    const LABELS = ["Endurance", "Recovery", "Consistency", "Velocity", "Distraction\nResistance"];
    const VALUES = [
      radar.focusEndurance,
      radar.recoveryRate,
      radar.consistencyIndex,
      radar.productivityVelocity,
      radar.distractionResistance,
    ];
    const N     = 5;
    const angle = (i) => -Math.PI / 2 + i * (2 * Math.PI / N);
    const pt    = (i, r) => ({
      x: CX + r * Math.cos(angle(i)),
      y: CY + r * Math.sin(angle(i)),
    });

    /* Background rings */
    const rings = [0.25, 0.5, 0.75, 1].map(scale => {
      const pts = Array.from({ length: N }, (_, i) => {
        const p = pt(i, R * scale);
        return `${p.x},${p.y}`;
      }).join(" ");
      return `<polygon points="${pts}" class="radar-ring"/>`;
    });

    /* Axis lines */
    const axes = Array.from({ length: N }, (_, i) => {
      const p = pt(i, R);
      return `<line x1="${CX}" y1="${CY}" x2="${p.x}" y2="${p.y}" class="radar-axis"/>`;
    });

    /* Data polygon */
    const dataPts = VALUES.map((v, i) => {
      const r = (v / 100) * R;
      const p = pt(i, r);
      return `${p.x},${p.y}`;
    }).join(" ");

    /* Label positions (slightly outside R) */
    const labels = LABELS.map((label, i) => {
      const p    = pt(i, R + 18);
      const lines = label.split("\n");
      const textEls = lines.map((line, li) =>
        `<tspan x="${p.x}" dy="${li === 0 ? 0 : 11}">${line}</tspan>`
      ).join("");
      return `<text x="${p.x}" y="${p.y - (lines.length - 1) * 5.5}"
                text-anchor="middle" class="radar-label">${textEls}</text>`;
    });

    /* Value dots */
    const dots = VALUES.map((v, i) => {
      const r = (v / 100) * R;
      const p = pt(i, r);
      return `<circle cx="${p.x}" cy="${p.y}" r="3" class="radar-dot"/>`;
    });

    el.setAttribute("viewBox", `0 0 ${W} ${H}`);
    el.innerHTML = `
      <style>
        .radar-ring  { fill: none; stroke: var(--card-border, rgba(255,255,255,.07)); stroke-width: 1; }
        .radar-axis  { stroke: var(--card-border, rgba(255,255,255,.07)); stroke-width: 1; }
        .radar-area  { fill: var(--accent, #00e5c0); fill-opacity: .12; stroke: var(--accent, #00e5c0); stroke-width: 1.5; stroke-linejoin: round; }
        .radar-dot   { fill: var(--accent, #00e5c0); }
        .radar-label { font-size: 8px; fill: var(--muted, #888); font-family: var(--font-body, sans-serif); }
      </style>
      ${rings.join("")}
      ${axes.join("")}
      <polygon points="${dataPts}" class="radar-area"/>
      ${dots.join("")}
      ${labels.join("")}
    `;
  },

  /* ── 5 Metric Progress Rings ── */
  _renderMetrics({ radar, endurance, distraction }) {
    const metrics = [
      { id: "cogEndurance",    value: radar.focusEndurance,        label: "Endurance",    sub: endurance.avgMin ? `${endurance.avgMin} min avg` : "--" },
      { id: "cogRecovery",     value: radar.recoveryRate,          label: "Recovery",     sub: radar.recoveryRate ? `${radar.recoveryRate}/100` : "No data yet" },
      { id: "cogConsistency",  value: radar.consistencyIndex,      label: "Consistency",  sub: `${radar.consistencyIndex}%` },
      { id: "cogVelocity",     value: radar.productivityVelocity,  label: "Velocity",     sub: window.ZenithAnalytics?.compute()?.sessionVelocity?.direction ?? "--" },
      { id: "cogDistraction",  value: radar.distractionResistance, label: "Distraction\nResistance", sub: distraction.cleanSessions ? `${distraction.cleanSessions}/${distraction.of} clean` : "--" },
    ];

    metrics.forEach(({ id, value, label, sub }) => {
      /* SVG ring */
      const svgEl = document.getElementById(`${id}Ring`);
      if (svgEl) svgEl.innerHTML = this._ringsvg(value ?? 0);

      /* Value text */
      const valEl = document.getElementById(`${id}Val`);
      if (valEl) {
        valEl.textContent = value != null ? value : "--";
        valEl.className   = `cog-metric-val ${this._scoreClass(value)}`;
      }

      /* Sub text */
      const subEl = document.getElementById(`${id}Sub`);
      if (subEl) subEl.textContent = sub;
    });

    /* Endurance trend badge */
    const trendEl = document.getElementById("cogEnduranceTrend");
    if (trendEl && endurance.trend !== "unknown") {
      trendEl.textContent =
        endurance.trend === "improving" ? `↑ ${endurance.trendPct}%` :
        endurance.trend === "declining" ? `↓ ${Math.abs(endurance.trendPct)}%` : "→ Stable";
      trendEl.className = `cog-trend-badge trend-${endurance.trend}`;
    }
  },

  _ringsvg(value) {
    const R = 18, C = 2 * Math.PI * R;
    const fill = Math.max(0, Math.min(100, value));
    const dash = (fill / 100) * C;
    return `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <circle cx="22" cy="22" r="${R}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="4"/>
      <circle cx="22" cy="22" r="${R}" fill="none"
        stroke="var(--accent, #00e5c0)" stroke-width="4"
        stroke-linecap="round"
        stroke-dasharray="${dash.toFixed(1)} ${C.toFixed(1)}"
        stroke-dashoffset="${(C / 4).toFixed(1)}"
        style="transition: stroke-dasharray .8s cubic-bezier(.34,1.56,.64,1); transform-origin: center;"/>
    </svg>`;
  },

  _renderEmpty() {
    const el = document.getElementById("cogEmptyState");
    if (el) el.style.display = "block";
    const main = document.getElementById("cogMainContent");
    if (main) main.style.display = "none";
  },

  _scoreClass(v) {
    if (v == null) return "cog-muted";
    return v >= 80 ? "cog-elite" : v >= 60 ? "cog-strong" : v >= 40 ? "cog-mid" : "cog-low";
  },
};


/* ════════════════════════════════════════════
   APP.JS HOOKS  (auto-fire after each session)
   Chained safely inside DOMContentLoaded so
   app.js functions are already registered.
════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {

  /* Chain — never replace, always extend */
  const _origUpdateFocus    = window.updateFocusScore;
  const _origUpdateRecovery = window.updateRecoveryScore;

  window.updateFocusScore = function (...args) {
    _origUpdateFocus?.apply(this, args);   // run app.js XP/streak/stats logic first
    ZenithCollector.record();
    ZenithCognitiveDashboard.render();
  };

  window.updateRecoveryScore = function (...args) {
    _origUpdateRecovery?.apply(this, args);
    ZenithCognitiveDashboard.render();
  };

  /* Initial render */
  ZenithCognitiveDashboard.render();

  /* Re-render when stats tab becomes active */
  const statsSection = document.getElementById("statsSection");
  if (statsSection) {
    new MutationObserver(() => {
      if (statsSection.classList.contains("active")) ZenithCognitiveDashboard.render();
    }).observe(statsSection, { attributes: true, attributeFilter: ["class"] });
  }
});

/* Expose globally */
window.ZenithCognitiveMetrics    = ZenithCognitiveMetrics;
window.ZenithCognitiveDashboard  = ZenithCognitiveDashboard;
window.ZenithCollector           = ZenithCollector;
