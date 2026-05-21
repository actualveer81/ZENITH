"use strict";
/* ═══════════════════════════════════════════════════════════════
   ZENITH — Electron Main Process  (single source of truth)
   ─────────────────────────────────────────────────────────────
   Phase 1 : Window · Mica / Acrylic · Tray · Global Shortcuts
   Phase 6 : Auto-Updater  (#18)
═══════════════════════════════════════════════════════════════ */

const {
  app, BrowserWindow, Tray, Menu, globalShortcut,
  ipcMain, nativeImage, shell, nativeTheme, Notification,
} = require("electron");
const path = require("path");

/* ── electron-updater (optional — omit if not using auto-update) ── */
let autoUpdater = null;
try {
  autoUpdater = require("electron-updater").autoUpdater;
} catch { /* electron-updater not installed — updates disabled gracefully */ }

/* ── electron-log (optional — falls back to console) ── */
let log;
try {
  log = require("electron-log");
  log.transports.file.level = "info";
} catch {
  log = {
    info:  (...a) => console.log("[ZENITH]",   ...a),
    warn:  (...a) => console.warn("[ZENITH]",  ...a),
    error: (...a) => console.error("[ZENITH]", ...a),
  };
}

/* ── Constants ── */
const IS_WIN  = process.platform === "win32";
const IS_MAC  = process.platform === "darwin";
const IS_DEV  = process.env.NODE_ENV === "development";
const ICON    = path.join(__dirname, "assets/icons/favicon-512.png");
const ICON_SM = path.join(__dirname, "assets/icons/favicon-96.png");

/* ── Module-level state ── */
let mainWindow = null;
let tray       = null;
let isQuitting = false;

/* ═══════════════════════════════════════════════════════════════
   WINDOW
═══════════════════════════════════════════════════════════════ */
function createWindow() {
  mainWindow = new BrowserWindow({
    width:     1300,
    height:    840,
    minWidth:  860,
    minHeight: 600,

    /* Frameless + custom title bar */
    frame:         false,
    titleBarStyle: IS_MAC ? "hiddenInset" : "hidden",
    ...(IS_WIN && {
      titleBarOverlay: {
        color:       "rgba(6,10,20,0)",   // transparent — app CSS handles bg
        symbolColor: "#4f9cf9",
        height:      40,
      },
    }),

    /* Transparency for Mica / Acrylic / Vibrancy */
    transparent:     IS_MAC,
    backgroundColor: IS_WIN
      ? "#00000000"
      : (nativeTheme.shouldUseDarkColors ? "#060a14" : "#fffbf5"),

    /* macOS vibrancy */
    ...(IS_MAC && {
      vibrancy:          "under-window",
      visualEffectState: "active",
    }),

    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration:  false,
      spellcheck:       false,
      devTools:         IS_DEV,
    },

    icon: ICON,
    show: false, // reveal after ready-to-show
  });

  /* Windows 11: Mica → Acrylic → plain fallback */
  if (IS_WIN) _applyWindowsMaterial(mainWindow);

  mainWindow.loadFile("index.html");

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (IS_DEV) mainWindow.webContents.openDevTools({ mode: "detach" });
  });

  /* Minimize-to-tray instead of close */
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      if (IS_WIN) mainWindow.minimize(); // prevents ghost in taskbar
      tray?.displayBalloon?.({
        iconType: "info",
        title:    "ZENITH is still running",
        content:  "Press Ctrl+Alt+Z or right-click the tray icon to open.",
      });
    }
  });

  mainWindow.on("closed", () => { mainWindow = null; });

  /* Sync native theme → renderer */
  nativeTheme.on("updated", () => {
    mainWindow?.webContents.send("native:theme-change", {
      isDark: nativeTheme.shouldUseDarkColors,
    });
  });
}

function _applyWindowsMaterial(win) {
  for (const mat of ["mica", "acrylic"]) {
    try {
      win.setBackgroundMaterial(mat);
      win._zenithMaterial = mat;
      return;
    } catch { /* try next */ }
  }
}

