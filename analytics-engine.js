/* ═══════════════════════════════════════════════════════════════
   ZENITH — Behavioral Analytics Engine  (Phase 2)
   ─────────────────────────────────────────────────────────────
   Reads from existing localStorage keys already used by app.js:
     sessionHourLog  · stats  · recoveryLog  · distractions
     streak  · xp

   Writes one new key:  zenith_intelligence_v1  (cache only)

   Exposes:  window.ZenithAnalytics = new ZenithAnalyticsEngine()
═══════════════════════════════════════════════════════════════ */
"use strict";

class ZenithAnalyticsEngine {

  constructor() {
    this.CACHE_KEY = "zenith_intelligence_v1";
    this.CACHE_TTL = 3 * 60 * 1000;  // 3-minute cache
  }

  /* ════════════════════════════════════════════
     PUBLIC API
  ════════════════════════════════════════════ */

  /**
   * Compute the full intelligence report.
   * Returns cached result if fresh, otherwise recomputes.
   * @param {boolean} forceRefresh
   * @returns {object} intelligence report
   */
  compute(forceRefresh = false) {
    if (!forceRefresh) {
      const cached = this._loadCache();
      if (cached) return cached;
    }

    const src = this._loadSource();
    const totalSessions = src.hourLog.length;

    if (totalSessions < 3) {
      return {
        insufficient: true,
        required: 5,
        current: totalSessions,
      };
    }

    const report = {
      computedAt:         Date.now(),
      totalSessions,
      burnoutRisk:        this._burnoutRisk(src),
      consistencyIndex:   this._consistencyIndex(src),
      sessionVelocity:    this._sessionVelocity(src),
      recoveryEfficiency: this._recoveryEfficiency(src),
      bestHourWindow:     this._bestHourWindow(src.hourLog),
      peakDayOfWeek:      this._peakDayOfWeek(src),
      preferredMode:      this._preferredMode(src.hourLog),
      distractionRate:    this._distractionRate(src),
      weekHeatmap:        this._weekHeatmap(src.hourLog),
      daily14:            this._daily14(src.stats),
      insights:           [],
    };

    report.insights      = this._generateInsights(report, src);
    report.overallScore  = this._overallScore(report);

    this._saveCache(report);
    return report;
  }

  /** Bust cache — call after each session completes */
  invalidate() {
    try { localStorage.removeItem(this.CACHE_KEY); } catch { /* ignore */ }
  }

  /* ════════════════════════════════════════════
     DATA LOADING
  ════════════════════════════════════════════ */

  _loadSource() {
    const parse = (key, fallback) => {
      try { return JSON.parse(localStorage.getItem(key)) || fallback; }
      catch { return fallback; }
    };
    return {
      hourLog:      parse("sessionHourLog", []),
      stats:        parse("stats",          {}),
      recoveryLog:  parse("recoveryLog",    []),
      distractions: parse("distractions",   []),
      streak:       Number(localStorage.getItem("streak") || 0),
      xp:           Number(localStorage.getItem("xp")     || 0),
    };
  }

  /* ════════════════════════════════════════════
     ANALYSIS: BURNOUT RISK  [0-100]
  ════════════════════════════════════════════ */

  _burnoutRisk({ hourLog, stats, recoveryLog }) {
    let score   = 0;
    const flags = [];

    const now   = Date.now();
    const DAY   = 86_400_000;
    const last7 = this._lastNDays(7);

    /* Factor 1 — raw session volume last 7 days [0-30] */
    const recentSess = hourLog.filter(l => last7.includes(l.date));
    const vol        = recentSess.length;
    if      (vol >= 30) { score += 30; flags.push("extreme_volume");   }
    else if (vol >= 20) { score += 20; flags.push("high_volume");      }
    else if (vol >= 14) { score += 10; flags.push("moderate_volume");  }

    /* Factor 2 — consecutive heavy days [0-25] */
    const heavyDays = last7.filter(d => (stats[d]?.sess || 0) >= 4).length;
    if      (heavyDays >= 5) { score += 25; flags.push("sustained_overload");  }
    else if (heavyDays >= 3) { score += 15; flags.push("frequent_overload");   }
    else if (heavyDays >= 2) { score +=  7;                                    }

    /* Factor 3 — performance trend: this week vs last week [0-20] */
    const last7min  = last7.reduce((s, d) => s + (stats[d]?.min || 0), 0);
    const prior7    = this._lastNDays(14).slice(7);
    const prior7min = prior7.reduce((s, d) => s + (stats[d]?.min || 0), 0);
    if (prior7min > 0) {
      const drop = (prior7min - last7min) / prior7min;
      if      (drop > 0.4) { score += 20; flags.push("sharp_decline");  }
      else if (drop > 0.2) { score += 10; flags.push("mild_decline");   }
    }

    /* Factor 4 — recovery-pause density last 7 days [0-15] */
    const recentPauses = recoveryLog.filter(
      r => now - r.time < 7 * DAY
    ).length;
    if      (recentPauses >= 12) { score += 15; flags.push("frequent_pauses"); }
    else if (recentPauses >=  6) { score +=  8;                                }

    /* Factor 5 — erratic session schedule [0-10] */
    const hrs = recentSess.map(l => l.hour);
    if (hrs.length >= 6) {
      const mean = hrs.reduce((s, h) => s + h, 0) / hrs.length;
      const sd   = Math.sqrt(
        hrs.reduce((s, h) => s + (h - mean) ** 2, 0) / hrs.length
      );
      if (sd > 6) { score += 10; flags.push("erratic_schedule"); }
    }

    const level = score >= 60 ? "high" : score >= 35 ? "medium" : "low";
    return { score: Math.min(100, score), level, flags, sessLast7: vol };
  }

