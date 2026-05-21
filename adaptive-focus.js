/* ═══════════════════════════════════════════════════════════════
   ZENITH — Adaptive Focus System  (#7)
   ─────────────────────────────────────────────────────────────
   Dynamically recommends session length, mode, and soundscape
   based on: burnout risk · time of day · peak hour window ·
             velocity · preferred mode · day of week

   Hooks fired by app.js (no app.js edits needed):
     window.updateAdaptiveRecs — called after each focus session

   Injects a "Smart Session" banner into the Focus section
   with a one-tap apply button.
═══════════════════════════════════════════════════════════════ */
"use strict";

const ZenithAdaptiveFocus = (() => {

  /* Mode metadata mirroring FOCUS_MODES in app.js */
  const MODES = {
    standard: { label: "⏱ Standard",  focus: 25, icon: "⏱", color: "#4f9cf9" },
    sprint:   { label: "⚡ Sprint",    focus: 15, icon: "⚡", color: "#f59e0b" },
    deep:     { label: "🎯 Deep Work", focus: 50, icon: "🎯", color: "#00e5c0" },
    creative: { label: "🎨 Creative",  focus: 45, icon: "🎨", color: "#a78bfa" },
    recovery: { label: "🌱 Recovery",  focus: 10, icon: "🌱", color: "#34d399" },
    burnout:  { label: "🛡 Burnout Safe", focus: 20, icon: "🛡", color: "#f87171" },
  };

  const SOUNDSCAPES = {
    deep:     { name: "Rain",       sound: "rain"      },
    creative: { name: "Forest",     sound: "forest"    },
    sprint:   { name: "White Noise",sound: "whitenoise"},
    recovery: { name: "Rain",       sound: "rain"      },
    burnout:  { name: "Rain",       sound: "rain"      },
    standard: null,
  };

  /* ═══════════════════════════════════
     RECOMMENDATION ENGINE
  ═══════════════════════════════════ */
  function getRecommendation() {
    const report = window.ZenithAnalytics?.compute();
    if (!report || report.insufficient) return null;

    const {
      burnoutRisk       = { level: "low" },
      sessionVelocity   = { direction: "stable" },
      bestHourWindow    = null,
      peakDayOfWeek     = null,
      preferredMode     = null,
      consistencyIndex  = { score: 0 },
    } = report;

    const now        = new Date();
    const hour       = now.getHours();
    const dayOfWeek  = now.getDay();

    /* ── Decision tree ── */
    let mode   = "standard";
    let reason = "";
    let confidence = "medium"; // low | medium | high

    /* 1 — Burnout overrides everything */
    if (burnoutRisk.level === "high") {
      mode    = "recovery";
      reason  = "Burnout risk is high — a short recovery session protects your long-term output.";
      confidence = "high";
    }
    else if (burnoutRisk.level === "medium") {
      mode    = "burnout";
      reason  = "Moderate burnout signals — reduced load keeps you consistent without crashing.";
      confidence = "high";
    }
    /* 2 — You're in your peak focus window → go deep */
    else if (bestHourWindow && hour >= bestHourWindow.start && hour < bestHourWindow.end) {
      mode    = "deep";
      reason  = `Peak window: ${bestHourWindow.label}. This is your highest-focus time — go deep.`;
      confidence = "high";
    }
    /* 3 — It's your strongest day + momentum is good → full session */
    else if (peakDayOfWeek && peakDayOfWeek.dayIndex === dayOfWeek && sessionVelocity.direction === "improving") {
      mode    = preferredMode?.mode || "standard";
      reason  = `${peakDayOfWeek.dayName} with rising momentum — your strongest combo.`;
      confidence = "medium";
    }
    /* 4 — Declining velocity → sprint to rebuild momentum */
    else if (sessionVelocity.direction === "declining") {
      mode    = "sprint";
      reason  = "Velocity is down — a short sprint is easier to start and rebuilds the habit.";
      confidence = "medium";
    }
    /* 5 — Low consistency → just show up with standard */
    else if (consistencyIndex.score < 40) {
      mode    = "standard";
      reason  = "Consistency is the priority right now. One standard session beats zero perfect ones.";
      confidence = "medium";
    }
    /* 6 — Evening & no peak data → creative flow */
    else if (hour >= 20 || hour < 6) {
      mode    = preferredMode?.mode === "deep" ? "creative" : (preferredMode?.mode || "standard");
      reason  = "Evening sessions tend toward creative or reflective work — switching modes helps.";
      confidence = "low";
    }
    /* 7 — Fallback: mirror the user's preferred mode */
    else {
      mode    = preferredMode?.mode || "standard";
      reason  = `Your go-to mode is ${MODES[mode]?.label ?? mode}. Staying consistent with what works.`;
      confidence = "low";
    }

    const modeData  = MODES[mode];
    const soundData = SOUNDSCAPES[mode];

    return {
      mode,
      duration:   modeData.focus,
      label:      modeData.label,
      icon:       modeData.icon,
      color:      modeData.color,
      reason,
      confidence,
      soundscape: soundData,
    };
  }

  /* ═══════════════════════════════════
     BANNER RENDERER
  ═══════════════════════════════════ */
  function render() {
    const banner = document.getElementById("adaptiveBanner");
    if (!banner) return;

    const rec = getRecommendation();
    if (!rec) {
      banner.style.display = "none";
      return;
    }

    banner.style.display = "";
    banner.style.setProperty("--adaptive-color", rec.color);

    const confBadge =
      rec.confidence === "high"   ? `<span class="adapt-conf adapt-conf-high">Strong signal</span>`  :
      rec.confidence === "medium" ? `<span class="adapt-conf adapt-conf-mid">Good signal</span>`    :
                                    `<span class="adapt-conf adapt-conf-low">Suggestion</span>`;

    banner.innerHTML = `
      <div class="adapt-left">
        <div class="adapt-icon">${rec.icon}</div>
        <div class="adapt-text">
          <div class="adapt-title">
            <strong>${rec.label}</strong>
            <span class="adapt-duration">${rec.duration} min</span>
            ${confBadge}
          </div>
          <div class="adapt-reason">${rec.reason}</div>
          ${rec.soundscape
            ? `<div class="adapt-sound">🔊 ${rec.soundscape.name} recommended</div>`
            : ""}
        </div>
      </div>
      <button class="adapt-apply-btn" onclick="ZenithAdaptiveFocus.apply('${rec.mode}')"
              aria-label="Apply ${rec.label} mode">
        Apply
      </button>
    `;
  }

  /* ── Apply the recommendation ── */
  function apply(mode) {
    if (typeof window.selectFocusMode === "function") {
      window.selectFocusMode(mode);

      /* Visual feedback */
      const btn = document.querySelector(".adapt-apply-btn");
      if (btn) {
        btn.textContent = "✓ Applied";
        btn.disabled    = true;
        btn.classList.add("adapt-applied");
        setTimeout(() => {
          btn.textContent = "Apply";
          btn.disabled    = false;
          btn.classList.remove("adapt-applied");
        }, 2500);
      }

      /* If soundscape is recommended and handleFocusMusic exists */
      const rec = getRecommendation();
      if (rec?.soundscape && typeof window.handleFocusMusic === "function") {
        window.handleFocusMusic("start");
      }
    }
  }

  /* ── Auto-dismiss banner after session starts ── */
  function _watchSessionStart() {
    const origToggle = window.toggleTimer;
    if (typeof origToggle !== "function") return;
    window.toggleTimer = function (...args) {
      origToggle.apply(this, args);
      const banner = document.getElementById("adaptiveBanner");
      if (banner && window.Session?.state === "running") {
        banner.classList.add("adapt-fade-out");
        setTimeout(() => {
          banner.classList.remove("adapt-fade-out");
          banner.style.display = "none";
        }, 400);
      }
    };
  }

  /* ── Init ── */
  document.addEventListener("DOMContentLoaded", () => {
    render();
    _watchSessionStart();

    /* Re-render when focus tab opens */
    const focusSection = document.getElementById("focusSection");
    if (focusSection) {
      new MutationObserver(() => {
        if (focusSection.classList.contains("active")) render();
      }).observe(focusSection, { attributes: true, attributeFilter: ["class"] });
    }
  });

  /* Hook auto-fired by app.js after each session */
  window.updateAdaptiveRecs = function () {
    /* Small delay so analytics cache is cleared first */
    setTimeout(render, 100);
  };

  return { getRecommendation, render, apply };
})();

window.ZenithAdaptiveFocus = ZenithAdaptiveFocus;
