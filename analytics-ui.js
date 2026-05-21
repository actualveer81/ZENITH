/* ═══════════════════════════════════════════════════════════════
   ZENITH — Analytics UI Renderer  (Phase 2)
   ─────────────────────────────────────────────────────────────
   Renders the Focus Intelligence dashboard into the stats section.
   Depends on: analytics-engine.js  (must load first)
═══════════════════════════════════════════════════════════════ */
"use strict";

class ZenithAnalyticsUI {

  constructor(engine) {
    this.engine = engine;
    this.DAYS_S  = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  }

  /* ════════════════════════════════════════════
     MAIN RENDER
  ════════════════════════════════════════════ */

  /** Full re-render. Called by the integration hook. */
  render(forceRefresh = false) {
    const report = this.engine.compute(forceRefresh);

    if (report.insufficient) {
      this._renderInsufficient(report);
      return;
    }

    this._renderOverallScore(report);
    this._renderMetricPills(report);
    this._renderHeatmap(report.weekHeatmap);
    this._renderBarChart(report.daily14);
    this._renderInsights(report.insights);
    this._renderBurnoutMeter(report.burnoutRisk);
  }

  /* ════════════════════════════════════════════
     INSUFFICIENT DATA STATE
  ════════════════════════════════════════════ */

  _renderInsufficient({ current, required }) {
    const el = document.getElementById("aiOverallScore");
    if (el) el.textContent = "--";
    const insEl = document.getElementById("aiInsightsList");
    if (insEl) {
      insEl.innerHTML = `
        <div class="ai-insight-row ai-insight-dim">
          <span class="ai-insight-icon">⚗️</span>
          <span>Complete ${required - current} more session${required - current !== 1 ? "s" : ""} to unlock behavioral intelligence.</span>
        </div>`;
    }
  }

  /* ════════════════════════════════════════════
     OVERALL SCORE
  ════════════════════════════════════════════ */

  _renderOverallScore({ overallScore, totalSessions, consistencyIndex }) {
    const scoreEl = document.getElementById("aiOverallScore");
    if (scoreEl) {
      scoreEl.textContent = overallScore;
      scoreEl.className   = "ai-score-num " + this._scoreClass(overallScore);
    }
    const labelEl = document.getElementById("aiScoreLabel");
    if (labelEl) {
      labelEl.textContent =
        overallScore >= 80 ? "Elite" :
        overallScore >= 65 ? "Strong" :
        overallScore >= 50 ? "Developing" : "Building";
    }
    const sessEl = document.getElementById("aiTotalSessions");
    if (sessEl) sessEl.textContent = totalSessions;
    const conEl = document.getElementById("aiConsistencyLabel");
    if (conEl) conEl.textContent = consistencyIndex.label;
  }

  /* ════════════════════════════════════════════
     METRIC PILLS
  ════════════════════════════════════════════ */

  _renderMetricPills({ burnoutRisk, consistencyIndex, sessionVelocity, recoveryEfficiency, bestHourWindow }) {
    this._setPill("aiPillBurnout",
      burnoutRisk.level === "high"   ? "🔴 High"   :
      burnoutRisk.level === "medium" ? "🟡 Medium" : "🟢 Low",
      burnoutRisk.level === "high" ? "pill-danger" : burnoutRisk.level === "medium" ? "pill-warn" : "pill-ok"
    );

    this._setPill("aiPillConsistency",
      `${consistencyIndex.score}%`,
      consistencyIndex.score >= 70 ? "pill-ok" : consistencyIndex.score >= 45 ? "pill-warn" : "pill-dim"
    );

    this._setPill("aiPillVelocity",
      sessionVelocity.direction === "improving" ? `+${sessionVelocity.pct}% ↑` :
      sessionVelocity.direction === "declining" ? `${sessionVelocity.pct}% ↓` : "Stable →",
      sessionVelocity.direction === "improving" ? "pill-ok" :
      sessionVelocity.direction === "declining" ? "pill-warn" : "pill-dim"
    );

    this._setPill("aiPillRecovery",
      recoveryEfficiency.score ? `${recoveryEfficiency.score}` : "--",
      recoveryEfficiency.score >= 80 ? "pill-ok" : recoveryEfficiency.score >= 60 ? "pill-warn" : "pill-dim"
    );

    const peakEl = document.getElementById("aiPeakHour");
    if (peakEl && bestHourWindow) peakEl.textContent = bestHourWindow.label;
  }