  /* ════════════════════════════════════════════
     ANALYSIS: CONSISTENCY INDEX  [0-100]
  ════════════════════════════════════════════ */

  _consistencyIndex({ hourLog, stats }) {
    if (hourLog.length < 5) return { score: 0, label: "building", activeDays: 0 };

    const last21    = this._lastNDays(21);
    const activeDays = last21.filter(d => (stats[d]?.sess || 0) > 0).length;
    const actRatio  = activeDays / 21;                              // 0-1 → up to 40 pts

    /* Session timing regularity (std dev of hours) → up to 30 pts */
    const recentHours = hourLog.slice(-20).map(l => l.hour);
    let timingScore = 30;
    if (recentHours.length >= 5) {
      const mean = recentHours.reduce((s, h) => s + h, 0) / recentHours.length;
      const sd   = Math.sqrt(
        recentHours.reduce((s, h) => s + (h - mean) ** 2, 0) / recentHours.length
      );
      timingScore = Math.max(0, 30 - sd * 3);
    }

    /* Daily session-count regularity → up to 30 pts */
    const counts = last21.map(d => stats[d]?.sess || 0).filter(c => c > 0);
    let countScore = 30;
    if (counts.length >= 3) {
      const mean = counts.reduce((s, c) => s + c, 0) / counts.length;
      const sd   = Math.sqrt(
        counts.reduce((s, c) => s + (c - mean) ** 2, 0) / counts.length
      );
      countScore = Math.max(0, 30 - sd * 5);
    }

    const score = Math.round(actRatio * 40 + timingScore + countScore);
    const label =
      score >= 75 ? "excellent" :
      score >= 55 ? "good"      :
      score >= 35 ? "building"  : "irregular";

    return { score: Math.min(100, score), label, activeDays, of: 21 };
  }

  /* ════════════════════════════════════════════
     ANALYSIS: SESSION VELOCITY
  ════════════════════════════════════════════ */

  _sessionVelocity({ stats }) {
    const last14 = this._lastNDays(14);
    const week1  = last14.slice(7).reduce((s, d) => s + (stats[d]?.sess || 0), 0);  // older
    const week2  = last14.slice(0, 7).reduce((s, d) => s + (stats[d]?.sess || 0), 0); // newer

    if (week1 === 0) return { direction: "new", pct: 0, week1, week2 };

    const pct       = Math.round(((week2 - week1) / week1) * 100);
    const direction =
      pct >  15 ? "improving" :
      pct < -15 ? "declining" : "stable";

    return { direction, pct, week1, week2 };
  }

  /* ════════════════════════════════════════════
     ANALYSIS: RECOVERY EFFICIENCY
  ════════════════════════════════════════════ */

  _recoveryEfficiency({ recoveryLog }) {
    const withRestart = recoveryLog.filter(r => r.restartTime);
    if (withRestart.length < 2) return { score: null, avgMinutes: null, samples: 0 };

    const gaps = withRestart.map(r => (r.restartTime - r.time) / 60_000);
    const avg  = gaps.reduce((s, g) => s + g, 0) / gaps.length;

    const score =
      avg <=  5 ? 95 :
      avg <= 10 ? 80 :
      avg <= 20 ? 65 :
      avg <= 30 ? 50 : 30;

    return { score, avgMinutes: Math.round(avg), samples: withRestart.length };
  }

  /* ════════════════════════════════════════════
     ANALYSIS: BEST 2-HOUR FOCUS WINDOW
  ════════════════════════════════════════════ */