/* ═══════════════════════════════════════════════════════════════
   SYSTEM TRAY
═══════════════════════════════════════════════════════════════ */
function createTray() {
  const icon = nativeImage.createFromPath(ICON_SM);
  if (IS_MAC) icon.setTemplateImage(true); // grayscale template for macOS

  tray = new Tray(icon);
  tray.setToolTip("ZENITH — Build Deep. Rise Daily.");
  _buildTrayMenu();

  tray.on("double-click", showWindow);
  if (IS_WIN) tray.on("click", showWindow); // single-click on Windows
}

function _buildTrayMenu(opts = {}) {
  const { streak = 0, timerRunning = false, timerLabel = "--:--" } = opts;

  const menu = Menu.buildFromTemplate([
    /* Status rows */
    { label: streak > 0 ? `🔥  ${streak}-day streak` : "ZENITH", enabled: false },
    { label: timerRunning ? `⏱  ${timerLabel}` : "Timer not running",  enabled: false },
    { type: "separator" },

    /* Session controls */
    {
      label: "⚡  Start Focus Session",
      accelerator: "CmdOrCtrl+Alt+F",
      click() { mainWindow?.webContents.send("tray:action", "startFocus"); showWindow(); },
    },
    {
      label: "☕  Start Break",
      click() { mainWindow?.webContents.send("tray:action", "startBreak"); showWindow(); },
    },
    {
      label:       timerRunning ? "⏸  Pause Timer" : "▶  Resume Timer",
      accelerator: "CmdOrCtrl+Alt+P",
      click() { mainWindow?.webContents.send("tray:action", "pauseTimer"); },
    },
    { type: "separator" },

    /* Ambient sound sub-menu */
    {
      label: "🔊  Ambient Sound",
      submenu: [
        { label: "🌧  Rain",        click() { mainWindow?.webContents.send("tray:sound", "rain");       } },
        { label: "🌊  Ocean",       click() { mainWindow?.webContents.send("tray:sound", "ocean");      } },
        { label: "🌲  Forest",      click() { mainWindow?.webContents.send("tray:sound", "forest");     } },
        { label: "📻  White Noise", click() { mainWindow?.webContents.send("tray:sound", "whitenoise"); } },
        { type: "separator" },
        { label: "🔇  Off",         click() { mainWindow?.webContents.send("tray:sound", "off");        } },
      ],
    },
    { type: "separator" },

    /* Navigation */
    { label: "📊  Stats", click() { mainWindow?.webContents.send("tray:navigate", "stats"); showWindow(); } },
    { label: "✅  Tasks", click() { mainWindow?.webContents.send("tray:navigate", "tasks"); showWindow(); } },
    { type: "separator" },

    { label: "Open ZENITH", click: showWindow },
    { label: "Quit",        click() { isQuitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(menu);
}

/* ═══════════════════════════════════════════════════════════════
   GLOBAL SHORTCUTS
═══════════════════════════════════════════════════════════════ */
function registerShortcuts() {
  [
    {
      key: "CommandOrControl+Alt+F",
      fn() { mainWindow?.webContents.send("tray:action", "startFocus"); showWindow(); },
    },
    {
      key: "CommandOrControl+Alt+B",
      fn() { mainWindow?.webContents.send("tray:action", "startBreak"); },
    },
    {
      key: "CommandOrControl+Alt+P",
      fn() { mainWindow?.webContents.send("tray:action", "pauseTimer"); },
    },
    {
      key: "CommandOrControl+Alt+Z",
      fn() { mainWindow?.isFocused() ? mainWindow.hide() : showWindow(); },
    },
    {
      key: "CommandOrControl+Alt+D",
      fn() { mainWindow?.webContents.send("tray:action", "captureDistraction"); showWindow(); },
    },
  ].forEach(({ key, fn }) => {
    const ok = globalShortcut.register(key, fn);
    if (!ok && IS_DEV) log.warn(`Failed to register shortcut: ${key}`);
  });
}

/* ═══════════════════════════════════════════════════════════════
   IPC HANDLERS
═══════════════════════════════════════════════════════════════ */
function setupIPC() {
  /* Window chrome */
  ipcMain.on("window:minimize",   () => mainWindow?.minimize());
  ipcMain.on("window:maximize",   () =>
    mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  );
  ipcMain.on("window:close",      () => mainWindow?.close()); // triggers minimize-to-tray
  ipcMain.on("window:hide",       () => mainWindow?.hide());
  ipcMain.on("window:fullscreen", () =>
    mainWindow?.setFullScreen(!mainWindow.isFullScreen())
  );

  /* Tray badge / tooltip live updates from renderer */
  ipcMain.on("tray:update", (_, data) => {
    if (!tray) return;
    tray.setToolTip(
      data.streak > 0
        ? `ZENITH · 🔥 ${data.streak}d`
        : "ZENITH — Build Deep. Rise Daily."
    );
    _buildTrayMenu(data);
  });

  /* Native OS notification fallback (renderer is not focused) */
  ipcMain.on("notify", (_, { title, body }) => {
    if (!mainWindow?.isFocused()) {
      new Notification({ title, body, icon: ICON }).show();
    }
  });

  /* Window material query */
  ipcMain.handle("window:material", () => mainWindow?._zenithMaterial ?? "none");

  /* Open external link safely */
  ipcMain.on("open:url", (_, url) => {
    if (url.startsWith("https://")) shell.openExternal(url);
  });

  /* App quit (from renderer settings) */
  ipcMain.on("app:quit", () => { isQuitting = true; app.quit(); });
}

/* ═══════════════════════════════════════════════════════════════
   AUTO-UPDATER  (#18)
   Skipped gracefully if electron-updater is not installed.
═══════════════════════════════════════════════════════════════ */
function setupAutoUpdater() {
  if (!autoUpdater) {
    log.warn("electron-updater not found — auto-update disabled.");
    return;
  }

  autoUpdater.logger               = log;
  autoUpdater.channel              = "latest";  // change to "beta" for pre-releases
  autoUpdater.autoDownload         = true;      // download silently in background
  autoUpdater.autoInstallOnAppQuit = false;     // user decides when to restart

  /* Forward every updater event to the renderer */
  const sendToRenderer = (event, data) => {
    try { mainWindow?.webContents?.send(`updater-${event}`, data ?? null); }
    catch { /* window may be destroyed — ignore */ }
  };

  autoUpdater.on("checking-for-update",  ()     => sendToRenderer("checking"));
  autoUpdater.on("update-available",     (info) => sendToRenderer("available",     info));
  autoUpdater.on("update-not-available", (info) => sendToRenderer("not-available", info));
  autoUpdater.on("download-progress",    (prog) => sendToRenderer("progress",      prog));
  autoUpdater.on("update-downloaded",    (info) => sendToRenderer("downloaded",    info));
  autoUpdater.on("error", (err) => {
    log.error("AutoUpdater error:", err);
    sendToRenderer("error", { message: err?.message ?? String(err) });
  });

  /* Renderer → main: trigger a manual check */
  ipcMain.on("updater-check-now", () => {
    autoUpdater.checkForUpdates()
      .catch(e => log.warn("Manual update check failed:", e));
  });

  /* Renderer → main: quit and install the downloaded update */
  ipcMain.on("updater-install-now", () => {
    autoUpdater.quitAndInstall(/* isSilent= */ false, /* isForceRunAfter= */ true);
  });

  /* First check: 10 s after the window finishes loading
     Gives the app time to fully paint before any banner appears. */
  mainWindow.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      autoUpdater.checkForUpdates()
        .catch(e => log.warn("Startup update check failed:", e));
    }, 10_000);
  });

  /* Periodic check: every 4 hours */
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 4 * 60 * 60 * 1_000);
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════ */
function showWindow() {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/* ═══════════════════════════════════════════════════════════════
   APP LIFECYCLE
═══════════════════════════════════════════════════════════════ */
app.whenReady().then(() => {
  /* Single-instance lock — second launch shows the existing window */
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on("second-instance", showWindow);

  /* macOS: set Dock icon */
  if (IS_MAC) app.dock?.setIcon(ICON);

  setupIPC();
  createWindow();
  createTray();
  registerShortcuts();
  setupAutoUpdater(); // clean, isolated — no-ops if updater unavailable

  app.on("activate", () => {
    BrowserWindow.getAllWindows().length === 0 ? createWindow() : showWindow();
  });
});

/* Keep the process alive in the tray even if all windows are closed */
app.on("window-all-closed", () => { /* intentionally empty */ });

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