  _setPill(id, text, cls) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className   = `ai-pill-value ${cls}`;
  }

  /* ════════════════════════════════════════════
     7-DAY × 24-HOUR HEATMAP  (SVG)
  ════════════════════════════════════════════ */

  _renderHeatmap({ grid, maxVal }) {
    const container = document.getElementById("aiHeatmapSvg");
    if (!container) return;

    /* Layout constants */
    const CELL_W  = 10, CELL_H = 12, GAP = 2;
    const LABEL_W = 28;
    const HOURS   = 24;
    const DAYS    = 7;
    const W  = LABEL_W + HOURS * (CELL_W + GAP);
    const H  = DAYS * (CELL_H + GAP) + 20;          // +20 for hour labels

    /* Accent color from CSS var (fallback teal) */
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent").trim() || "#00e5c0";

    const rows = [];

    /* Hour labels (top) */
    const hourLabels = [0, 3, 6, 9, 12, 15, 18, 21].map(h => {
      const x = LABEL_W + h * (CELL_W + GAP) + CELL_W / 2;
      const l = h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h-12}p`;
      return `<text x="${x}" y="10" text-anchor="middle" class="hm-label">${l}</text>`;
    });

    /* Day rows */
    const DAYS_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon-Sun
    DAYS_ORDER.forEach((dayIdx, row) => {
      const y = 18 + row * (CELL_H + GAP);

      /* Day label */
      rows.push(
        `<text x="${LABEL_W - 4}" y="${y + CELL_H - 3}" text-anchor="end" class="hm-label">${this.DAYS_S[dayIdx]}</text>`
      );

      /* Hour cells */
      for (let h = 0; h < HOURS; h++) {
        const count    = grid[dayIdx][h];
        const ratio    = maxVal > 0 ? count / maxVal : 0;
        const opacity  = ratio < 0.01 ? 0.06 : 0.15 + ratio * 0.85;
        const x        = LABEL_W + h * (CELL_W + GAP);
        const title    = count > 0
          ? `${this.DAYS_S[dayIdx]} ${h}:00 — ${count} session${count !== 1 ? "s" : ""}`
          : "";

        rows.push(
          `<rect x="${x}" y="${y}" width="${CELL_W}" height="${CELL_H}" rx="2"
           fill="${accent}" fill-opacity="${opacity.toFixed(2)}"
           class="hm-cell${count > 0 ? " hm-cell-active" : ""}">
           ${title ? `<title>${title}</title>` : ""}
           </rect>`
        );
      }
    });

    container.setAttribute("viewBox", `0 0 ${W} ${H}`);
    container.setAttribute("width",  "100%");
    container.setAttribute("height", H);
    container.innerHTML = `
      <style>
        .hm-label { font-size: 8px; fill: var(--muted, #888); font-family: var(--font-body, sans-serif); }
        .hm-cell  { transition: fill-opacity .2s; }
        .hm-cell-active:hover { fill-opacity: 1 !important; }
      </style>
      ${hourLabels.join("")}
      ${rows.join("")}
    `;
  }

  /* ════════════════════════════════════════════
     14-DAY BAR CHART  (SVG, uses minutes)
  ════════════════════════════════════════════ */

  _renderBarChart({ days, maxSess }) {
    const container = document.getElementById("aiBarChartSvg");
    if (!container) return;

    const W    = 460, H = 80;
    const BAR_W = Math.floor(W / days.length) - 3;
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent").trim() || "#00e5c0";

    const bars = days.map((d, i) => {
      const barH  = maxSess > 0 ? Math.max(2, (d.sess / maxSess) * 60) : 2;
      const x     = i * (BAR_W + 3) + 1;
      const y     = 64 - barH;
      const alpha = d.isToday ? 1 : 0.55;

      return `
        <g>
          <rect x="${x}" y="${y}" width="${BAR_W}" height="${barH}" rx="2"
                fill="${accent}" fill-opacity="${alpha}" class="bar-rect">
            <title>${d.label} ${d.dayNum}: ${d.sess} min · ${d.count} session${d.count !== 1 ? "s" : ""}</title>
          </rect>
          <text x="${x + BAR_W / 2}" y="75" text-anchor="middle" class="bar-label">
            ${d.isToday ? "●" : d.dayNum}
          </text>
        </g>`;
    });

    container.setAttribute("viewBox", `0 0 ${W} ${H}`);
    container.setAttribute("width",  "100%");
    container.setAttribute("height", H);
    container.innerHTML = `
      <style>
        .bar-label { font-size: 8px; fill: var(--muted, #888); font-family: var(--font-body, sans-serif); }
        .bar-rect  { transition: fill-opacity .2s; cursor: default; }
        .bar-rect:hover { fill-opacity: 1 !important; }
      </style>
      ${bars.join("")}
    `;
  }

  /* ════════════════════════════════════════════
     INSIGHTS LIST
  ════════════════════════════════════════════ */

  _renderInsights(insights) {
    const el = document.getElementById("aiInsightsList");
    if (!el) return;

    if (!insights.length) {
      el.innerHTML = `<div class="ai-insight-row ai-insight-dim">
        <span class="ai-insight-icon">🔬</span>
        <span>Keep logging sessions — patterns will emerge soon.</span>
      </div>`;
      return;
    }

    el.innerHTML = insights.map(ins => `
      <div class="ai-insight-row ai-insight-${ins.type}">
        <span class="ai-insight-icon">${ins.icon}</span>
        <span>${ins.text}</span>
      </div>`).join("");
  }

  /* ════════════════════════════════════════════
     BURNOUT METER
  ════════════════════════════════════════════ */

  _renderBurnoutMeter({ score, level, sessLast7 }) {
    const fillEl = document.getElementById("aiBurnoutFill");
    if (fillEl) {
      fillEl.style.width = `${score}%`;
      fillEl.className = `ai-burnout-fill burnout-${level}`;
    }
    const labelEl = document.getElementById("aiBurnoutLabel");
    if (labelEl) {
      labelEl.textContent =
        level === "high"   ? "High — rest advised"   :
        level === "medium" ? "Medium — pace yourself" : "Low — healthy rhythm";
      labelEl.className = `ai-burnout-label burnout-text-${level}`;
    }
    const sessEl = document.getElementById("aiBurnoutSess");
    if (sessEl) sessEl.textContent = `${sessLast7} sessions / 7 days`;
  }

  /* ════════════════════════════════════════════
     HELPERS
  ════════════════════════════════════════════ */

  _scoreClass(score) {
    return score >= 80 ? "score-elite" : score >= 65 ? "score-strong" :
           score >= 50 ? "score-dev"   : "score-build";
  }
}

/* ════════════════════════════════════════════
   INTEGRATION — Hook into existing app.js
════════════════════════════════════════════ */
(function integrateAnalytics() {

  /* Wait for DOM */
  document.addEventListener("DOMContentLoaded", () => {

    if (!window.ZenithAnalytics) {
      console.warn("[ZENITH] analytics-engine.js must load before analytics-ui.js");
      return;
    }

    const ui = new ZenithAnalyticsUI(window.ZenithAnalytics);
    window.ZenithAnalyticsUI = ui;

    /* Initial render */
    ui.render();

    /* Wrap existing updateBehavioralPatterns if present */
    const _orig = window.updateBehavioralPatterns;
    window.updateBehavioralPatterns = function (...args) {
      if (typeof _orig === "function") _orig.apply(this, args);
      /* Invalidate cache and re-render after each session */
      window.ZenithAnalytics.invalidate();
      ui.render(true);
    };

    /* Re-render when stats tab is shown */
    const statsBtn = document.querySelector('[onclick*="stats"], [data-section="stats"]');
    statsBtn?.addEventListener("click", () => {
      setTimeout(() => ui.render(), 50);
    });

    /* Also re-render when navigating to stats via sidebar */
    const observer = new MutationObserver(() => {
      const statsActive = document.getElementById("statsSection")?.classList.contains("active");
      if (statsActive) ui.render();
    });
    const statsSection = document.getElementById("statsSection");
    if (statsSection) {
      observer.observe(statsSection, { attributes: true, attributeFilter: ["class"] });
    }

  });
})();