  _bestHourWindow(hourLog) {
    if (hourLog.length < 3) return null;

    /* Recency-weighted hour counts */
    const counts = Array(24).fill(0);
    const n = hourLog.length;
    hourLog.forEach((l, i) => {
      const weight = 0.6 + 0.4 * (i / n);   // older = 0.6, newer = 1.0
      counts[l.hour] += weight;
    });

    /* Sliding 2-hour window */
    let bestStart = 0, bestScore = 0;
    for (let h = 0; h < 23; h++) {
      const s = counts[h] + counts[h + 1];
      if (s > bestScore) { bestScore = s; bestStart = h; }
    }

    const fmt = h => {
      if (h === 0)  return "12am";
      if (h < 12)   return `${h}am`;
      if (h === 12) return "12pm";
      return `${h - 12}pm`;
    };

    const confidence = Math.min(100, Math.round((bestScore / n) * 100));

    return {
      start:      bestStart,
      end:        bestStart + 2,
      label:      `${fmt(bestStart)} – ${fmt(bestStart + 2)}`,
      confidence,
      hourCounts: counts,
    };
  }

  /* ════════════════════════════════════════════
     ANALYSIS: PEAK DAY OF WEEK
  ════════════════════════════════════════════ */

  _peakDayOfWeek({ hourLog }) {
    const counts   = Array(7).fill(0);
    const DAYS_L   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const DAYS_S   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

    hourLog.forEach(l => {
      const d = new Date(l.date);
      if (!isNaN(d)) counts[d.getDay()]++;
    });

    const total  = counts.reduce((s, c) => s + c, 0);
    const maxIdx = counts.indexOf(Math.max(...counts));

    return {
      dayIndex: maxIdx,
      dayName:  DAYS_L[maxIdx],
      dayShort: DAYS_S[maxIdx],
      counts,
      total,
    };
  }

  /* ════════════════════════════════════════════
     ANALYSIS: PREFERRED MODE
  ════════════════════════════════════════════ */

  _preferredMode(hourLog) {
    const modes = {};
    hourLog.forEach(l => {
      const m = l.mode || "standard";
      modes[m] = (modes[m] || 0) + 1;
    });
    const sorted = Object.entries(modes).sort((a, b) => b[1] - a[1]);
    return sorted.length
      ? { mode: sorted[0][0], count: sorted[0][1], breakdown: modes }
      : null;
  }

  /* ════════════════════════════════════════════
     ANALYSIS: DISTRACTION RATE
  ════════════════════════════════════════════ */

  _distractionRate({ distractions, hourLog }) {
    if (!hourLog.length) return 0;
    return parseFloat((distractions.length / hourLog.length).toFixed(2));
  }

  /* ════════════════════════════════════════════
     ANALYSIS: WEEK HEATMAP  (7 days × 24 hours)
  ════════════════════════════════════════════ */

  _weekHeatmap(hourLog) {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    hourLog.forEach(l => {
      const d = new Date(l.date);
      if (!isNaN(d)) grid[d.getDay()][l.hour]++;
    });
    const maxVal = Math.max(...grid.flat(), 1);
    return { grid, maxVal };
  }

  /* ════════════════════════════════════════════
     ANALYSIS: LAST 14 DAYS DAILY DATA
  ════════════════════════════════════════════ */

