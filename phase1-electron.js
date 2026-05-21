/* ═══════════════════════════════════════════════════════════════
   ZENITH — Phase 1 JS Additions (phase1-electron.js)
   ─────────────────────────────────────────────────────────────
   HOW TO USE:
     1. Add  <script defer src="phase1-electron.js"></script>
        just BEFORE the closing </body> tag in index.html,
        AFTER <script defer src="app.js"></script>

     2. Also replace the old #app-splash block in index.html
        with the new one from phase1-splash.html

   What this file adds:
     · Enhanced splash (quotes, breathing ring logic)
     · Electron detection + body class flags
     · Tray IPC bridge (action / sound / navigate)
     · Custom title-bar wire-up
     · Tray tooltip live sync (streak, timer label)
     · Global shortcut hints injected into Settings
═══════════════════════════════════════════════════════════════ */
"use strict";

/* ════════════════════════════════════════════
   SPLASH — Enhanced with quotes
════════════════════════════════════════════ */
(function initSplash() {
  const QUOTES = [
    "Depth over speed. Presence over productivity.",
    "The mind that focuses is the mind that builds.",
    "Your future self is shaped in these quiet hours.",
    "Consistency is the compound interest of effort.",
    "Deep work is the superpower of this century.",
    "Every session is a vote for who you're becoming.",
    "Stillness is the canvas. Focus is the brush.",
    "Small blocks of deep work — large changes over time.",
    "The quality of your attention is the quality of your life.",
    "You cannot think deeply while multitasking.",
  ];

  const quoteEl = document.getElementById("splashQuote");
  if (quoteEl) {
    quoteEl.textContent = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  }

  /* Dismiss splash with smooth fade — replace old window.load handler */
  window.addEventListener("load", () => {
    const splash = document.getElementById("app-splash");
    if (!splash) return;

    /* Electron needs a touch more time to paint Mica behind the window */
    const delay = window.zenithElectron?.isElectron ? 1200 : 900;

    setTimeout(() => {
      splash.classList.add("splash-done");
      setTimeout(() => splash.remove(), 520);
    }, delay);
  });
})();


/* ════════════════════════════════════════════
   ELECTRON DETECTION & BODY FLAGS
════════════════════════════════════════════ */
(function detectElectron() {
  const e = window.zenithElectron;
  if (!e?.isElectron) return;

  /* Body flags used by CSS */
  document.body.classList.add("is-electron");
  if (e.platform === "darwin") document.body.classList.add("is-mac");
  if (e.platform === "win32")  document.body.classList.add("is-win");

  /* Query Mica material and add class */
  e.getMaterial?.().then((mat) => {
    if (mat === "mica" || mat === "acrylic") {
      document.body.classList.add("has-mica");
    }
  });

  /* Native theme sync */
  e.onThemeChange?.((data) => {
    if (data.isDark) {
      document.body.classList.remove("light");
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark", "nature");
      document.body.classList.add("light");
    }
  });
})();


/* ════════════════════════════════════════════
   ELECTRON CUSTOM TITLE BAR
   Inserts the bar and wires up window buttons.
════════════════════════════════════════════ */
(function initTitleBar() {
  if (!window.zenithElectron?.isElectron) return;

  const bar = document.createElement("div");
  bar.className = "zenith-titlebar";
  bar.setAttribute("aria-hidden", "true");
  bar.innerHTML = `
    <span class="titlebar-brand">ZENITH</span>
    <div class="titlebar-drag-area"></div>
    <div class="titlebar-controls">
      <button class="titlebar-btn minimize" title="Minimize" aria-label="Minimize">
        <svg viewBox="0 0 10 1" fill="none" xmlns="http://www.w3.org/2000/svg">
          <line x1="0" y1="0.5" x2="10" y2="0.5" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      </button>
      <button class="titlebar-btn maximize" title="Maximize" aria-label="Maximize">
        <svg viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="0.75" y="0.75" width="8.5" height="8.5" rx="0.5" stroke="currentColor" stroke-width="1.25"/>
        </svg>
      </button>
      <button class="titlebar-btn close" title="Minimize to Tray" aria-label="Minimize to tray">
        <svg viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
          <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5"/>
          <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      </button>
    </div>
  `;

  document.body.prepend(bar);

  bar.querySelector(".minimize")?.addEventListener("click", () => window.zenithElectron.minimize());
  bar.querySelector(".maximize")?.addEventListener("click", () => window.zenithElectron.maximize());
  bar.querySelector(".close")?.addEventListener("click",   () => window.zenithElectron.close());
})();


