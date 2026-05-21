"use strict";
/* ═══════════════════════════════════════════════════════════════
   ZENITH — Electron Preload  (Context Bridge)
   ─────────────────────────────────────────────────────────────
   Single source of truth. Covers:
     Phase 1 : Window chrome · Tray · Theme sync
     Phase 6 : Auto-updater IPC  (#18)

   Exposes window.zenithElectron to the renderer without leaking
   any Node / Electron internals (contextIsolation: true).
═══════════════════════════════════════════════════════════════ */
const { contextBridge, ipcRenderer } = require("electron");

/* ── IPC channel whitelists ── */
const ALLOWED_SEND = new Set([
  "window:minimize", "window:maximize", "window:close",
  "window:hide",     "window:fullscreen",
  "tray:update",     "notify",           "open:url",   "app:quit",
  /* auto-updater */
  "updater-check-now", "updater-install-now",
]);

const ALLOWED_RECEIVE = new Set([
  "tray:action", "tray:sound", "tray:navigate", "native:theme-change",
  /* auto-updater */
  "updater-checking", "updater-available",     "updater-not-available",
  "updater-progress", "updater-downloaded",    "updater-error",
]);

/* ── Internal helper — safely attach an ipcRenderer listener ── */
function _safeOn(channel, handler) {
  if (!ALLOWED_RECEIVE.has(channel)) {
    console.error(`[preload] Blocked receive on unlisted channel: ${channel}`);
    return;
  }
  ipcRenderer.on(channel, handler);
}

/* ── Expose API to the renderer ── */
contextBridge.exposeInMainWorld("zenithElectron", {

  /* ─── Identity ──────────────────────────────── */
  isElectron: true,
  platform:   process.platform,                       // "win32" | "darwin" | "linux"
  version:    process.env.npm_package_version ?? "4.0.0",

  /* ─── Window chrome (custom title bar) ─────── */
  minimize()   { ipcRenderer.send("window:minimize");   },
  maximize()   { ipcRenderer.send("window:maximize");   },
  close()      { ipcRenderer.send("window:close");      },
  hide()       { ipcRenderer.send("window:hide");       },
  fullscreen() { ipcRenderer.send("window:fullscreen"); },

  /* ─── Generic whitelisted send ──────────────── */
  /**
   * Send a message to main.js on any whitelisted channel.
   * Used by the updater, notification system, etc.
   */
  send(channel, data) {
    if (!ALLOWED_SEND.has(channel)) {
      console.error(`[preload] Blocked send on unlisted channel: ${channel}`);
      return;
    }
    ipcRenderer.send(channel, data);
  },

  /* ─── Tray live update ───────────────────────
   * Call whenever streak, timer state, or label changes.
   * @param {{ streak: number, timerRunning: boolean, timerLabel: string }} data
   */
  updateTray(data) { ipcRenderer.send("tray:update", data); },

  /* ─── Window material query ──────────────────
   * Returns "mica" | "acrylic" | "none"
   */
  async getMaterial() { return ipcRenderer.invoke("window:material"); },

  /* ─── Open external URL safely ───────────────*/
  openURL(url) { ipcRenderer.send("open:url", url); },

  /* ─── Quit app ───────────────────────────────*/
  quit() { ipcRenderer.send("app:quit"); },

  /* ─── Tray / native event listeners ─────────
   * Actions : "startFocus" | "startBreak" | "pauseTimer" | "captureDistraction"
   * Sounds  : "rain" | "ocean" | "forest" | "whitenoise" | "off"
   * Sections: "home" | "focus" | "tasks" | "stats"
   */
  onTrayAction(cb)   { _safeOn("tray:action",        (_, v) => cb(v)); },
  onTraySound(cb)    { _safeOn("tray:sound",          (_, v) => cb(v)); },
  onTrayNavigate(cb) { _safeOn("tray:navigate",       (_, v) => cb(v)); },
  onThemeChange(cb)  { _safeOn("native:theme-change", (_, v) => cb(v)); },

  /* ─── Auto-updater listeners  (#18) ─────────
   * Named convenience wrappers — cleaner than a generic .on() in the renderer.
   */
  onUpdateChecking(cb)     { _safeOn("updater-checking",      (_, d) => cb(d)); },
  onUpdateAvailable(cb)    { _safeOn("updater-available",      (_, d) => cb(d)); },
  onUpdateNotAvailable(cb) { _safeOn("updater-not-available",  (_, d) => cb(d)); },
  onUpdateProgress(cb)     { _safeOn("updater-progress",       (_, d) => cb(d)); },
  onUpdateDownloaded(cb)   { _safeOn("updater-downloaded",     (_, d) => cb(d)); },
  onUpdateError(cb)        { _safeOn("updater-error",          (_, d) => cb(d)); },

  /* ─── Remove all listeners for a channel ────*/
  off(channel) {
    if (ALLOWED_RECEIVE.has(channel)) ipcRenderer.removeAllListeners(channel);
  },
});