  _daily14(stats) {
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toDateString();
      days.push({
        key,
        label:   d.toLocaleDateString("en", { weekday: "short" }),
        dayNum:  d.getDate(),
        isToday: i === 0,
        sess:    stats[key]?.min  || 0,    // use minutes for bar height (more meaningful)
        count:   stats[key]?.sess || 0,
      });
    }
    const maxSess = Math.max(...days.map(d => d.sess), 1);
    return { days, maxSess };
  }

  /* ════════════════════════════════════════════
     INSIGHTS  (natural language)
  ════════════════════════════════════════════ */

  _generateInsights(report, src) {
    const insights = [];
    const {
      burnoutRisk, consistencyIndex, sessionVelocity,
      bestHourWindow, peakDayOfWeek, preferredMode, recoveryEfficiency,
    } = report;

    /* 1 — Burnout */
    if (burnoutRisk.level === "high") {
      insights.push({
        type: "warning",
        icon: "🔴",
        text: `High burnout risk: ${burnoutRisk.sessLast7} sessions in 7 days. ` +
              `Schedule a lighter day — sustainable pace beats short sprints.`,
      });
    } else if (burnoutRisk.level === "medium") {
      insights.push({
        type: "caution",
        icon: "🟡",
        text: "Moderate burnout signals detected. Protect your rest days — consistency always outlasts intensity.",
      });
    } else {
      insights.push({
        type: "positive",
        icon: "🟢",
        text: "Burnout risk is low. Your work-rest balance is healthy right now.",
      });
    }

    /* 2 — Peak hour */
    if (bestHourWindow) {
      const conf = bestHourWindow.confidence >= 30 ? ` (${bestHourWindow.confidence}% of sessions)` : "";
      insights.push({
        type: "peak",
        icon: "⚡",
        text: `Peak focus window: ${bestHourWindow.label}${conf}. Guard this time fiercely.`,
      });
    }

    /* 3 — Peak day */
    if (peakDayOfWeek && src.hourLog.length >= 10) {
      const pct = Math.round(
        (peakDayOfWeek.counts[peakDayOfWeek.dayIndex] / Math.max(1, peakDayOfWeek.total)) * 100
      );
      insights.push({
        type: "pattern",
        icon: "📅",
        text: `${peakDayOfWeek.dayName} is your strongest focus day (${pct}% of sessions). ` +
              `Front-load your hardest work there.`,
      });
    }

    /* 4 — Velocity */
    if (sessionVelocity.direction === "improving") {
      insights.push({
        type: "positive",
        icon: "📈",
        text: `Focus volume is up ${Math.abs(sessionVelocity.pct)}% week-over-week. ` +
              `Momentum is compounding — protect your habits.`,
      });
    } else if (sessionVelocity.direction === "declining") {
      insights.push({
        type: "caution",
        icon: "📉",
        text: `Sessions down ${Math.abs(sessionVelocity.pct)}% vs last week. ` +
              `One focused day this week resets the trend.`,
      });
    }

    /* 5 — Consistency */
    if (consistencyIndex.score >= 75) {
      insights.push({
        type: "positive",
        icon: "🎯",
        text: `${consistencyIndex.activeDays}/21 days active — elite-tier consistency. ` +
              `This is exactly where compounding kicks in.`,
      });
    } else if (consistencyIndex.score >= 45) {
      insights.push({
        type: "neutral",
        icon: "📊",
        text: `Active ${consistencyIndex.activeDays} of the last 21 days. ` +
              `2-3 more sessions per week would push you into the top tier.`,
      });
    }

    /* 6 — Recovery */
    if (recoveryEfficiency.score !== null) {
      if (recoveryEfficiency.score >= 80) {
        insights.push({
          type: "positive",
          icon: "⚡",
          text: `Fast refocus: avg ${recoveryEfficiency.avgMinutes} min to restart after a pause. That's elite recovery.`,
        });
      } else if (recoveryEfficiency.avgMinutes > 20) {
        insights.push({
          type: "neutral",
          icon: "⏱",
          text: `Avg ${recoveryEfficiency.avgMinutes} min to restart after pauses. ` +
                `A 60-second breathing reset could cut that in half.`,
        });
      }
    }

    /* 7 — Mode */
    if (preferredMode && src.hourLog.length >= 8) {
      const modeLabel = {
        standard: "Standard Pomodoro",
        sprint:   "Sprint (15 min)",
        deep:     "Deep Work (50 min)",
        creative: "Creative Flow",
        recovery: "Recovery",
        burnout:  "Burnout Safe",
      }[preferredMode.mode] || preferredMode.mode;

      insights.push({
        type: "pattern",
        icon: "🎛",
        text: `Preferred mode: ${modeLabel} (${preferredMode.count} sessions). ` +
              `This reveals your natural work rhythm — lean into it.`,
      });
    }

    return insights.slice(0, 5);
  }

  /* ════════════════════════════════════════════
     OVERALL INTELLIGENCE SCORE  [0-100]
  ════════════════════════════════════════════ */

  _overallScore({ burnoutRisk, consistencyIndex, sessionVelocity, recoveryEfficiency }) {
    const burnoutPts  = burnoutRisk.level === "low" ? 100 : burnoutRisk.level === "medium" ? 65 : 30;
    const consPts     = consistencyIndex.score;
    const velocPts    = sessionVelocity.direction === "improving" ? 90
                      : sessionVelocity.direction === "stable"    ? 72 : 50;
    const recovPts    = recoveryEfficiency.score ?? 68;

    return Math.round(
      burnoutPts * 0.30 +
      consPts    * 0.35 +
      velocPts   * 0.20 +
      recovPts   * 0.15
    );
  }

  /* ════════════════════════════════════════════
     HELPERS
  ════════════════════════════════════════════ */

  /** Returns array of last N day date strings (most recent first) */
  _lastNDays(n) {
    return Array.from({ length: n }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return d.toDateString();
    });
  }

  /* ── Cache ── */
  _loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem(this.CACHE_KEY));
      if (c && Date.now() - c.computedAt < this.CACHE_TTL) return c;
    } catch { /* ignore */ }
    return null;
  }
  _saveCache(data) {
    try { localStorage.setItem(this.CACHE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
  }
}

/* ════════════════════════════════════════════
   SINGLETON
════════════════════════════════════════════ */
window.ZenithAnalytics = new ZenithAnalyticsEngine();
