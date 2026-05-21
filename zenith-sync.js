/* ═══════════════════════════════════════════════════════════════
   ZENITH — Cloud Sync  (zenith-sync.js)  v2
   ─────────────────────────────────────────────────────────────
   Uses your shared Supabase project.  Users don't set anything
   up — they just sign in and their data syncs automatically.

   ► Uses the same SUPABASE_URL / SUPABASE_ANON_KEY from
     zenith-profile.js.  Data is scoped to auth.uid() via RLS
     so users only ever read/write their own rows.
═══════════════════════════════════════════════════════════════ */
"use strict";

const ZenithSync = (() => {

  /* Match the credentials in zenith-profile.js */
  const SUPABASE_URL      = window.ZENITH_SUPABASE_URL      ?? "https://YOUR_PROJECT_ID.supabase.co";
  const SUPABASE_ANON_KEY = window.ZENITH_SUPABASE_ANON_KEY ?? "YOUR_ANON_KEY_HERE";
  const REST              = `${SUPABASE_URL}/rest/v1`;

  /* localStorage keys to sync — everything meaningful */
  const SYNC_KEYS = [
    "settings", "tasks", "completedTasks", "stats",
    "xp", "streak", "lastStreakDate", "unlockedSkills",
    "sessionHourLog", "distractions", "unlockedAchievements",
    "notificationSettings", "silentMode", "appVolume",
    "zenith_session_log_v2", "zenith_replay_sessions_v1",
    "focusMode", "lastSessionTag",
  ];

  const LAST_SYNC_KEY = "zenith_last_sync_ts";
  const QUEUE_KEY     = "zenith_sync_queue";

  let _syncing    = false;
  let _online     = navigator.onLine;
  let _queue      = _loadQueue();
  let _flushTimer = null;

  /* ════════════════════════════════════════════
     AUTH HEADERS
     Uses the logged-in user's JWT from ZenithProfile
  ════════════════════════════════════════════ */
  function _headers(extraPrefer) {
    const session = window.ZenithProfile?.getSession?.();
    const token   = session?.access_token ?? SUPABASE_ANON_KEY;
    return {
      "Content-Type":  "application/json",
      "apikey":        SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${token}`,
      ...(extraPrefer ? { "Prefer": extraPrefer } : {}),
    };
  }

  function _isConfigured() {
    return SUPABASE_URL !== "https://YOUR_PROJECT_ID.supabase.co"
        && !!window.ZenithProfile?.isLoggedIn?.();
  }

  /* ════════════════════════════════════════════
     OFFLINE QUEUE
  ════════════════════════════════════════════ */
  function _loadQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); }
    catch { return []; }
  }

  function _saveQueue() {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(_queue.slice(-500))); }
    catch {}
  }

  function _enqueue(keys) {
    keys.forEach(k => { if (!_queue.includes(k)) _queue.push(k); });
    _saveQueue();
    clearTimeout(_flushTimer);
    _flushTimer = setTimeout(_flush, 2500);
  }

  async function _flush() {
    if (!_online || !_isConfigured() || _syncing || !_queue.length) return;
    const keys = [..._queue];
    _queue     = [];
    _saveQueue();
    await _pushKeys(keys);
  }

  /* ════════════════════════════════════════════
     PUSH  (local → server)
  ════════════════════════════════════════════ */
  async function _pushKeys(keys) {
    if (!_isConfigured()) return;

    await window.ZenithProfile?.ensureSession?.();

    const rows = keys.map(k => ({
      key:        k,
      value:      localStorage.getItem(k) ?? null,
      updated_at: new Date().toISOString(),
    }));

    try {
      const res = await fetch(`${REST}/zenith_sync`, {
        method:  "POST",
        headers: _headers("resolution=merge-duplicates,return=minimal"),
        body:    JSON.stringify(rows),
      });

      if (res.ok) {
        localStorage.setItem(LAST_SYNC_KEY, Date.now().toString());
        _updateBadge("synced");
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn("[ZenithSync] Push failed:", err.message);
      keys.forEach(k => { if (!_queue.includes(k)) _queue.push(k); });
      _saveQueue();
      _updateBadge("error");
    }
  }

  /* ════════════════════════════════════════════
     PULL  (server → local merge)
     Server row wins if its value differs from local.
  ════════════════════════════════════════════ */
  async function _pullAndMerge(full = false) {
    if (!_isConfigured()) return 0;

    await window.ZenithProfile?.ensureSession?.();

    _syncing = true;
    _updateBadge("syncing");

    try {
      const since = full ? null : Number(localStorage.getItem(LAST_SYNC_KEY) || 0);
      const filter = since
        ? `&updated_at=gt.${new Date(since).toISOString()}`
        : "";

      const res = await fetch(
        `${REST}/zenith_sync?select=key,value${filter}&order=updated_at.asc`,
        { headers: _headers() }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();

      let merged = 0;
      rows.forEach(row => {
        if (!SYNC_KEYS.includes(row.key)) return;
        const local = localStorage.getItem(row.key);
        if (local !== row.value) {
          row.value === null
            ? localStorage.removeItem(row.key)
            : localStorage.setItem(row.key, row.value);
          merged++;
        }
      });

      if (merged > 0) _rehydrate();

      localStorage.setItem(LAST_SYNC_KEY, Date.now().toString());
      _syncing = false;
      _updateBadge("synced");
      return merged;

    } catch (err) {
      console.warn("[ZenithSync] Pull failed:", err.message);
      _syncing = false;
      _updateBadge("error");
      return 0;
    }
  }

  /* ════════════════════════════════════════════
     REHYDRATE  — refresh UI after a pull
  ════════════════════════════════════════════ */
  function _rehydrate() {
    try {
      if (typeof updateUI           === "function") updateUI();
      if (typeof renderTasks        === "function") renderTasks();
      if (typeof updateSkillTree    === "function") updateSkillTree();
      if (typeof updateFocusScore   === "function") updateFocusScore();
      window.ZenithAnalytics?.invalidate?.();
      window.ZenithAnalyticsUI?.render?.();
      window.ZenithSkillTree?.render?.();
      window.ZenithCognitiveDashboard?.render?.();
    } catch (err) {
      console.warn("[ZenithSync] Rehydrate error:", err.message);
    }
  }

  /* ════════════════════════════════════════════
     PUBLIC API
  ════════════════════════════════════════════ */
  async function push(keys) {
    _enqueue(Array.isArray(keys) ? keys : [keys]);
  }

  async function pull() {
    return _pullAndMerge(false);
  }

  async function sync() {
    await _pullAndMerge(true);
    await _pushKeys([...SYNC_KEYS]);
  }

  async function pushAll() {
    await _pushKeys([...SYNC_KEYS]);
  }

  function isConfigured() { return _isConfigured(); }

  function getLastSyncTime() {
    const ts = Number(localStorage.getItem(LAST_SYNC_KEY) || 0);
    return ts ? new Date(ts) : null;
  }

  /* ════════════════════════════════════════════
     STATUS BADGE
  ════════════════════════════════════════════ */
  let _badge = null;

  function _ensureBadge() {
    if (document.getElementById("znSyncBadge")) {
      _badge = document.getElementById("znSyncBadge");
      return;
    }
    _badge = document.createElement("div");
    _badge.id        = "znSyncBadge";
    _badge.className = "zns-badge zns-idle";
    _badge.innerHTML = `
      <svg class="zns-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="23 4 23 10 17 10"/>
        <polyline points="1 20 1 14 7 14"/>
        <path d="M3.51 15a9 9 0 1 0 .49-4.5"/>
      </svg>
      <span id="znSyncLabel">Sync</span>`;
    document.body.appendChild(_badge);
  }

  function _updateBadge(state) {
    _ensureBadge();
    if (!_badge) return;
    _badge.className = `zns-badge zns-${state}`;
    const label = document.getElementById("znSyncLabel");
    if (!label) return;

    if (state === "syncing") {
      label.textContent = "Syncing…";
    } else if (state === "synced") {
      const t = getLastSyncTime();
      label.textContent = t ? `Synced ${_timeAgo(t)}` : "Synced";
      setTimeout(() => { if (_badge) _badge.className = "zns-badge zns-synced-idle"; }, 4000);
    } else if (state === "error") {
      label.textContent = "Sync error";
    } else {
      label.textContent = _isConfigured() ? "Cloud sync" : "Offline";
    }
  }

  function _timeAgo(date) {
    const s = Math.round((Date.now() - date.getTime()) / 1000);
    if (s < 60)   return "just now";
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    return `${Math.round(s / 3600)}h ago`;
  }

  /* ════════════════════════════════════════════
     HOOK INTO APP.JS
  ════════════════════════════════════════════ */
  function _hookAppJs() {
    /* Push after task/settings saves */
    const origSave = window.save;
    if (typeof origSave === "function") {
      window.save = function (...args) {
        origSave.apply(this, args);
        _enqueue(["tasks", "completedTasks", "settings", "stats", "xp", "streak", "lastStreakDate"]);
      };
    }

    /* Push everything after a focus session completes */
    const origFocus = window.updateFocusScore;
    window.updateFocusScore = function (...args) {
      origFocus?.apply(this, args);
      /* Small delay so localStorage writes finish first */
      setTimeout(() => _enqueue([...SYNC_KEYS]), 300);
    };
  }

  /* ════════════════════════════════════════════
     INIT
  ════════════════════════════════════════════ */
  document.addEventListener("DOMContentLoaded", () => {
    _ensureBadge();
    _hookAppJs();

    window.addEventListener("online",  () => { _online = true;  _flush(); });
    window.addEventListener("offline", () => { _online = false; _updateBadge("error"); });
    window.addEventListener("focus",   () => { if (_isConfigured() && _online) _pullAndMerge(false); });

    /* Initial sync after auth is confirmed (wait for ZenithProfile to finish) */
    setTimeout(() => {
      if (_isConfigured()) {
        sync();
      } else {
        _updateBadge("idle");
        /* Retry once ZenithProfile signs in */
        window.addEventListener("zp:loggedin", () => {
          setTimeout(sync, 500);
        }, { once: true });
      }
    }, 2000);
  });

  return { push, pushAll, pull, sync, isConfigured, getLastSyncTime };
})();

window.ZenithSync = ZenithSync;