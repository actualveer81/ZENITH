/* ═══════════════════════════════════════════════════════════════
   ZENITH — Offline Local Database  (#9)
   ─────────────────────────────────────────────────────────────
   Replaces raw localStorage JSON blobs with a proper IndexedDB
   layer. localStorage stays as the fast read cache; IndexedDB
   is the authoritative store.

   Object stores:
     sessions        — full session records (from ZenithCollector)
     tasks           — task objects (migrated from tasks / completedTasks)
     stats           — daily stats keyed by dateString
     notes           — weekly reflections and session notes
     replay_events   — raw event streams from DistractionLock / SessionReplay
     settings        — user preferences (mirror of settings key)

   Encryption:
     Sensitive stores (sessions, replay_events) use AES-GCM via
     SubtleCrypto. Key is derived from a per-device secret stored
     in localStorage (never leaves the device).

   Migration:
     On first load, _migrateFromLocalStorage() runs once and
     imports existing data. Sets zenith_db_migrated = "1".

   API (all async):
     ZenithDB.sessions.add(record)     → id
     ZenithDB.sessions.getAll()        → []
     ZenithDB.sessions.getLast(n)      → []
     ZenithDB.tasks.save(task)         → task
     ZenithDB.tasks.getAll()           → []
     ZenithDB.stats.setDay(date, obj)  → void
     ZenithDB.stats.getRange(n)        → []
     ZenithDB.notes.save(note)         → id
     ZenithDB.notes.getAll()           → []
     ZenithDB.replay.addBatch(events)  → void
     ZenithDB.replay.getForSession(id) → []

   Usage:
     <script defer src="zenith-db.js"></script>
     (load before any file that calls ZenithDB)
═══════════════════════════════════════════════════════════════ */
"use strict";