/* ════════════════════════════════════════════
   TRAY IPC BRIDGE
   Connects tray menu actions → existing app.js
   functions (startSession, toggleTimer, etc.)
════════════════════════════════════════════ */
(function initTrayBridge() {
  const e = window.zenithElectron;
  if (!e?.isElectron) return;

  /* Actions from tray → call existing app.js globals */
  e.onTrayAction((action) => {
    switch (action) {
      case "startFocus":
        /* If timer is idle, start a focus session */
        if (typeof startSession === "function") {
          startSession("focus", (window.settings?.focus ?? 25));
          _trayToast("⚡ Focus session started");
        }
        break;

      case "startBreak":
        if (typeof startSession === "function") {
          startSession("break", (window.settings?.break ?? 5));
          _trayToast("☕ Break started");
        }
        break;

      case "pauseTimer":
        if (typeof toggleTimer === "function") {
          toggleTimer();
          _trayToast("⏸ Timer toggled");
        }
        break;

      case "captureDistraction":
        if (typeof openModal === "function") {
          openModal("distractModal");
          _trayToast("📌 Distraction capture open");
        }
        break;

      default:
        console.warn("[ZENITH tray] Unknown action:", action);
    }
  });

  /* Sounds from tray — extend handleFocusMusic or your own sound map */
  e.onTraySound((sound) => {
    if (typeof handleFocusMusic === "function") {
      if (sound === "off") {
        handleFocusMusic("stop");
      } else {
        /* You can extend this with dedicated ambient audio elements */
        handleFocusMusic("start");
        _trayToast(`🔊 Sound: ${sound}`);
      }
    }
  });

  /* Navigate from tray */
  e.onTrayNavigate((section) => {
    if (typeof showSection === "function") showSection(section);
  });


  /* ── Live tray tooltip/menu sync ──
     Call this whenever streak or timer changes.
     Hook into the existing updateUI cycle.       */
  const _origUpdateUI = window.updateUI;
  if (typeof _origUpdateUI === "function") {
    window.updateUI = function (...args) {
      _origUpdateUI.apply(this, args);
      _syncTray();
    };
  }

  function _syncTray() {
    try {
      const streak      = Number(localStorage.getItem("streak") ?? 0);
      const running     = window.Session?.state === "running";
      const rem         = window.Session?.remaining ?? 0;
      const mm          = String(Math.floor(rem / 60)).padStart(2, "0");
      const ss          = String(rem % 60).padStart(2, "0");
      e.updateTray({ streak, timerRunning: running, timerLabel: `${mm}:${ss}` });
    } catch { /* silently ignore */ }
  }
})();


/* ════════════════════════════════════════════
   TRAY TOAST  (brief in-app notification)
   Shows when a tray shortcut fires
════════════════════════════════════════════ */
function _trayToast(message, durationMs = 2200) {
  // Remove existing
  document.querySelectorAll(".tray-toast").forEach(t => t.remove());

  const toast = document.createElement("div");
  toast.className = "tray-toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("out");
    setTimeout(() => toast.remove(), 350);
  }, durationMs);
}


/* ════════════════════════════════════════════
   SETTINGS — Electron shortcut hints
   Injects a new section into .kbd-grid
════════════════════════════════════════════ */
(function injectElectronShortcuts() {
  if (!window.zenithElectron?.isElectron) return;

  /* Wait for DOMContentLoaded so .kbd-grid exists */
  document.addEventListener("DOMContentLoaded", () => {
    const grid = document.querySelector(".kbd-grid");
    if (!grid) return;

    const section = document.createElement("div");
    section.className = "kbd-electron-section";
    section.innerHTML = `
      <span class="kbd-electron-label">Global Shortcuts (system-wide)</span>
      <div class="kbd-row"><kbd>Ctrl+Alt+F</kbd><span>Start Focus Session</span></div>
      <div class="kbd-row"><kbd>Ctrl+Alt+B</kbd><span>Start Break</span></div>
      <div class="kbd-row"><kbd>Ctrl+Alt+P</kbd><span>Pause / Resume Timer</span></div>
      <div class="kbd-row"><kbd>Ctrl+Alt+Z</kbd><span>Show / Hide ZENITH</span></div>
      <div class="kbd-row"><kbd>Ctrl+Alt+D</kbd><span>Capture Distraction</span></div>
    `;
    grid.appendChild(section);
  });
})();
