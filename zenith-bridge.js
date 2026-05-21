/* ═══════════════════════════════════════════════════════════════
   ZENITH — Variable Bridge  (zenith-bridge.js)
   ─────────────────────────────────────────────────────────────
   Root-cause fix: app.js declares its core state with `let`,
   so variables like xp, streak, stats, Session are NOT on
   window — they're block-scoped to the script.

   All phase modules (cognitive-dashboard, analytics-engine,
   adaptive-focus, ai-coach, phase4-gamification, session-replay)
   read window.xp / window.streak / window.Session etc. and get
   undefined, so every card shows "--" or "no data".

   This file creates live Object.defineProperty getters on window
   for every variable the phase modules need. Because they are
   getters (not copies), they always return the CURRENT value of
   the let variable — so XP increments, streak changes, and new
   unlocks are all reflected immediately without touching app.js.

   Load order (in index.html):
     <script defer src="app.js"></script>
     <script defer src="zenith-bridge.js"></script>   ← after app.js
     <script defer src="analytics-engine.js"></script>
     <script defer src="...all other phase files..."></script>
═══════════════════════════════════════════════════════════════ */
"use strict";

(function installBridge() {

  /* ── defineGetter: safe wrapper that skips if already a real property ── */
  function g(name, getter) {
    /* If app.js accidentally sets window[name] = value, skip. */
    if (Object.prototype.hasOwnProperty.call(window, name)) return;
    try {
      Object.defineProperty(window, name, {
        get:          getter,
        configurable: true,
        enumerable:   false,
      });
    } catch (e) {
      /* Fallback: just do a one-time copy (less live, still better than nothing) */
      try { window[name] = getter(); } catch { /* ignore */ }
    }
  }

  /* ════════════════════════════════════════════
     CORE STATE  (all declared `let` in app.js)
  ════════════════════════════════════════════ */

  /* XP — used by skill tree, analytics */
  g("xp",       () => typeof xp       !== "undefined" ? xp       : 0);

  /* Streak — used by streak viz, analytics */
  g("streak",   () => typeof streak   !== "undefined" ? streak   : 0);

  /* Stats object { [dateString]: { min, sess, tags } }
     Used by streak viz (_sessions()), analytics engine.
     WARNING: this getter returns the LIVE object reference from app.js.
     Mutating it directly will affect app state. If you need a stable
     snapshot (e.g. to pass to a worker or compare before/after), use
     ZenithBridge.statsSnapshot() instead of caching window.stats locally. */
  g("stats",    () => typeof stats    !== "undefined" ? stats    : {});

  /* Session runner object { state, mode, total, remaining }
     Used by session-replay, distraction-lock, cognitive-dashboard */
  g("Session",  () => typeof Session  !== "undefined" ? Session  : { state:"idle", mode:"focus", total:0, remaining:0 });

  /* Active focus mode string e.g. "deep", "standard"
     Used by cognitive-dashboard, adaptive-focus, ai-coach */
  g("activeMode",        () => typeof activeMode        !== "undefined" ? activeMode        : "standard");

  /* Current session tag string or null
     Used by cognitive-dashboard ZenithCollector.record() */
  g("currentSessionTag", () => typeof currentSessionTag !== "undefined" ? currentSessionTag : null);

  /* Settings object { focus, break, long }
     Used by session-replay, adaptive-focus */
  g("settings",          () => typeof settings          !== "undefined" ? settings          : { focus:25, break:5, long:15 });

  /* Unlocked skill IDs array
     Used by skill tree and analytics perks */
  g("unlockedSkills",    () => typeof unlockedSkills    !== "undefined" ? unlockedSkills    : []);

  /* Session hour log array
     Used by analytics-engine for peak hour calculation */
  g("sessionHourLog",    () => typeof sessionHourLog    !== "undefined" ? sessionHourLog    : []);

  /* SKILL_NODES array — used by skill tree */
  g("SKILL_NODES",       () => typeof SKILL_NODES       !== "undefined" ? SKILL_NODES       : []);

  /* tasks / completedTasks — used by zenith-db sync */
  g("tasks",             () => typeof tasks             !== "undefined" ? tasks             : []);
  g("completedTasks",    () => typeof completedTasks    !== "undefined" ? completedTasks    : []);

  /* deepFocus boolean — used by distraction-lock */
  g("deepFocus",         () => typeof deepFocus         !== "undefined" ? deepFocus         : false);

  /* focusCycle — used by UI helpers */
  g("focusCycle",        () => typeof focusCycle        !== "undefined" ? focusCycle        : 0);

  /* reflectionData — used by analytics */
  g("reflectionData",    () => typeof reflectionData    !== "undefined" ? reflectionData    : []);

  g("silentMode", () => typeof silentMode !== "undefined" ? silentMode : false);

  console.log("[ZenithBridge] ✓ Live window getters installed for:", [
    "xp","streak","stats","Session","activeMode","currentSessionTag",
    "settings","unlockedSkills","sessionHourLog","SKILL_NODES",
    "tasks","completedTasks","deepFocus","focusCycle","reflectionData","silentMode",
  ].filter(k => {
    try { return window[k] !== undefined; } catch { return false; }
  }).join(", "));

  /*
   * Fix #6 — ZenithBridge.ready(fn)
   * Any module that reads window.Session or other app.js `let` variables
   * before DOMContentLoaded may get undefined because `defer` scripts run
   * after HTML parsing but the order among multiple deferred scripts is
   * only guaranteed if they appear in DOM order. Use this helper to safely
   * defer execution until after DOMContentLoaded has fired.
   *
   * Usage (in any module):
   *   ZenithBridge.ready(() => { ... use window.Session safely ... });
   */
  window.ZenithBridge = {
    ready(fn) {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", fn, { once: true });
      } else {
        // DOMContentLoaded already fired — run synchronously next microtask
        Promise.resolve().then(fn);
      }
    },

    /**
     * Returns a shallow-cloned snapshot of the stats object.
     * Each day's value is also cloned so callers can compare without
     * worrying about the live object being mutated underneath them.
     *
     * Usage:  const snap = ZenithBridge.statsSnapshot();
     */
    statsSnapshot() {
      const live = window.stats ?? {};
      const copy = {};
      for (const key in live) {
        if (Object.prototype.hasOwnProperty.call(live, key)) {
          copy[key] = Object.assign({}, live[key]);
        }
      }
      return copy;
    },

    /**
     * Returns a plain object copy of window.Session (safe to cache/compare).
     */
    sessionSnapshot() {
      const s = window.Session;
      if (!s) return { state: "idle", mode: "focus", total: 0, remaining: 0 };
      return {
        state:     s.state,
        mode:      s.mode,
        total:     s.total,
        remaining: s.remaining,
        startedAt: s.startedAt,
        endTime:   s.endTime,
      };
    },
  };

})();