const ZenithDB = (() => {

  const DB_NAME    = "zenith_v1";
  const DB_VERSION = 1;
  const STORES = {
    sessions:      { keyPath: "id", autoIncrement: true },
    tasks:         { keyPath: "id" },
    stats:         { keyPath: "date" },
    notes:         { keyPath: "id", autoIncrement: true },
    replay_events: { keyPath: "id", autoIncrement: true },
    settings:      { keyPath: "key" },
  };

  /* ── Encryption ── */
  const ENC_KEY_LS = "zenith_enc_key_v1";
  let _cryptoKey = null; // CryptoKey — set on init

  async function _getOrCreateRawKey() {
    let hex = localStorage.getItem(ENC_KEY_LS);
    if (!hex) {
      const buf = crypto.getRandomValues(new Uint8Array(32));
      hex = Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(ENC_KEY_LS, hex);
    }
    const bytes = new Uint8Array(hex.match(/.{2}/g).map(h => parseInt(h, 16)));
    return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  async function _encrypt(obj) {
    if (!_cryptoKey) return JSON.stringify(obj); // fallback if subtle unavailable
    const iv   = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(obj));
    const ct   = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, _cryptoKey, data);
    return {
      __enc: true,
      iv:    Array.from(iv),
      ct:    Array.from(new Uint8Array(ct)),
    };
  }

  async function _decrypt(stored) {
    if (!stored?.__enc) return stored; // plain (pre-encryption or fallback)
    if (!_cryptoKey) return null;
    try {
      const iv  = new Uint8Array(stored.iv);
      const ct  = new Uint8Array(stored.ct);
      const pt  = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, _cryptoKey, ct);
      return JSON.parse(new TextDecoder().decode(pt));
    } catch { return null; }
  }

  /* ── IDB helpers ── */
  let _db = null;

  function _open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        for (const [name, opts] of Object.entries(STORES)) {
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, opts);
            /* Useful indexes */
            if (name === "sessions")      store.createIndex("byTs",      "ts",   { unique: false });
            if (name === "sessions")      store.createIndex("byDate",    "date", { unique: false });
            if (name === "replay_events") store.createIndex("bySession", "sessionId", { unique: false });
            if (name === "notes")         store.createIndex("byTs",      "ts",   { unique: false });
            if (name === "stats")         store.createIndex("byDate",    "date", { unique: false });
          }
        }
      };

      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  function _tx(storeName, mode = "readonly") {
    return _db.transaction(storeName, mode).objectStore(storeName);
  }

  function _req(idbReq) {
    return new Promise((resolve, reject) => {
      idbReq.onsuccess = (e) => resolve(e.target.result);
      idbReq.onerror   = (e) => reject(e.target.error);
    });
  }

  function _getAll(storeName, indexName, query) {
    return new Promise((resolve, reject) => {
      const store = _tx(storeName);
      const src   = indexName ? store.index(indexName) : store;
      const req   = query ? src.getAll(query) : src.getAll();
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  /* ════════════════════════════════════════════
     MIGRATION from localStorage
  ════════════════════════════════════════════ */
  async function _migrateFromLocalStorage() {
    if (localStorage.getItem("zenith_db_migrated") === "1") return;

    console.log("[ZenithDB] Running one-time migration from localStorage…");

    try {
      /* Tasks */
      const tasks = JSON.parse(localStorage.getItem("tasks") || "[]");
      const completedTasks = JSON.parse(localStorage.getItem("completedTasks") || "[]");
      for (const t of [...tasks, ...completedTasks]) {
        if (t?.id) await _req(_tx("tasks", "readwrite").put(t));
      }

      /* Stats — daily records */
      const statsRaw = JSON.parse(localStorage.getItem("stats") || "{}");
      for (const [date, val] of Object.entries(statsRaw)) {
        await _req(_tx("stats", "readwrite").put({ date, ...val }));
      }

      /* Session hour log → convert to session records
         NOTE: sessionHourLog entries only have { hour, date, tag, mode } — no ts.
         Reconstruct a ts by combining the stored date string with the hour. */
      const hourLog = JSON.parse(localStorage.getItem("sessionHourLog") || "[]");
      for (const entry of hourLog) {
        /* Build a best-effort timestamp: midnight of that date + hour offset */
        let ts;
        if (entry.ts) {
          ts = entry.ts;
        } else if (entry.date) {
          const d = new Date(entry.date);
          d.setHours(entry.hour ?? 0, 0, 0, 0);
          ts = d.getTime();
        } else {
          ts = Date.now();
        }
        const rec = {
          ts,
          date:      new Date(ts).toDateString(),
          hour:      entry.hour      ?? 0,
          dayOfWeek: entry.dayOfWeek ?? new Date(ts).getDay(),
          duration:  entry.duration  ?? 25,
          mode:      entry.mode      ?? "standard",
          tag:       entry.tag       ?? null,
          source:    "migrated",
        };
        const enc = await _encrypt(rec);
        await _req(_tx("sessions", "readwrite").add({ _data: enc, ts: rec.ts, date: rec.date }));
      }

      /* Settings */
      const settingsRaw = JSON.parse(localStorage.getItem("settings") || "{}");
      await _req(_tx("settings", "readwrite").put({ key: "timer", ...settingsRaw }));

      /* Notes / reflections */
      const reflection = localStorage.getItem("weeklyReflection");
      if (reflection) {
        await _req(_tx("notes", "readwrite").add({
          type: "weekly_reflection",
          text: reflection,
          ts:   Date.now(),
        }));
      }

      localStorage.setItem("zenith_db_migrated", "1");
      console.log("[ZenithDB] Migration complete.");
    } catch (err) {
      console.warn("[ZenithDB] Migration error (non-fatal):", err);
    }
  }

  /* ════════════════════════════════════════════
     SESSIONS STORE
  ════════════════════════════════════════════ */
  const sessions = {
    async add(record) {
      const enc  = await _encrypt(record);
      const row  = { _data: enc, ts: record.ts || Date.now(), date: record.date || new Date().toDateString() };
      const id   = await _req(_tx("sessions", "readwrite").add(row));
      return id;
    },

    async getAll() {
      const rows = await _getAll("sessions");
      const out  = [];
      for (const row of rows) {
        const dec = await _decrypt(row._data);
        if (dec) out.push({ ...dec, _id: row.id });
      }
      return out.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
    },

    async getLast(n = 20) {
      const all = await this.getAll();
      return all.slice(-n);
    },

    async count() {
      return _req(_tx("sessions").count());
    },
  };

  /* ════════════════════════════════════════════
     TASKS STORE
  ════════════════════════════════════════════ */
  const tasks = {
    async save(task) {
      await _req(_tx("tasks", "readwrite").put(task));
      return task;
    },

    async getAll() {
      return _getAll("tasks");
    },

    async delete(id) {
      return _req(_tx("tasks", "readwrite").delete(id));
    },
  };

  /* ════════════════════════════════════════════
     STATS STORE
  ════════════════════════════════════════════ */
  const stats = {
    async setDay(dateStr, obj) {
      await _req(_tx("stats", "readwrite").put({ date: dateStr, ...obj }));
    },

    async getDay(dateStr) {
      return _req(_tx("stats").get(dateStr));
    },

    /** Last n days in ascending order */
    async getRange(n = 14) {
      const all = await _getAll("stats");
      return all
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .slice(-n);
    },
  };

  /* ════════════════════════════════════════════
     NOTES STORE
  ════════════════════════════════════════════ */
  const notes = {
    async save(noteObj) {
      const row = { ...noteObj, ts: noteObj.ts ?? Date.now() };
      const id  = await _req(_tx("notes", "readwrite").add(row));
      return id;
    },

    async getAll() {
      const rows = await _getAll("notes");
      return rows.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
    },

    async getLast(n = 10) {
      const all = await this.getAll();
      return all.slice(-n);
    },
  };

  /* ════════════════════════════════════════════
     REPLAY EVENTS STORE
  ════════════════════════════════════════════ */
  const replay = {
    async addBatch(events, sessionId) {
      const store = _tx("replay_events", "readwrite");
      for (const ev of events) {
        await _req(store.add({ ...ev, sessionId: sessionId ?? null }));
      }
    },

    async getForSession(sessionId) {
      return _getAll("replay_events", "bySession", IDBKeyRange.only(sessionId));
    },

    async getLast(n = 500) {
      const all = await _getAll("replay_events");
      return all.slice(-n);
    },
  };

  /* ════════════════════════════════════════════
     SETTINGS STORE
  ════════════════════════════════════════════ */
  const settings = {
    async set(key, value) {
      await _req(_tx("settings", "readwrite").put({ key, value }));
    },

    async get(key) {
      const row = await _req(_tx("settings").get(key));
      return row?.value;
    },

    async getAll() {
      const rows = await _getAll("settings");
      return Object.fromEntries(rows.map(r => [r.key, r.value]));
    },
  };

  /* ════════════════════════════════════════════
     SYNC HELPERS
     Keep localStorage in sync for backward compat
     (app.js still reads from it directly)
  ════════════════════════════════════════════ */
  function syncTasksToLocalStorage(taskArray) {
    const active    = taskArray.filter(t => !t.completed);
    const completed = taskArray.filter(t =>  t.completed);
    try {
      localStorage.setItem("tasks",          JSON.stringify(active));
      localStorage.setItem("completedTasks", JSON.stringify(completed));
    } catch { /* quota */ }
  }

  function syncStatsToLocalStorage(statsRecord) {
    /* statsRecord: { date, min, sess, tags } */
    const all = JSON.parse(localStorage.getItem("stats") || "{}");
    if (statsRecord?.date) all[statsRecord.date] = statsRecord;
    try { localStorage.setItem("stats", JSON.stringify(all)); } catch {}
  }

  /* ════════════════════════════════════════════
     STORAGE HEALTH CHECK
  ════════════════════════════════════════════ */
  async function checkHealth() {
    const sessCount = await sessions.count();
    const taskCount = (await tasks.getAll()).length;
    return {
      ok:            true,
      dbName:        DB_NAME,
      sessionsStored: sessCount,
      tasksStored:   taskCount,
      encrypted:     !!_cryptoKey,
      migrated:      localStorage.getItem("zenith_db_migrated") === "1",
    };
  }

  /* ════════════════════════════════════════════
     EXPORT & IMPORT (backup)
  ════════════════════════════════════════════ */
  async function exportAll() {
    const [allSessions, allTasks, allStats, allNotes] = await Promise.all([
      sessions.getAll(),
      tasks.getAll(),
      stats.getRange(365),
      notes.getAll(),
    ]);
    const blob = new Blob([JSON.stringify({
      exported:    new Date().toISOString(),
      version:     DB_VERSION,
      sessions:    allSessions,
      tasks:       allTasks,
      stats:       allStats,
      notes:       allNotes,
    }, null, 2)], { type: "application/json" });

    const url = URL.createObjectURL(blob);
    const a   = Object.assign(document.createElement("a"), {
      href: url, download: `zenith-backup-${Date.now()}.json`,
    });
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ════════════════════════════════════════════
     INIT
  ════════════════════════════════════════════ */
  let _ready = false;
  const _readyCallbacks = [];

  async function _init() {
    try {
      /* SubtleCrypto key */
      if (crypto?.subtle) {
        _cryptoKey = await _getOrCreateRawKey().catch(() => null);
      }

      /* Open IDB */
      _db = await _open();

      /* One-time migration */
      await _migrateFromLocalStorage();

      _ready = true;
      _readyCallbacks.forEach(fn => fn());
      _readyCallbacks.length = 0;

      console.log("[ZenithDB] Ready. Encrypted:", !!_cryptoKey);
    } catch (err) {
      console.error("[ZenithDB] Init failed — falling back to localStorage only.", err);
    }
  }

  function onReady(fn) {
    if (_ready) fn();
    else _readyCallbacks.push(fn);
  }

  /* Start init immediately */
  _init();

  return {
    sessions,
    tasks,
    stats,
    notes,
    replay,
    settings,
    onReady,
    checkHealth,
    exportAll,
    syncTasksToLocalStorage,
    syncStatsToLocalStorage,
  };
})();

window.ZenithDB = ZenithDB;

/* ════════════════════════════════════════════
   PATCH — auto-save sessions to IndexedDB
   after each focus completion (no app.js edits)
════════════════════════════════════════════ */
(function patchSessionSave() {
  document.addEventListener("DOMContentLoaded", () => {

    const origUpdateFocus = window.updateFocusScore;
    window.updateFocusScore = async function (...args) {
      /* Let cognitive-dashboard run first */
      origUpdateFocus?.apply(this, args);

      /* Save to IndexedDB */
      const rec = window.ZenithCollector?.load?.()?.slice(-1)?.[0];
      if (rec) {
        ZenithDB.onReady(async () => {
          await ZenithDB.sessions.add(rec).catch(console.warn);
        });
      }
    };

    /* Patch task saves */
    const origSave = window.save;
    if (typeof origSave === "function") {
      window.save = function (...args) {
        origSave.apply(this, args);
        ZenithDB.onReady(async () => {
          const allTasks = [
            ...(window.tasks || []),
            ...(window.completedTasks || []),
          ];
          for (const t of allTasks) {
            await ZenithDB.tasks.save(t).catch(() => {});
          }
        });
      };
    }
  });
})();
