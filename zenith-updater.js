"use strict";
/* ═══════════════════════════════════════════════════════════════
   ZENITH — Auto-Updater UI  (#18)
   ─────────────────────────────────────────────────────────────
   Listens for update events forwarded by main.js → preload.js
   and renders a professional in-app banner.

   Electron path  — uses the named listener methods exposed by
                    preload.js:  onUpdateAvailable · onUpdateProgress
                                 onUpdateDownloaded · onUpdateError

   PWA / web path — listens for SW_UPDATED messages from the
                    service worker and shows a "Refresh Now" banner.

   Non-Electron environments are handled gracefully (no-ops).

   Add to index.html:
     <script defer src="zenith-updater.js"></script>
═══════════════════════════════════════════════════════════════ */

const ZenithUpdater = (() => {

  const e = window.zenithElectron ?? null;  // null on web / PWA

  /* ─────────────────────────────────────────────────────────
     BANNER DOM
     The banner is created lazily on first use so it never
     pollutes the DOM until an update event actually fires.
  ───────────────────────────────────────────────────────── */
  let _banner = null;

  function _ensureBanner() {
    if (document.getElementById("znuBanner")) {
      _banner = document.getElementById("znuBanner");
      return;
    }

    _banner = document.createElement("div");
    _banner.id        = "znuBanner";
    _banner.className = "znu-banner";
    _banner.setAttribute("role", "status");
    _banner.setAttribute("aria-live", "polite");
    _banner.innerHTML = `
      <div class="znu-inner">
        <div class="znu-icon-wrap" id="znuIconWrap" aria-hidden="true">
          <svg class="znu-icon" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2">
            <polyline points="1 4 1 10 7 10"/>
            <path d="M3.51 15a9 9 0 1 0 .49-4.5"/>
          </svg>
        </div>
        <div class="znu-text">
          <div class="znu-title" id="znuTitle">Checking for updates…</div>
          <div class="znu-sub"   id="znuSub"></div>
        </div>
        <div class="znu-progress-wrap" id="znuProgressWrap" style="display:none">
          <div class="znu-progress-track">
            <div class="znu-progress-fill" id="znuProgressFill" style="width:0%"></div>
          </div>
          <span class="znu-progress-pct" id="znuProgressPct">0%</span>
        </div>
        <div class="znu-actions" id="znuActions"></div>
        <button class="znu-close" id="znuClose" aria-label="Dismiss update banner">✕</button>
      </div>`;

    document.body.prepend(_banner);
    document.getElementById("znuClose").addEventListener("click", hideBanner);
  }

  /* ─────────────────────────────────────────────────────────
     VISIBILITY
  ───────────────────────────────────────────────────────── */
  function showBanner(stateClass) {
    _ensureBanner();
    _banner.classList.remove(
      "znu-state-downloading", "znu-state-ready", "znu-state-error"
    );
    if (stateClass) _banner.classList.add(stateClass);
    requestAnimationFrame(() => _banner.classList.add("znu-visible"));
  }

  function hideBanner() {
    if (!_banner) return;
    _banner.classList.add("znu-hiding");
    setTimeout(() =>
      _banner?.classList.remove("znu-visible", "znu-hiding"), 400
    );
  }

  /* ─────────────────────────────────────────────────────────
     DOM HELPERS
  ───────────────────────────────────────────────────────── */
  function _text(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function _iconState(state) {
    const el = document.getElementById("znuIconWrap");
    if (el) el.className = `znu-icon-wrap znu-icon-${state}`;
  }

  function _setProgress(pct, visible = true) {
    const wrap  = document.getElementById("znuProgressWrap");
    const fill  = document.getElementById("znuProgressFill");
    const label = document.getElementById("znuProgressPct");
    if (wrap)  wrap.style.display    = visible ? "flex" : "none";
    if (fill)  fill.style.width      = `${pct}%`;
    if (label) label.textContent     = `${Math.round(pct)}%`;
  }

  function _setActions(html) {
    const el = document.getElementById("znuActions");
    if (el) el.innerHTML = html;
  }

  /* ─────────────────────────────────────────────────────────
     UPDATE STATE HANDLERS
  ───────────────────────────────────────────────────────── */
  function _onAvailable(info) {
    showBanner("znu-state-downloading");
    _iconState("download");
    _text("znuTitle", `Update v${info?.version ?? ""} available`);
    _text("znuSub",
      info?.releaseName
        ? `"${info.releaseName}" — downloading in the background`
        : "Downloading in the background…"
    );
    _setProgress(0, false);
    _setActions("");
  }

  function _onProgress(prog) {
    const pct   = Math.round(prog?.percent ?? 0);
    const speed = ((prog?.bytesPerSecond ?? 0) / 1_048_576).toFixed(1);
    const total = prog?.total        ? `${(prog.total        / 1_048_576).toFixed(1)} MB` : "";
    const xfer  = prog?.transferred  ? `${(prog.transferred  / 1_048_576).toFixed(1)} MB` : "";

    _text("znuTitle", "Downloading update…");
    _text("znuSub",
      total
        ? `${xfer} of ${total} · ${speed} MB/s`
        : `${pct}% · ${speed} MB/s`
    );
    _setProgress(pct, true);
  }

  function _onDownloaded(info) {
    showBanner("znu-state-ready");
    _iconState("ready");
    _text("znuTitle", `v${info?.version ?? "Update"} ready to install`);
    _text("znuSub",   "Restart ZENITH to apply — takes about 5 seconds.");
    _setProgress(0, false);
    _setActions(`
      <button class="znu-btn znu-btn-primary" id="znuInstallBtn">Restart &amp; Install</button>
      <button class="znu-btn znu-btn-ghost"   id="znuLaterBtn">Later</button>
    `);

    document.getElementById("znuInstallBtn")?.addEventListener("click", () => {
      _text("znuTitle", "Restarting to install…");
      _setActions("");
      e?.send("updater-install-now");
    });

    document.getElementById("znuLaterBtn")?.addEventListener("click", hideBanner);
  }

  function _onError(data) {
    /* Suppress noisy network errors that are not user-actionable */
    const msg = data?.message ?? String(data ?? "");
    if (/net::|ENOTFOUND|ETIMEDOUT/i.test(msg)) return;

    showBanner("znu-state-error");
    _iconState("error");
    _text("znuTitle", "Update check failed");
    _text("znuSub",   msg.length < 120 ? msg : "Check your internet connection.");
    _setActions(`
      <button class="znu-btn znu-btn-ghost" id="znuRetryBtn">Try Again</button>
    `);

    document.getElementById("znuRetryBtn")?.addEventListener("click", () => {
      e?.send("updater-check-now");
      _text("znuTitle", "Checking for updates…");
      _setActions("");
    });
  }

  /* ─────────────────────────────────────────────────────────
     PWA / SERVICE WORKER PATH
     Used for web builds where Electron is not present.
  ───────────────────────────────────────────────────────── */
  function _listenServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.addEventListener("message", (ev) => {
      if (ev.data?.type !== "SW_UPDATED") return;

      showBanner("znu-state-ready");
      _iconState("ready");
      _text("znuTitle", "ZENITH updated");
      _text("znuSub",   "A new version is ready. Refresh to activate.");
      _setActions(`
        <button class="znu-btn znu-btn-primary" id="znuSwRefresh">Refresh Now</button>
        <button class="znu-btn znu-btn-ghost"   id="znuSwLater">Later</button>
      `);

      document.getElementById("znuSwRefresh")
        ?.addEventListener("click", () => window.location.reload());
      document.getElementById("znuSwLater")
        ?.addEventListener("click", hideBanner);
    });
  }

  /* ─────────────────────────────────────────────────────────
     INIT
  ───────────────────────────────────────────────────────── */
  document.addEventListener("DOMContentLoaded", () => {

    /* PWA path — always listen in case we're in a browser */
    _listenServiceWorker();

    if (!e?.isElectron) return; /* web path is handled above */

    /* Wire Electron updater events via the named preload listeners */
    e.onUpdateAvailable(_onAvailable);
    e.onUpdateProgress(_onProgress);
    e.onUpdateDownloaded(_onDownloaded);
    e.onUpdateError(_onError);
    /* onUpdateNotAvailable / onUpdateChecking: intentionally silent */

    /* Trigger a check 8 s after load.
       main.js also checks at 10 s — this catches deferred opens. */
    setTimeout(() => e.send("updater-check-now"), 8_000);
  });

  /* Public API */
  return { showBanner, hideBanner };
})();

window.ZenithUpdater = ZenithUpdater;
