"use strict";
/* ═══════════════════════════════════════════════
   ZENITH — Cognitive Performance Companion
   Version: 4.0 — World's Best Focus App
   Philosophy: Focus · Momentum · Identity · Consistency
═══════════════════════════════════════════════ */

/* ── DOM REFERENCES ── */
const BASE_TITLE = "ZENITH — Build Deep. Rise Daily.";
const timeEl       = document.getElementById("time");
const tasksEl      = document.getElementById("tasks");
const activeTaskEl = document.getElementById("activeTask");
const todayMinEl   = document.getElementById("todayMin");
const todaySessEl  = document.getElementById("todaySess");
const weekMinEl    = document.getElementById("weekMin");
const focusIn      = document.getElementById("focusIn");
const breakIn      = document.getElementById("breakIn");
const longIn       = document.getElementById("longIn");
const taskName     = document.getElementById("taskName");
const taskSessions = document.getElementById("taskSessions");
const focusSound   = document.getElementById("focusSound");
const breakSound   = document.getElementById("breakSound");
const longBreakSound = document.getElementById("longBreakSound");

/* Cached references to avoid repeated querySelector in the 1-second tick loop */
let _focusCardEl    = null;  // lazily cached after DOM is ready
let _overlayProgEl  = null;  // focusOverlay .progress ring
function _focusCard()   { return _focusCardEl   || (_focusCardEl   = document.querySelector(".focus-card")); }
function _overlayProg() { return _overlayProgEl || (_overlayProgEl = document.querySelector("#focusOverlay .progress")); }

// Progress ring references
const allRingProgs = document.querySelectorAll(".ring-prog");
const allRingGlows = document.querySelectorAll(".ring-glow");
const CIRCUMFERENCE = 534;
allRingProgs.forEach(r => { r.style.strokeDasharray = CIRCUMFERENCE; r.style.strokeDashoffset = CIRCUMFERENCE; });
allRingGlows.forEach(r => { r.style.strokeDasharray = CIRCUMFERENCE; r.style.strokeDashoffset = CIRCUMFERENCE; });

/* ── STORAGE ── */
let settings = JSON.parse(localStorage.getItem("settings")) || { focus:25, break:5, long:15 };
let tasks = JSON.parse(localStorage.getItem("tasks")) || [];
let completedTasks = JSON.parse(localStorage.getItem("completedTasks")) || [];
let stats = JSON.parse(localStorage.getItem("stats")) || {};
let xp = Number(localStorage.getItem("xp")) || 0;
let streak = Number(localStorage.getItem("streak")) || 0;
let lastStreakDate = localStorage.getItem("lastStreakDate");
let activeTaskId = Number(localStorage.getItem("activeTaskId")) || null;
let notificationSettings = JSON.parse(localStorage.getItem("notificationSettings")) || { focusComplete: true };
let unlockedAchievements = JSON.parse(localStorage.getItem("unlockedAchievements")) || {};
let silentMode = localStorage.getItem("silentMode") === "true";
let appVolume = parseFloat(localStorage.getItem("appVolume")) || 1;
let dragTaskId = null;
let decompressionActive = false;
let focusCountSinceDecompress = 0;
let meditationTimer = null, meditationInterval = null, meditationCountdown = null;
let deepFocus = false;
let focusCycle = 0;
let focusMusicEnabled = true;
let pendingNotifications = JSON.parse(localStorage.getItem("pendingNotifications")) || [];

const today     = new Date().toDateString();
const yesterday = new Date(Date.now()-86400000).toDateString();

function ensureTodayStats() {
  if (!stats[today]) stats[today] = { min:0, sess:0 };
}
ensureTodayStats();

function save() {
  localStorage.setItem("settings", JSON.stringify(settings));
  localStorage.setItem("tasks", JSON.stringify(tasks));
  localStorage.setItem("completedTasks", JSON.stringify(completedTasks));
  localStorage.setItem("stats", JSON.stringify(stats));
  localStorage.setItem("xp", xp);
  localStorage.setItem("streak", streak);
  localStorage.setItem("lastStreakDate", lastStreakDate);
  if (activeTaskId !== null) localStorage.setItem("activeTaskId", activeTaskId);
  else localStorage.removeItem("activeTaskId");
}

/* ── SESSION ENGINE ── */
let timerInterval = null;
let autoStart = true;

let Session = {
  mode:      "focus",
  state:     "idle",
  total:     settings.focus * 60,
  remaining: settings.focus * 60,
  endTime:   null,
  startedAt: null,
  pauseTime: null,
  taskStartTime: null
};

function setFocusMode(on) {
  document.body.classList.toggle("focus-mode", on);
  document.body.classList.remove("deep-focus");
  document.querySelector(".focus-overlay")?.classList.remove("active");
}

function startSession(mode, duration) {
  Session.mode       = mode;
  Session.state      = "running";
  Session.total      = duration * 60;
  Session.remaining  = Session.total;
  Session.startedAt  = Date.now();
  Session.taskStartTime = Date.now();
  Session.pauseTime  = null;
  Session.endTime    = Session.startedAt + Session.total * 1000;

  clearInterval(timerInterval);
  timerInterval = setInterval(tick, 1000);

  setFocusMode(mode === "focus");
  showQuote(mode === "focus" ? "focusStart" : "breakStart");

  if (mode === "focus") {
    const task = autoSelectActiveTask();  // safe to mutate here — we're starting a session
    if (task) {
      const left = remainingSessions(task);
      showToast(`🎯 ${task.name} · ${left} left`);
    } else {
      showToast("💡 Add a task to track your session");
    }
    setFocusState("start");
  } else {
    handleFocusMusic("stop");
  }

  updateTimerButton();
  updateDocumentTitle();
  updateUI();
  if (deepFocus && mode === "focus") updateFocusOverlay();
}

function tick() {
  if (Session.state !== "running") return;
  Session.remaining = Math.max(0, Math.ceil((Session.endTime - Date.now()) / 1000));
  if (Session.remaining === 0) {
    clearInterval(timerInterval);
    Session.state = "completed";
    document.title = BASE_TITLE;
    updateTimerButton();
    handleCompletion();
    return;
  }
  updateTimerUI();
  updateDocumentTitle();
  if (deepFocus && Session.mode === "focus") updateFocusOverlay();
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Session.state === "running") { tick(); updateDocumentTitle(); }
});

function toggleTimer() {
  if (Session.state === "idle") {
    const mode = Session.mode;
    // Emotional State Check (Feature 3): ask once per day before first focus session
    if (mode === "focus" && _shouldShowEmotionCheck()) {
      openModal("emotionModal");
      pendingTimerStart = true;
      return;
    }
    if (mode === "break")  startSession("break",  settings.break);
    else if (mode === "long") startSession("long", settings.long);
    else startSession("focus", settings.focus);
    updateTimerButton();
    return;
  }
  if (Session.state === "running") {
    if (deepFocus && Session.mode === "focus") {
      const prog = (Session.total - Session.remaining) / Session.total;
      if (prog < 0.25) { showToast("🔒 Deep focus: stay with it."); return; }
    }
    Session.pauseTime = Date.now();
    Session.state = "paused";
    clearInterval(timerInterval);
    document.title = BASE_TITLE;
    setFocusMode(false);
    setFocusState("pause");
    updateTimerButton();
    updateUI();
    // Recovery Engine (Feature 2): trigger if paused before 80% done AND > 90s elapsed
    if (Session.mode === "focus") {
      const elapsed = Session.total - Session.remaining;
      const pct = Session.remaining / Session.total;
      // Feature 7 — track resistance: increment if active task exists
      if (pct > 0.15 && elapsed > 60 && activeTaskId) {
        incrementResistance(activeTaskId);
        renderTasks(); // re-render to show/update badge
      }
      if (pct > 0.20 && elapsed > 90) showRecoveryOverlay();
    }
    return;
  }
  if (Session.state === "paused") {
    const pausedFor = Date.now() - Session.pauseTime;
    Session.startedAt += pausedFor;
    Session.endTime   += pausedFor;
    Session.state = "running";
    timerInterval = setInterval(tick, 1000);
    setFocusMode(Session.mode === "focus");
    updateDocumentTitle();
    updateTimerButton();
    if (Session.mode === "focus") setFocusState("resume");
    updateUI();
    return;
  }
  if (Session.state === "completed") { nextPhase(); updateTimerButton(); }
}

function updateTimerButton() {
  const btn = document.getElementById("timerToggleBtn");
  const labels = { idle:"Start", running:"Pause", paused:"Resume", completed:"Next →" };
  btn.textContent = labels[Session.state] || "Start";
  // Running state adds pulse class to ring wrap
  const wrap = document.getElementById("timerWrap");
  if (wrap) wrap.classList.toggle("timer-running", Session.state === "running");
}

function updateDocumentTitle() {
  if (Session.state !== "running") { document.title = BASE_TITLE; return; }
  const min = Math.floor(Session.remaining/60).toString().padStart(2,"0");
  const sec = (Session.remaining%60).toString().padStart(2,"0");
  const phase = Session.mode==="break" ? "☕" : Session.mode==="long" ? "🌿" : "🎯";
  const task = getActiveTask?.();
  const suffix = task ? ` · ${shortName(task.name)}` : "";
  document.title = `${phase} ${min}:${sec}${suffix}`;
}

function resetPomodoro() {
  if (deepFocus && Session.mode === "focus") { showToast("🔒 Exit deep focus first (ESC)"); return; }
  clearInterval(timerInterval);
  Session.state = "idle";
  Session.total     = settings[Session.mode === "break" ? "break" : Session.mode === "long" ? "long" : "focus"] * 60;
  Session.remaining = Session.total;
  Session.startedAt = null;
  Session.endTime   = null;
  setFocusMode(false);
  document.title = BASE_TITLE;
  handleFocusMusic("stop");
  updateTimerButton();
  updateUI();
}

function restartSession() {
  clearInterval(timerInterval);
  const dur = settings[Session.mode === "break" ? "break" : Session.mode === "long" ? "long" : "focus"];
  startSession(Session.mode, dur);
  showToast("🔁 Session restarted");
}

function skipBreak() {
  if (Session.mode !== "break" && Session.mode !== "long") return;
  clearInterval(timerInterval);
  Session.state = "completed";
  Session.mode  = "focus";
  showToast("⏭ Break skipped");
  startSession("focus", settings.focus);
}

function nextPhase() {
  if (decompressionActive) return;
  if (Session.mode === "focus") {
    focusCycle++;
    const isLong = focusCycle % 4 === 0;
    startSession(isLong ? "long" : "break", isLong ? settings.long : settings.break);
  } else {
    startSession("focus", settings.focus);
  }
  updateTimerButton();
}

/* ── COMPLETION ── */
function handleCompletion() {
  ensureTodayStats();
  if (Session.mode === "focus") {
    deepFocus = false;
    document.getElementById("focusOverlay")?.classList.remove("active");
    document.body.classList.remove("deep-focus");
    stats[today].sess++;
    stats[today].min += Math.round(Session.total / 60);
    // Feature 6: save session tag
    if (currentSessionTag) {
      if (!stats[today].tags) stats[today].tags = {};
      stats[today].tags[currentSessionTag] = (stats[today].tags[currentSessionTag] || 0) + 1;
    }
    // Feature 7: clear resistance on successful completion
    if (activeTaskId) clearResistance(activeTaskId);
    // Behavioral patterns: log session hour
    logSessionHour();
    xp += getXpForSession();
    checkSkillUnlocks(xp);
    const task = getActiveTask();
    if (task) task.minutes = (task.minutes || 0) + Math.round(Session.total / 60);
    updateStreakForToday();
    let summary = null;
    if (task) summary = { name: task.name, done: task.done + 1, total: task.sessions };
    updateTaskProgress();
    showFocusComplete(summary);
    playSound(focusSound);
    showToast("✨ One honest session done.", 2500);
    showQuote("focusEnd");
    save();
    Session.state = "completed";
    updateUI();
    setFocusState("end");
    focusCountSinceDecompress++;
    updateFocusScore?.();
    updateRecoveryScore?.();
    updateSkillTree?.();
    updateAdaptiveRecs?.();
    updateBehavioralPatterns?.();
    refreshDashboardNow?.();   // bypass throttle — values just changed
    return;
  }
  playSound(breakSound);
  sendNotification("Break finished ☕", "Ready for the next focus session?");
  showQuote("breakEnd");
  save();
  if (autoStart) nextPhase();
  else { Session.state = "completed"; updateUI(); }
}

function showFocusComplete(summary) {
  if (!notificationSettings.focusComplete) return;
  const minutes = Math.round(Session.total / 60);
  const taskLine = summary ? `${summary.name} (${summary.done}/${summary.total})` : "No active task";
  sendNotification("🎯 Focus Complete", `⏱ ${minutes}m · 📌 ${taskLine}\n🔥 ${streak} day streak · ⭐ ${xp} XP`);
}

/* ── TIMER UI ── */
function updateTimerUI() {
  if (!timeEl) return;
  const m = Math.floor(Session.remaining/60).toString().padStart(2,"0");
  const s = (Session.remaining%60).toString().padStart(2,"0");
  const timeStr = `${m}:${s}`;
  timeEl.textContent = timeStr;

  // Use cached reference — avoids querySelector(".focus-card") every second
  const fc = _focusCard();
  if (fc) fc.classList.toggle("timer-running", Session.state === "running" && Session.mode === "focus");

  // Focus overlay
  const fTime = document.getElementById("focusTime");
  if (fTime) fTime.textContent = timeStr;

  // Update all progress rings — batch all style writes together
  const offset = Session.total > 0
    ? CIRCUMFERENCE - (Session.remaining / Session.total) * CIRCUMFERENCE
    : 0;
  allRingProgs.forEach(r => r.style.strokeDashoffset = offset);
  allRingGlows.forEach(r => r.style.strokeDashoffset = offset);

  // Cached overlay ring reference
  const op = _overlayProg();
  if (op) op.style.strokeDashoffset = offset;

  // State label
  const lbl = document.getElementById("timerStateLabel");
  if (lbl) {
    const labels = { idle:"ready", running:"focusing", paused:"paused", completed:"done" };
    lbl.textContent = labels[Session.state] || "";
  }

  // Phase badge
  updatePhaseBadge();

  // Cycle dots
  updateCycleDots();
}

function updatePhaseBadge() {
  const badge = document.getElementById("phaseBadge");
  if (!badge) return;
  badge.className = "phase-badge";
  if (Session.mode === "break") {
    badge.className += " break";
    badge.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg> Short Break';
  } else if (Session.mode === "long") {
    badge.className += " long";
    badge.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 8C8 10 5.9 16.17 3.82 22H5.71c.38-.81.8-1.6 1.29-2.34C8.84 21.24 10.91 22 13.3 22 19 22 21 16 21 8l-1.5-1L17 8z"/></svg> Long Break';
  } else {
    badge.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Focus Session';
  }
}

function updateCycleDots() {
  const dots = document.querySelectorAll(".cycle-dot");
  const current = focusCycle % 4;
  const isFocus = Session.mode === "focus";
  // Read phase: compute desired classes without touching the DOM
  const newClasses = Array.from(dots).map((_, i) => {
    if (i < current) return "cycle-dot done";
    if (i === current && isFocus) return "cycle-dot current";
    return "cycle-dot";
  });
  // Write phase: apply all at once — no interleaved read/write = no forced reflow
  dots.forEach((dot, i) => { dot.className = newClasses[i]; });
}

/* ── STREAK ── */
function updateStreakForToday() {
  const t = new Date().toDateString();
  const y = new Date(Date.now()-86400000).toDateString();
  if (lastStreakDate === t) return;
  if (lastStreakDate === y) streak++;
  else if (lastStreakDate !== t) streak = 1;
  lastStreakDate = t;
  save();
}

/* ── SOUND ── */
function playSound(sound) {
  if (!sound || silentMode) return;
  sound.currentTime = 0;
  sound.play().catch(()=>{});
}

/* ── TOAST ── */
let toastTimer = null;
function showToast(text, duration = 2500) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.innerHTML = text;
  el.hidden = false;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => { el.hidden = true; }, 300);
  }, duration);
}

/* ── TASKS ── */
function addTask() {
  const name = taskName?.value.trim();
  const sessions = parseInt(taskSessions?.value) || 1;
  const due = document.getElementById("taskDue")?.value || null;
  if (!name) { showToast("⚠ Enter a task name"); return; }
  tasks.push({ id: Date.now(), name, sessions, done:0, due, minutes:0 });
  taskName.value = "";
  taskSessions.value = "2";
  document.getElementById("taskDue").value = "";
  save();
  renderTasks();
  updateUI();
  closeModal();
  showToast(`✅ "${name}" added`);
}

function editTask(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  document.getElementById("editTaskId").value = id;
  document.getElementById("editTaskName").value = t.name;
  document.getElementById("editTaskSessions").value = t.sessions;
  document.getElementById("editTaskDue").value = t.due || "";
  openModal("editTaskModal");
}

function saveEditTask() {
  const id = Number(document.getElementById("editTaskId").value);
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  const name = document.getElementById("editTaskName").value.trim();
  const sessions = parseInt(document.getElementById("editTaskSessions").value) || 1;
  const due = document.getElementById("editTaskDue").value || null;
  if (!name) { showToast("⚠ Name cannot be empty"); return; }
  t.name = name;
  t.sessions = Math.max(t.done, sessions); // never lower below done
  t.due = due;
  save();
  renderTasks();
  updateUI();
  closeModal();
  showToast("✏️ Task updated");
}

function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  if (activeTaskId === id) activeTaskId = null;
  save();
  renderTasks();
  updateUI();
  showToast("🗑 Task deleted");
}

function linkTask(id) {
  activeTaskId = id;
  save();
  renderTasks();
  updateUI();
  const t = tasks.find(t => t.id === id);
  if (t) showToast(`📌 Linked: ${shortName(t.name)}`);
}

function getActiveTask() {
  if (!tasks || !tasks.length) return null;
  // Only look up — never mutate here. Use setActiveTask() explicitly to change.
  return tasks.find(t => t.id === activeTaskId && t.done < t.sessions)
    || tasks.find(t => t.done < t.sessions)
    || null;
}

/** Auto-select the best pending task as active and persist. Call from session start, not from UI renders. */
function autoSelectActiveTask() {
  if (!tasks || !tasks.length) return null;
  const current = tasks.find(t => t.id === activeTaskId && t.done < t.sessions);
  if (current) return current;
  const next = tasks.find(t => t.done < t.sessions);
  if (next) { activeTaskId = next.id; save(); }
  return next || null;
}

function setActiveTask(id) { activeTaskId = id; save(); renderTasks(); }

function remainingSessions(task) { return Math.max(0, task.sessions - task.done); }

function getAllTasks() { return tasks.filter(t => t.done < t.sessions); }

function updateTaskProgress() {
  const task = tasks.find(t => t.id === activeTaskId);
  if (!task) return;
  task.done++;
  if (task.done >= task.sessions) {
    showToast(`✅ "${task.name}" complete!`, 3000);
    notifyTaskCompletion(task);
    completedTasks.push({
      name: task.name, sessions: task.sessions,
      date: today, due: task.due, completedAt: Date.now()
    });
    tasks = tasks.filter(t => t.id !== task.id);
    activeTaskId = null;
  } else {
    const left = remainingSessions(task);
    showToast(`🎯 ${task.name} · ${left} left`);
  }
  save();
  renderTasks();
}

function renderTasks() {
  if (!tasksEl) return;
  tasksEl.innerHTML = "";
  const now = new Date(); now.setHours(0,0,0,0);
  const sections = { overdue:[], today:[], soon:[], later:[] };

  const sorted = [...tasks].sort((a,b) => {
    const da = a.due ? new Date(a.due) : Infinity;
    const db = b.due ? new Date(b.due) : Infinity;
    return da - db;
  });

  sorted.forEach(t => {
    if (!t.due) { sections.later.push(t); return; }
    const due = new Date(t.due); due.setHours(0,0,0,0);
    const diff = Math.round((due - now) / 86400000);
    if (diff < 0) sections.overdue.push(t);
    else if (diff === 0) sections.today.push(t);
    else if (diff <= 3) sections.soon.push(t);
    else sections.later.push(t);
  });

  let rendered = 0;
  if (sections.overdue.length) { renderTaskSection("⚠ Overdue", sections.overdue); rendered++; }
  if (sections.today.length)   { renderTaskSection("📅 Today",   sections.today);   rendered++; }
  if (sections.soon.length)    { renderTaskSection("⏳ Upcoming", sections.soon);    rendered++; }
  if (sections.later.length)   { renderTaskSection("🗓 Later",    sections.later);   rendered++; }

  if (!sorted.length) {
    tasksEl.innerHTML = `<div class="task-empty">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
      <p>No tasks yet — add your first one!</p>
    </div>`;
  }

  const taskDisplayEl = document.getElementById("activeTask");
  if (taskDisplayEl) {
    const t = tasks.find(t => t.id === activeTaskId);
    taskDisplayEl.textContent = t ? t.name : "No active task";
  }
  updateCompletedTaskStats();
}

function renderTaskSection(title, list) {
  if (!list.length) return;
  const h = document.createElement("div");
  h.className = "task-section-header";
  h.textContent = title;
  tasksEl.appendChild(h);
  list.forEach(t => tasksEl.appendChild(createTaskRow(t)));
}

function createTaskRow(t) {
  const row = document.createElement("div");
  const isResistant = isHighResistance(t.id);
  row.className = "task-row" + (t.id === activeTaskId ? " active" : "") + (isResistant ? " high-resistance" : "");
  row.setAttribute("role", "listitem");
  row.draggable = true;
  const progress = t.sessions > 0 ? Math.round((t.done/t.sessions)*100) : 0;
  const resistBadge = isResistant
    ? `<div class="resistance-badge">⚠ High Resistance (${getResistanceCount(t.id)}× avoided)</div>
       <div class="resistance-action-row">
         <button class="resistance-action-btn" onclick="event.stopPropagation();resistanceAction('sprint',${t.id})">⚡ Sprint it</button>
         <button class="resistance-action-btn" onclick="event.stopPropagation();openResistanceModal(${t.id})">🧩 Break down</button>
       </div>` : "";
  row.innerHTML = `
    <div class="task-line" style="background:${getDueColor(t.due)}"></div>
    <div class="task-content">
      <div class="task-title">
        <b>${t.name}</b>
        <span class="task-sessions">${t.done}/${t.sessions}</span>
      </div>
      <div class="task-progress"><div class="task-progress-bar" style="width:${progress}%"></div></div>
      <small class="task-due">${getDueText(t.due)}</small>
      ${resistBadge}
    </div>
    <div class="task-actions">
      <button onclick="linkTask(${t.id})" title="Link as active task" style="background:${t.id===activeTaskId?'var(--accent)':'rgba(255,255,255,.06)'};color:#fff;border-color:${t.id===activeTaskId?'var(--accent)':'rgba(255,255,255,.1)'}">
        ${t.id===activeTaskId?'Linked':'Link'}
      </button>
      <button class="secondary" onclick="editTask(${t.id})" title="Edit task">Edit</button>
      <button class="secondary" onclick="deleteTask(${t.id})" title="Delete task" style="color:var(--danger)">Del</button>
    </div>`;
  row.addEventListener("dragstart", () => { dragTaskId = t.id; row.classList.add("dragging"); });
  row.addEventListener("dragend",   () => row.classList.remove("dragging"));
  row.addEventListener("dragover",  e => e.preventDefault());
  row.addEventListener("drop", () => {
    const dragged = tasks.find(x => x.id === dragTaskId);
    if (!dragged || dragged.due !== t.due) { showToast("Can only reorder same-due tasks"); return; }
    const fi = tasks.findIndex(x => x.id === dragTaskId);
    const ti = tasks.findIndex(x => x.id === t.id);
    const moved = tasks.splice(fi, 1)[0];
    tasks.splice(ti, 0, moved);
    dragTaskId = null;
    save(); renderTasks();
  });
  return row;
}

function getDueColor(due) {
  if (!due) return "#6b7280";
  const now = new Date(); now.setHours(0,0,0,0);
  const d = new Date(due);
  const diff = Math.round((d - now) / 86400000);
  if (diff < 0) return "#f87171";
  if (diff <= 3) return "#fbbf24";
  return "#34d399";
}

function getDueText(due) {
  if (!due) return "";
  const now = new Date(); now.setHours(0,0,0,0);
  const d = new Date(due);
  const diff = Math.round((d - now) / 86400000);
  if (diff < 0) return `Overdue by ${Math.abs(diff)}d`;
  if (diff === 0) return "Due today";
  if (diff === 1) return "Due tomorrow";
  return `Due in ${diff}d`;
}

/* ── TASK UTILS ── */
function scoreTask(task) {
  let score = 0;
  if (task.due) {
    const now = new Date(); now.setHours(0,0,0,0);
    const d = new Date(task.due); d.setHours(0,0,0,0);
    const diff = (d - now) / 86400000;
    if (diff < 0) score += 100;
    else if (diff === 0) score += 80;
    else if (diff <= 3) score += 50;
    else score += 10;
  }
  score += remainingSessions(task) * 5;
  return score;
}

function getNextFocusTask() {
  const avail = getAllTasks();
  if (!avail.length) return null;
  avail.sort((a,b) => scoreTask(b) - scoreTask(a));
  return avail[0];
}

function startSmartFocus() {
  const avail = tasks.filter(t => t.done < t.sessions);
  if (!avail.length) { showToast("All tasks completed! 🎉"); return; }
  avail.sort((a,b) => scoreTask(b) - scoreTask(a));
  const best = avail[0];
  activeTaskId = best.id;
  save(); renderTasks(); updateUI();
  showToast(`🎯 Smart Focus: ${best.name}`);
}

function notifyTaskCompletion(task) {
  const dueLine = task.due ? getDueText(task.due) : "No due date";
  sendNotification("✅ Task Completed", `${task.name}\n${task.sessions} sessions · ${task.minutes || 0} min\n${dueLine}`);
}

/* ── TASK COMPLETION HELPERS ── */
function totalTasksCompleted() { return completedTasks.length; }
function tasksCompletedToday() { return completedTasks.filter(t => t.date === today).length; }
function tasksCompletedThisWeek() {
  const start = new Date(); start.setHours(0,0,0,0); start.setDate(start.getDate()-6);
  return completedTasks.filter(t => { if(!t.date) return false; const d=new Date(t.date); d.setHours(0,0,0,0); return d>=start; }).length;
}
function updateCompletedTaskStats() {
  const tEl = document.getElementById("todayDone");
  const wEl = document.getElementById("weekDone");
  if (tEl) tEl.textContent = tasksCompletedToday();
  if (wEl) wEl.textContent = tasksCompletedThisWeek();
}

/* ── STATS ── */
function weeklyMinutes() {
  const start = new Date(); start.setHours(0,0,0,0); start.setDate(start.getDate()-6);
  return Object.keys(stats).reduce((sum, d) => {
    const date = new Date(d); date.setHours(0,0,0,0);
    return date >= start ? sum + (stats[d].min || 0) : sum;
  }, 0);
}

function totalSessionsAllTime() {
  return Object.values(stats).reduce((s,d) => s + (d.sess || 0), 0);
}

let _lastDashboardUpdate = 0;
function updateTodayDashboard() {
  const now = Date.now();
  // Throttle: dashboard values change at most once per session tick (every 5s is plenty)
  if (now - _lastDashboardUpdate < 5000 && _lastDashboardUpdate > 0) return;
  _lastDashboardUpdate = now;

  const s = stats[today] || { min:0, sess:0 };
  document.getElementById("todayFocus").textContent    = s.min;
  document.getElementById("todaySessions").textContent = s.sess;
  document.getElementById("todayStreak").textContent   = streak;
  const next = getActiveTask() || getNextFocusTask();
  document.getElementById("todayNextTask").textContent = next ? shortName(next.name) : "None";
  updateMomentum();
}

/** Force an immediate dashboard refresh, bypassing the throttle.
 *  Call this after session completion, task changes, or streak updates. */
function refreshDashboardNow() {
  _lastDashboardUpdate = 0;
  updateTodayDashboard();
}

function updateMomentum() {
  const el = document.getElementById("momentumText");
  const todaySess = stats[today]?.sess || 0;
  const ySess = stats[yesterday]?.sess || 0;
  const diff = todaySess - ySess;
  if (el) {
    if (diff > 0) el.textContent = `↑ +${diff} from yesterday`;
    else if (diff < 0) el.textContent = `↓ ${diff} from yesterday`;
    else el.textContent = ySess ? "Same as yesterday" : "Starting fresh";
  }
  // Update sidebar momentum bar
  const smiGoal = 4;
  const pct = Math.min(100, Math.round((todaySess / smiGoal) * 100));
  const smiFill = document.getElementById("sidebarSmiFill");
  const smiState = document.getElementById("sidebarSmiState");
  if (smiFill) smiFill.style.width = pct + "%";
  if (smiState) {
    const labels = ["Starting", "Building", "Flowing", "Peak", "On Fire 🔥"];
    const idx = Math.min(4, Math.floor(pct / 25));
    smiState.textContent = labels[idx];
  }
}

/* ── HEATMAP ── */
function renderHeatmap() {
  const hm = document.getElementById("heatmap");
  if (!hm) return;
  hm.innerHTML = "";
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth();
  for (let d = 1; d <= 31; d++) {
    const date = new Date(year, month, d);
    if (date.getMonth() !== month) break;
    const minutes = stats[date.toDateString()]?.min || 0;
    const level = minutes >= 100 ? 4 : minutes >= 75 ? 3 : minutes >= 50 ? 2 : minutes >= 25 ? 1 : 0;
    const cell = document.createElement("div");
    cell.className = "heat";
    cell.dataset.level = level;
    cell.title = `${date.getDate()} ${date.toLocaleString('default',{month:'short'})}: ${minutes} min`;
    cell.setAttribute("role","gridcell");
    cell.setAttribute("aria-label",`${minutes} minutes on ${date.toDateString()}`);
    hm.appendChild(cell);
  }
}

/* ── ACHIEVEMENTS ── */
const ACHIEVEMENTS = [
  { id:"first_focus",   label:"First Focus Session",    icon:"⏱", tier:"basic",    check:()=>xp>=10 },
  { id:"week_streak",   label:"7 Day Streak",            icon:"🔥", tier:"basic",    check:()=>streak>=7 },
  { id:"first_task",    label:"First Task Completed",    icon:"✅", tier:"basic",    check:()=>totalTasksCompleted()>=1 },
  { id:"daily_tasks",   label:"3 Tasks in One Day",      icon:"⚡", tier:"basic",    check:()=>tasksCompletedToday()>=3 },
  { id:"weekly_tasks",  label:"10 Tasks This Week",      icon:"📅", tier:"advanced", check:()=>tasksCompletedThisWeek()>=10 },
  { id:"task_master",   label:"50 Tasks Completed",      icon:"🏆", tier:"advanced", check:()=>totalTasksCompleted()>=50 },
  { id:"task_legend",   label:"100 Tasks Completed",     icon:"👑", tier:"elite",    check:()=>totalTasksCompleted()>=100 },
  { id:"xp_100",        label:"100 XP Earned",           icon:"⭐", tier:"basic",    check:()=>xp>=100 },
  { id:"xp_500",        label:"500 XP Earned",           icon:"💫", tier:"advanced", check:()=>xp>=500 },
  { id:"focus_25",      label:"25 Focus Sessions",       icon:"🎯", tier:"advanced", check:()=>totalSessionsAllTime()>=25 },
  { id:"focus_100",     label:"100 Focus Sessions",      icon:"🧠", tier:"elite",    check:()=>totalSessionsAllTime()>=100 },
  { id:"streak_30",     label:"30 Day Streak",           icon:"🌟", tier:"elite",    check:()=>streak>=30 },
];

function renderAchievements() {
  const ul = document.getElementById("achievements");
  if (!ul) return;
  ul.innerHTML = "";
  ACHIEVEMENTS.forEach(a => {
    const unlocked = a.check();
    if (!unlockedAchievements[a.id] && unlocked) {
      setTimeout(() => showToast(`🏅 Unlocked: ${a.label}`, 3000), 300);
      unlockedAchievements[a.id] = true;
      localStorage.setItem("unlockedAchievements", JSON.stringify(unlockedAchievements));
    }
    const li = document.createElement("li");
    li.className = `tier-${a.tier} ${unlocked ? "unlocked" : "locked"}`;
    li.innerHTML = `
      <span style="font-size:18px;line-height:1;">${a.icon}</span>
      <span style="flex:1;font-size:13px;color:${unlocked?'var(--text)':'var(--muted)'};">${a.label}</span>
      <span style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${unlocked?'var(--accent)':'var(--muted)'};">${unlocked?"✓":"locked"}</span>`;
    ul.appendChild(li);
  });
}

/* ── INSIGHTS ── */
const INSIGHTS = [
  "Consistency beats intensity. Always.",
  "You're building discipline quietly.",
  "Small sessions compound into mastery.",
  "Focus is a skill, not a mood.",
  "The identity you build through repetition.",
  "Every return strengthens the habit.",
  "Progress doesn't announce itself.",
  "Momentum is earned one session at a time.",
  "Showing up is the discipline.",
  "The compound effect starts with one session."
];

function renderInsight() {
  const key = "insight-" + today;
  let text = localStorage.getItem(key);
  if (!text) {
    text = INSIGHTS[Math.floor(Math.random() * INSIGHTS.length)];
    localStorage.setItem(key, text);
  }
  const el = document.getElementById("dailyInsight");
  if (el) el.textContent = '"' + text + '"';
}

/* ── IDENTITY ── */
function getIdentityNarrative() {
  const s = stats?.[today]?.sess || 0;
  if (streak >= 30) return "Discipline is now part of who you are.";
  if (streak >= 14) return "Showing up is part of who you are now.";
  if (streak >= 7)  return "Consistency is becoming natural for you.";
  if (streak >= 3)  return "You're building the habit of showing up.";
  if (s > 0)        return "You showed up today. That matters.";
  return "Every return strengthens your identity.";
}

function getStreakFire() {
  if (streak === 0) return "○";
  if (streak < 3)   return "🔥";
  if (streak < 7)   return "🔥🔥";
  if (streak < 14)  return "🔥🔥🔥";
  if (streak < 30)  return "⚡🔥⚡";
  return "🌟🔥🌟";
}

/* ── REACTIVE QUOTES ── */
const QUOTES = {
  focusStart: ["Settle in. One thing at a time.", "Your attention is enough.", "Begin gently. Stay present.", "This moment is your work."],
  focusEnd:   ["That effort counted.", "One honest session completed.", "Progress doesn't announce itself.", "You did the work."],
  breakStart: ["Rest is part of the work.", "Let the mind loosen.", "Step back. You've earned this.", "Breathe. You've done well."],
  breakEnd:   ["Whenever you're ready.", "Carry the calm forward.", "Return without rush.", "One more. You can."],
  aborted:    ["Pausing is not failing.", "You listened. That matters.", "Resetting is still progress."]
};

let lastQuote = JSON.parse(localStorage.getItem("lastQuote")) || null;
function getReactiveQuote(type) {
  const pool = QUOTES[type] || QUOTES.focusStart;
  let text = pool[Math.floor(Math.random() * pool.length)];
  if (text === lastQuote) text = pool[(pool.indexOf(text)+1) % pool.length];
  lastQuote = text;
  localStorage.setItem("lastQuote", JSON.stringify(text));
  return text;
}
function showQuote(type) {
  const el = document.getElementById("quoteText");
  if (el) el.textContent = getReactiveQuote(type);
}
function refreshQuote() { showQuote("focusStart"); }

/* ── CLOCK & GREETING ── */
function updateClock() {
  const now = new Date();
  const h = now.getHours();
  const m = String(now.getMinutes()).padStart(2,"0");
  const liveTime = document.getElementById("liveTime");
  const greetingEl = document.getElementById("greeting");
  if (liveTime) {
    liveTime.textContent = now.toLocaleDateString("en-IN",{weekday:"short",month:"short",day:"numeric"}) + " · " + h + ":" + m;
  }
  if (greetingEl) {
    const greet = getGreeting();
    const task = getActiveTask?.();
    greetingEl.textContent = task ? `${greet} · ${shortName(task.name)}` : greet;
  }
}
function getGreeting() {
  const h = new Date().getHours();
  if (h < 5) return "Still awake, warrior?";
  if (h < 12) return "Good morning, VEER";
  if (h < 17) return "Stay sharp, VEER";
  if (h < 21) return "Evening grind, VEER";
  return "One last session, VEER";
}
setInterval(updateClock, 60000);

/* ── DAILY INTENT ── */
const intentKey = "intent-" + today;
function loadDailyIntent() {
  const input = document.getElementById("dailyIntent");
  if (!input) return;
  const saved = localStorage.getItem(intentKey);
  if (saved) { input.value = saved; return; }
  const task = getActiveTask?.();
  if (task) {
    const left = remainingSessions(task);
    input.value = `Complete ${left} session${left>1?"s":""} of ${shortName(task.name)}`;
  } else {
    input.value = "Add 1 task. Do 1 focus session.";
  }
}
document.getElementById("dailyIntent")?.addEventListener("input", e => {
  localStorage.setItem(intentKey, e.target.value);
});

/* ── SHORT NAME HELPER ── */
function shortName(name="") {
  if (name.length <= 22) return name;
  return name
    .replace(/principles of inheritance and variation/i,"Genetics")
    .replace(/molecular basis of inheritance/i,"DNA")
    .replace(/human reproduction/i,"Reproduction")
    .replace(/reproductive health/i,"Repro Health")
    .replace(/chemical bonding and molecular structure/i,"Bonding")
    .replace(/structure of atom/i,"Atomic Structure")
    .replace(/laws of motion/i,"Laws of Motion")
    .replace(/work energy and power/i,"WEP")
    .replace(/thermodynamics/i,"Thermodynamics")
    .replace(/semiconductor electronics/i,"Semiconductors")
    .replace(/alternating current/i,"AC")
    || (name.length > 22 ? name.slice(0,20)+"…" : name);
}

/* ── MAIN UPDATE UI ── */
function updateUI() {
  updateTimerUI();
  ensureTodayStats();

  // Home stats
  document.getElementById("homeMin")?.textContent !== undefined && (document.getElementById("homeMin").textContent = stats[today]?.min || 0);
  document.getElementById("homeSess")?.textContent !== undefined && (document.getElementById("homeSess").textContent = stats[today]?.sess || 0);
  document.getElementById("homeStreak")?.textContent !== undefined && (document.getElementById("homeStreak").textContent = streak);

  // Stats section
  if (todayMinEl)  todayMinEl.textContent  = stats[today]?.min || 0;
  if (todaySessEl) todaySessEl.textContent = stats[today]?.sess || 0;
  if (weekMinEl)   weekMinEl.textContent   = weeklyMinutes();

  const level = Math.floor(xp / 100) + 1;
  const xpInLevel = xp % 100;
  document.getElementById("xp")?.textContent && (document.getElementById("xp").textContent = xp);
  document.getElementById("level")?.textContent && (document.getElementById("level").textContent = level);
  document.getElementById("xpNext")?.textContent && (document.getElementById("xpNext").textContent = level * 100);
  document.getElementById("totalSessAll")?.textContent && (document.getElementById("totalSessAll").textContent = totalSessionsAllTime());
  const xpBar = document.getElementById("xpBar");
  if (xpBar) xpBar.style.width = xpInLevel + "%";

  // Stats streak
  const statsStreak = document.getElementById("statsStreak");
  const statsStreakLabel = document.getElementById("statsStreakLabel");
  if (statsStreak) statsStreak.textContent = streak;
  if (statsStreakLabel) statsStreakLabel.textContent = streak === 1 ? "day in a row" : "days in a row";

  // Identity
  const fireEl = document.getElementById("streakFire");
  if (fireEl) fireEl.textContent = getStreakFire();
  const identText = document.getElementById("identityText");
  if (identText) {
    if (streak >= 7) identText.textContent = "You're building an unbreakable identity.";
    else if (streak >= 3) identText.textContent = "The habit of showing up is forming.";
    else identText.textContent = "Every session shapes who you're becoming.";
  }
  const identNarr = document.getElementById("identityNarrative");
  if (identNarr) identNarr.textContent = getIdentityNarrative();
  const identStreakEl = document.getElementById("identityStreak");
  if (identStreakEl) {
    identStreakEl.textContent = streak > 0
      ? `You showed up ${streak} day${streak>1?"s":""} in a row.`
      : "Start today. One session is enough.";
  }

  // Active task in focus section
  const taskDisplayEl = document.getElementById("activeTask");
  if (taskDisplayEl) {
    const t = getActiveTask?.();
    taskDisplayEl.textContent = t ? t.name : "No active task";
  }

  // Skip break button
  const skipBtn = document.getElementById("skipBreakBtn");
  if (skipBtn) skipBtn.hidden = !(Session.state === "running" && (Session.mode === "break" || Session.mode === "long"));

  // Heavy renders: defer and only run for the currently-visible section.
  // Previously renderHeatmap/renderAchievements ran every timer tick (1 Hz)
  // even when the stats panel was hidden — wasting ~40 ms of main thread per second.
  requestAnimationFrame(() => {
    const statsVisible = document.getElementById("statsSection")?.classList.contains("active");
    if (statsVisible) {
      renderHeatmap?.();
      renderAchievements?.();
    }
    updateTodayDashboard?.();
    updateCompletedTaskStats?.();
  });

  // Deep focus overlay
  if (document.getElementById("focusOverlay")?.classList.contains("active")) updateFocusOverlay?.();
}

/* ── SECTION NAVIGATION ── */
function showSection(section) {
  document.querySelectorAll(".app-section").forEach(s => s.classList.remove("active"));
  const target = document.getElementById(section + "Section");
  if (target) target.classList.add("active");
  // Sync both mobile bottom nav and desktop sidebar
  document.querySelectorAll(".bottom-nav button, .sidebar-nav-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(`[data-sec="${section}"]`).forEach(b => b.classList.add("active"));
  localStorage.setItem("lastSection", section);
  // Re-run renders for that section
  if (section === "stats") { renderHeatmap(); renderAchievements(); updateRecoveryScore(); updateSkillTree(); updateBehavioralPatterns(); }
  if (section === "focus") { updateAdaptiveRecs(); }
  if (section === "tasks") { renderTasks(); updateTodayDashboard(); }
  if (section === "home")  { updateClock(); }
}

/* ── THEME ── */
const THEMES = ["dark","light","nature"];
function applySavedTheme() {
  const saved = localStorage.getItem("theme") || "dark";
  setTheme(saved, true);
}
function setTheme(theme, silent=false) {
  document.body.classList.remove(...THEMES);
  document.body.classList.add(theme);
  localStorage.setItem("theme", theme);
  // Update theme pills in settings
  document.querySelectorAll(".theme-pill").forEach(p => p.classList.remove("active"));
  document.getElementById("theme"+theme.charAt(0).toUpperCase()+theme.slice(1))?.classList.add("active");
  // Update header theme button icon
  const btn = document.getElementById("themeBtn");
  if (btn) {
    const icons = {
      dark:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
      light:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
      nature:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 8C8 10 5.9 16.17 3.82 22H5.71c.38-.81.8-1.6 1.29-2.34C8.84 21.24 10.91 22 13.3 22 19 22 21 16 21 8l-1.5-1L17 8z"/></svg>'
    };
    btn.innerHTML = icons[theme] || icons.dark;
  }
  // Theme-color meta
    const meta = document.querySelector('meta[name="theme-color"]');
   if (meta) meta.setAttribute("content", theme==="light"?"#fff7ed":"#060a14");
  if (!silent) showToast(`Theme: ${theme.charAt(0).toUpperCase()+theme.slice(1)}`);
}
function toggleTheme() {
  const current = THEMES.find(t => document.body.classList.contains(t)) || "dark";
  setTheme(THEMES[(THEMES.indexOf(current)+1) % THEMES.length]);
}

/* ── SETTINGS ── */
function openSettings() {
  document.getElementById("focusIn").value = settings.focus;
  document.getElementById("breakIn").value = settings.break;
  document.getElementById("longIn").value  = settings.long;
  const notifToggle = document.getElementById("notifFocusToggle");
  if (notifToggle) notifToggle.classList.toggle("on", !!notificationSettings.focusComplete);
  const silentToggle = document.getElementById("silentToggleSettings");
  if (silentToggle) silentToggle.classList.toggle("on", silentMode);
  openModal("settingsModal");
}
function closeSettings() { closeModal(); }

function applyTimer() {
  const f = parseInt(focusIn.value);
  const b = parseInt(breakIn.value);
  const l = parseInt(longIn.value);
  if (!f || f < 1 || b < 0 || l < 0) { showToast("⚠ Invalid timer values"); return; }
  settings.focus = f; settings.break = b; settings.long = l;
  save();
  resetPomodoro();
  closeSettings();
  showToast("⏱ Timer updated");
}

function applyPreset(mode) {
  if (mode==="deep")  { settings.focus=50; settings.break=7; settings.long=15; }
  if (mode==="light") { settings.focus=35; settings.break=4; settings.long=12; }
  if (mode==="night") { settings.focus=20; settings.break=1; settings.long=2; }
  focusIn.value = settings.focus;
  breakIn.value = settings.break;
  longIn.value  = settings.long;
  resetPomodoro();
  save();
  closeSettings();
  showToast(`Preset applied: ${mode}`);
}

function toggleNotifFocus(btn) {
  notificationSettings.focusComplete = !notificationSettings.focusComplete;
  btn.classList.toggle("on", notificationSettings.focusComplete);
  localStorage.setItem("notificationSettings", JSON.stringify(notificationSettings));
}

/* ── SILENT MODE ── */
if (silentMode) document.body.classList.add("silent");
function toggleSilent() {
  silentMode = !silentMode;
  document.body.classList.toggle("silent", silentMode);
  localStorage.setItem("silentMode", silentMode);
  const btn = document.getElementById("silentBtn");
  if (btn) btn.style.opacity = silentMode ? "1" : "";
  const st = document.getElementById("silentToggleSettings");
  if (st) st.classList.toggle("on", silentMode);
  showToast(silentMode ? "🔇 Silent mode on" : "🔊 Silent mode off");
}

/* ── VOLUME ── */
function applyVolume(v) {
  appVolume = v;
  localStorage.setItem("appVolume", v);
  [focusSound, breakSound, longBreakSound, document.getElementById("focusMusic"), document.getElementById("meditationSound")].forEach(s => { if (s) s.volume = v; });
}
const volumeSlider = document.getElementById("volumeControl");
const volumeLabel  = document.getElementById("volumeValue");
if (volumeSlider) {
  volumeSlider.value = appVolume;
  if (volumeLabel) volumeLabel.textContent = Math.round(appVolume*100)+"%";
  applyVolume(appVolume);
  volumeSlider.addEventListener("input", function() {
    applyVolume(parseFloat(this.value));
    if (volumeLabel) volumeLabel.textContent = Math.round(parseFloat(this.value)*100)+"%";
  });
}

/* ── MODAL SYSTEM + FOCUS TRAP ── */
const backdrop = document.getElementById("modalBackdrop");
let lastFocusedEl = null;
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function trapFocus(container) {
  const focusable = [...container.querySelectorAll(FOCUSABLE)].filter(el => !el.closest('[inert]'));
  if (!focusable.length) return;
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];
  function handler(e) {
    if (e.key !== "Tab") return;
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
    }
  }
  container._trapHandler = handler;
  container.addEventListener("keydown", handler);
}

function releaseFocusTrap(container) {
  if (container._trapHandler) {
    container.removeEventListener("keydown", container._trapHandler);
    delete container._trapHandler;
  }
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal || !backdrop) return;
  lastFocusedEl = document.activeElement;
  backdrop.classList.add("show");
  backdrop.setAttribute("aria-hidden","false");
  modal.removeAttribute("hidden");
  modal.classList.add("show");
  // Focus first input or button
  requestAnimationFrame(() => {
    const first = modal.querySelector(FOCUSABLE);
    if (first) first.focus();
    trapFocus(modal);
  });
  document.body.style.overflow = "hidden";
}

function closeModal() {
  document.querySelectorAll(".modal.show").forEach(m => {
    releaseFocusTrap(m);
    m.classList.remove("show");
    // On mobile remove immediately; on desktop use opacity transition
    setTimeout(() => m.setAttribute("hidden",""), 260);
  });
  backdrop.classList.remove("show");
  backdrop.setAttribute("aria-hidden","true");
  document.body.style.overflow = "";
  try { lastFocusedEl?.focus(); } catch(_) {}
}

backdrop?.addEventListener("click", e => { if (e.target === backdrop) closeModal(); });

/* ── KEYBOARD SHORTCUTS ── */
document.addEventListener("keydown", e => {
  // Command Palette: Ctrl/Cmd+K
  if ((e.ctrlKey || e.metaKey) && e.key === "k") {
    e.preventDefault();
    if (document.getElementById("commandPalette")?.classList.contains("active")) closeCommandPalette();
    else openCommandPalette();
    return;
  }
  if (e.key === "Escape") {
    if (document.getElementById("commandPalette")?.classList.contains("active")) { closeCommandPalette(); return; }
    if (document.getElementById("recoveryOverlay")?.classList.contains("active")) { closeRecoveryOverlay(); return; }
    if (meditationTimer) { finishMeditation(); return; }
    if (document.getElementById("focusOverlay")?.classList.contains("active")) { toggleDeepFocus(); return; }
    closeModal();
    return;
  }
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  const k = e.key.toLowerCase();
  if (e.code === "Space") { e.preventDefault(); toggleTimer?.(); return; }
  switch (k) {
    case "r": resetPomodoro?.(); break;
    case "d": toggleDeepFocus?.(); break;
    case "f": restartSession?.(); break;
    case "s": skipBreak?.(); break;
    case "n": openModal?.("taskModal"); break;
    case "q": refreshQuote?.(); break;
    case "l": toggleTheme?.(); break;
    case "t": toggleSilent?.(); break;
  }
});

/* ── FOCUS MUSIC ── */
const music    = document.getElementById("focusMusic");
const musicBtn = document.getElementById("focusMusicToggle");
if (musicBtn) {
  musicBtn.addEventListener("click", () => {
    focusMusicEnabled = !focusMusicEnabled;
    if (!focusMusicEnabled) music?.pause();
    musicBtn.style.color = focusMusicEnabled ? "" : "var(--muted)";
    showToast(focusMusicEnabled ? "🎧 Focus music on" : "🔇 Focus music off");
  });
}
function handleFocusMusic(action) {
  if (!music) return;
  if (silentMode || !focusMusicEnabled) { music.pause(); return; }
  if (action === "start")  { music.currentTime=0; music.play().catch(()=>{}); }
  if (action === "resume") { music.play().catch(()=>{}); }
  if (action === "pause")  { music.pause(); }
  if (action === "stop")   { music.pause(); music.currentTime=0; }
}

/* ── FOCUS STATE ── */
function setFocusState(state) {
  switch(state) {
    case "start":
      if (Session.mode !== "focus") return;
      setFocusMode(true);
      if (!silentMode) handleFocusMusic("start");
      sendNotification("Focus session started 🎯", "Stay locked in. You've got this.");
      break;
    case "pause":
      handleFocusMusic("pause");
      break;
    case "resume":
      if (!silentMode) handleFocusMusic("resume");
      break;
    case "end":
      setFocusMode(false);
      handleFocusMusic("stop");
      setTimeout(showFocusRitual, 600);
      break;
  }
}

/* ── DEEP FOCUS OVERLAY ── */
const focusOverlay = document.getElementById("focusOverlay");
function updateFocusOverlay() {
  if (!focusOverlay) return;
  const fTime = document.getElementById("focusTime");
  if (fTime && timeEl) fTime.textContent = timeEl.textContent;
  const overlayProg = focusOverlay.querySelector(".progress");
  if (overlayProg && Session.total > 0) {
    const OVERLAY_CIRC = 597;
    overlayProg.style.strokeDashoffset = OVERLAY_CIRC - (Session.remaining / Session.total) * OVERLAY_CIRC;
  }
  // Show active task label
  const lbl = document.getElementById("dfTaskLabel");
  if (lbl) {
    const task = getActiveTask?.();
    lbl.textContent = task ? `Working on: ${shortName(task.name)}` : "Stay locked in. You've got this.";
  }
}
function toggleDeepFocus() {
  if (!focusOverlay) return;
  if (Session.state !== "running" || Session.mode !== "focus") {
    showToast("Start a focus session first");
    return;
  }
  const active = focusOverlay.classList.toggle("active");
  document.body.classList.toggle("deep-focus", active);
  document.body.style.overflow = active ? "hidden" : "";
  focusOverlay.inert = !active;
  deepFocus = active;
  if (active) {
    spawnParticles(); updateFocusOverlay();
    requestAnimationFrame(() => trapFocus(focusOverlay));
  } else {
    releaseFocusTrap(focusOverlay);
    document.getElementById("timerToggleBtn")?.focus();
  }
}
function spawnParticles() {
  const c = document.getElementById("particles");
  if (!c) return;
  c.innerHTML = "";
  for (let i=0; i<45; i++) {
    const p = document.createElement("div");
    p.className = "particle";
    p.style.left = Math.random()*100 + "%";
    p.style.bottom = "0";
    p.style.animationDuration = 7 + Math.random()*10 + "s";
    p.style.animationDelay = Math.random()*8 + "s";
    p.style.setProperty("--drift", (Math.random()*60-30) + "px");
    c.appendChild(p);
  }
}

/* ── RITUAL ── */
const RITUAL_LINES = [
  "You honored your time.", "One step forward is enough.",
  "You showed up. That matters.", "Progress doesn't rush.",
  "Breathe. Then continue.", "The work you did today matters."
];
function showFocusRitual() {
  const ritual = document.getElementById("focusRitual");
  const lineEl = document.getElementById("ritualLine");
  if (!ritual || !lineEl) return;
  lineEl.textContent = RITUAL_LINES[Math.floor(Math.random() * RITUAL_LINES.length)];
  ritual.inert = false;
  ritual.classList.add("active");
  requestAnimationFrame(() => { ritual.querySelector("button")?.focus(); trapFocus(ritual); });
}
function closeRitual() {
  const ritual = document.getElementById("focusRitual");
  if (!ritual) return;
  releaseFocusTrap(ritual);
  ritual.classList.remove("active");
  ritual.inert = true;
  document.body.style.overflow = "";
  const shouldDecompress = focusCountSinceDecompress >= 2;
  if (shouldDecompress) {
    focusCountSinceDecompress = 0;
    showDecompression();
  } else {
    nextPhase();
  }
  document.getElementById("time")?.focus();
}

/* ── DECOMPRESSION ── */
function showDecompression() {
  const el = document.getElementById("decompressOverlay");
  if (!el) return;
  decompressionActive = true;
  document.body.style.overflow = "hidden";
  el.inert = false;
  el.classList.add("active");
  requestAnimationFrame(() => { el.querySelector("button")?.focus(); trapFocus(el); });
}
function finishDecompression() {
  const el = document.getElementById("decompressOverlay");
  if (!el) return;
  releaseFocusTrap(el);
  decompressionActive = false;
  el.classList.remove("active");
  el.inert = true;
  document.body.style.overflow = "";
}
function handleDecompressionChoice(type) {
  finishDecompression();
  nextPhase();
  if (type === "skip") return;
  if (type === "full") {
    const dur = (Session.mode === "long" ? settings.long : settings.break) * 60 * 1000;
    startMeditation("eyes", dur);
    return;
  }
  startMeditation("breathing", 60000);
}
function getCurrentBreakDurationMs() {
  if (Session.mode === "long") return settings.long * 60 * 1000;
  if (Session.mode === "break") return settings.break * 60 * 1000;
  return 0;
}

/* ── MEDITATION ── */
function startMeditation(type, duration) {
  if (silentMode) return;
  const overlay = document.getElementById("meditationOverlay");
  const text    = document.getElementById("meditationText");
  const timerText = document.getElementById("meditationTimer");
  const sound   = document.getElementById("meditationSound");
  if (!overlay || !text) return;
  finishMeditation();
  overlay.classList.add("active");
  overlay.inert = false;
  requestAnimationFrame(() => trapFocus(overlay));
  text.textContent = type === "eyes" ? "Close your eyes. Rest." : "Enter stillness.";
  const phases = ["Let go.", "Observe without judgment.", "Thoughts will pass.", "Return to stillness.", "You are present."];
  let phase = 0;
  meditationInterval = setInterval(() => { phase=(phase+1)%phases.length; text.textContent = phases[phase]; }, 8000);
  let seconds = Math.floor(duration / 1000);
  if (timerText) timerText.textContent = seconds > 60 ? Math.ceil(seconds/60)+" min" : seconds+" sec";
  meditationCountdown = setInterval(() => {
    seconds--;
    if (timerText) timerText.textContent = seconds > 60 ? Math.ceil(seconds/60)+" min" : seconds+" sec";
    if (seconds <= 0) clearInterval(meditationCountdown);
  }, 1000);
  meditationTimer = setTimeout(() => finishMeditation(), duration);
  sound?.play?.().catch(()=>{});
  document.body.classList.add("chakra-mode");
}
function finishMeditation() {
  const overlay = document.getElementById("meditationOverlay");
  const sound   = document.getElementById("meditationSound");
  clearTimeout(meditationTimer); meditationTimer = null;
  clearInterval(meditationInterval); meditationInterval = null;
  clearInterval(meditationCountdown); meditationCountdown = null;
  sound?.pause?.();
  if (sound) sound.currentTime = 0;
  if (overlay) { releaseFocusTrap(overlay); overlay.classList.remove("active"); overlay.inert = true; }
  document.body.classList.remove("chakra-mode");
  document.getElementById("time")?.focus();
}

/* ── WEEKLY REFLECTION ── */
function handleWeeklyReflection() {
  const section = document.getElementById("weeklyReflectionSection");
  if (!section) return;
  const isSunday = new Date().getDay() === 0;
  const key = "reflection-" + today;
  if (isSunday && !localStorage.getItem(key)) section.style.display = "block";
  else section.style.display = "none";
}
function saveReflection() {
  const input = document.getElementById("reflectionInput");
  const text  = input?.value.trim() || "Showed up.";
  localStorage.setItem("reflection-" + today, text);
  showToast("🌱 Reflection saved");
  if (input) input.value = "";
  handleWeeklyReflection();
}

/* ── ONBOARDING ── */
const ONBOARD_SCREENS = [
{
  state: "identity",
  title: "Welcome to ZENITH",
  text:
    "This is not a productivity tracker.\n\n" +
    "ZENITH is a system for building cognitive momentum."
},

{
  state: "focus",
  title: "Depth Creates Progress",
  text:
    "Work in focused sessions.\n" +
    "One target. No switching.\n\n" +
    "Small periods of deep work compound fast."
},

{
  state: "tasks",
  title: "Think in Sessions",
  text:
    "Break goals into repeatable sessions.\n\n" +
    "Progress becomes measurable.\n" +
    "Consistency becomes easier."
},

{
  state: "deep",
  title: "Enter Deep Focus",
  text:
    "Deep Focus removes visual noise and distractions.\n\n" +
    "Just the timer, your task, and sustained attention."
},

{
  state: "begin",
  title: "Start Small",
  text:
    "Add one task.\n" +
    "Complete one session.\n\n" +
    "Momentum starts smaller than motivation."
}
];
let onboardIndex = parseInt(localStorage.getItem("onboardIndex")) || 0;
function showOnboarding() {
  if (localStorage.getItem("onboardingDone")) return;
  const c = document.getElementById("onboarding");
  if (!c) return;
  c.inert = false;
  c.classList.add("active");
  requestAnimationFrame(() => { c.querySelector("button")?.focus(); trapFocus(c); });
  renderOnboarding();
}
function renderOnboarding() {
  if (onboardIndex < 0 || onboardIndex >= ONBOARD_SCREENS.length) return;
  const s = ONBOARD_SCREENS[onboardIndex];
  const iconEl  = document.getElementById("onboardIcon");
  const titleEl = document.getElementById("onboardTitle");
  const textEl  = document.getElementById("onboardText");
  const btn     = document.getElementById("onboardNext");
  const dotsEl  = document.getElementById("onboardDots");
  if (iconEl)  iconEl.textContent  = s.icon;
  if (titleEl) titleEl.textContent = s.title;
  if (textEl)  textEl.textContent  = s.text;
  if (btn) btn.textContent = onboardIndex === ONBOARD_SCREENS.length-1 ? "Start focusing →" : "Continue";
  if (dotsEl) {
    dotsEl.innerHTML = "";
    ONBOARD_SCREENS.forEach((_,i) => {
      const d = document.createElement("span");
      if (i === onboardIndex) d.classList.add("active");
      dotsEl.appendChild(d);
    });
  }
  const skipBtn = document.querySelector("#onboarding .secondary");
  if (skipBtn) skipBtn.style.display = onboardIndex === ONBOARD_SCREENS.length-1 ? "none" : "";
  localStorage.setItem("onboardIndex", onboardIndex);
}
function nextOnboarding() {
  onboardIndex++;
  if (onboardIndex >= ONBOARD_SCREENS.length) finishOnboarding();
  else renderOnboarding();
}
function skipOnboarding() { finishOnboarding(); }
function finishOnboarding() {
  localStorage.setItem("onboardingDone","true");
  localStorage.removeItem("onboardIndex");
  const c = document.getElementById("onboarding");
  if (c) { releaseFocusTrap(c); c.classList.remove("active"); c.inert = true; }
}

/* ─────────────────────────────────────────────
   NOTIFICATIONS
───────────────────────────────────────────── */

let pendingNotifStore =
  JSON.parse(localStorage.getItem("pendingNotifications")) || [];

/* user-enabled state */
let notificationsEnabled = false;

/* restore state */
try {
  notificationsEnabled =
    localStorage.getItem("notificationsEnabled") === "true";
} catch {}

/* enable notifications ONLY from user gesture */
async function enableNotifications() {

  const btn =
    document.getElementById(
      "enableNotifBtn"
    );

  if (!("Notification" in window)) {

    showToast("Notifications not supported.");

    if (btn) btn.hidden = true;

    return false;
  }

  if (Notification.permission === "granted") {

    notificationsEnabled = true;

    localStorage.setItem(
      "notificationsEnabled",
      "true"
    );

    if (btn) btn.hidden = true;

    showToast("Notifications enabled.");

    return true;
  }

  if (Notification.permission === "denied") {

    showToast(
      "Notifications blocked in browser settings."
    );

    return false;
  }

  const permission =
    await Notification.requestPermission();

  if (permission === "granted") {

    notificationsEnabled = true;

    localStorage.setItem(
      "notificationsEnabled",
      "true"
    );

    if (btn) btn.hidden = true;

    showToast("Notifications enabled.");

    return true;
  }

  return false;
}

/* send notification safely */
function sendNotification(title, body) {

  if (silentMode) return;

  if (!("Notification" in window)) return;

  const notif = {
    title,
    body,
    time: Date.now()
  };

  /* app visible */
  if (document.visibilityState === "visible") {
    if (
      notificationsEnabled &&
      Notification.permission === "granted"
    ) {
      try {
        showSWNotification(
          title,
          body
        );
      } catch (err) {
        console.warn(
          "Notification failed",
          err
        );
      }
    }
    return;
  }

  /* app hidden */
  pendingNotifStore.push(notif);
  localStorage.setItem(
    "pendingNotifications",
    JSON.stringify(pendingNotifStore)
  );
}

/* replay pending notifications */
function showPendingNotifications() {
  const pending =
    JSON.parse(
      localStorage.getItem(
        "pendingNotifications"
      )
    ) || [];
  if (!pending.length) return;
  if (
    notificationsEnabled &&
    Notification.permission === "granted"
  ) {
    pending.forEach(n => {
      try {
        showSWNotification(
          n.title,
          n.body
        );
      } catch (err) {
        console.warn(
          "Pending notification failed",
          err
        );
      }
    });
  }
  localStorage.removeItem(
    "pendingNotifications"
  );
}

/* restore notifications when app visible */
document.addEventListener(
  "visibilitychange",
  () => {

    if (!document.hidden) {
      showPendingNotifications();
    }

  }
);

/* init */
function initNotifications() {

  if (!("Notification" in window)) return;

  notificationsEnabled =
    Notification.permission === "granted";

  const btn =
    document.getElementById(
      "enableNotifBtn"
    );

  if (
    btn &&
    Notification.permission === "granted"
  ) {

    btn.hidden = true;

  }

}

async function showSWNotification(
  title,
  body,
  url = "/"
) {

  if (
    !("serviceWorker" in navigator)
  ) return;

  const reg =
    await navigator.serviceWorker.ready;

  reg.active?.postMessage({
    type: "SHOW_NOTIFICATION",
    title,
    body,
    url
  });

}

/* ── DAILY / WEEKLY / MONTHLY SUMMARIES ── */
let lastSummaryDate = localStorage.getItem("lastSummaryDate");
setInterval(() => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 5) {
    const yd = new Date(); yd.setDate(yd.getDate()-1);
    const summaryDate = yd.toDateString();
    if (lastSummaryDate !== summaryDate) {
      sendDailySummary(summaryDate);
      if (yd.getDay() === 0) sendWeeklySummary();
      if (yd.getDate() === 1) sendMonthlySummary();
      lastSummaryDate = summaryDate;
      localStorage.setItem("lastSummaryDate", summaryDate);
    }
  }
}, 60000);
function sendDailySummary(dateStr) {
  const s = stats[dateStr] || { min:0, sess:0 };
  const tasks_ = completedTasks.filter(t => t.date === dateStr).length;
  sendNotification("🌙 Day Summary", `📅 ${dateStr}\n⏱ ${s.min} min · 🎯 ${s.sess} sessions\n✅ ${tasks_} tasks · 🔥 ${streak} day streak`);
}
function sendWeeklySummary() {
  let totalMin=0, totalSess=0;
  const start = new Date(); start.setDate(start.getDate()-6); start.setHours(0,0,0,0);
  Object.keys(stats).forEach(d => { const dt=new Date(d); dt.setHours(0,0,0,0); if(dt>=start){totalMin+=stats[d].min||0;totalSess+=stats[d].sess||0;} });
  sendNotification("📊 Weekly Report", `⏱ ${totalMin} min · 🎯 ${totalSess} sessions\n✅ ${tasksCompletedThisWeek()} tasks · 🔥 ${streak} days`);
}
function sendMonthlySummary() {
  let totalMin=0, totalSess=0;
  const now=new Date();
  Object.keys(stats).forEach(d => { const dt=new Date(d); if(dt.getMonth()===now.getMonth()&&dt.getFullYear()===now.getFullYear()){totalMin+=stats[d].min||0;totalSess+=stats[d].sess||0;} });
  sendNotification("📅 Monthly Progress", `⏱ ${totalMin} min · 🎯 ${totalSess} sessions\n🔥 ${streak} day streak`);
}

/* ── EXPORT ── */
function exportStats() {
  const data = { daily:stats, completedTasks, xp, streak, tasks };
  const blob = new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "zenith_stats.json";
  a.click();
  showToast("📥 Stats exported");
}

/* ── CANVAS PARTICLES ── */
const canvas = document.getElementById("bgCanvas");
let ctx, particles_ = [], animId;
if (canvas) {
  ctx = canvas.getContext("2d");
  const isMobile = window.innerWidth < 768;

  // Cache viewport dimensions — reading window.innerWidth/Height inside rAF triggers
  // a forced layout on every frame. We update them only on resize instead.
  let _vpW = window.innerWidth;
  let _vpH = window.innerHeight;

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    _vpW = window.innerWidth;
    _vpH = window.innerHeight;
    canvas.width  = _vpW * dpr;
    canvas.height = _vpH * dpr;
    canvas.style.width  = _vpW + "px";
    canvas.style.height = _vpH + "px";
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  function initParticles() {
    particles_ = [];
    if (_vpW < 768) return;
    const count = _vpW >= 1024 ? 80 : 55;
    for (let i=0; i<count; i++) {
      particles_.push({ x:Math.random()*_vpW, y:Math.random()*_vpH, vx:(Math.random()-.5)*.35, vy:(Math.random()-.5)*.35 });
    }
  }
  initParticles();

  // Cache the accent color — getComputedStyle inside rAF forces layout every frame.
  // We only need to re-read it when the theme changes.
  let _particleColor = getComputedStyle(document.body).getPropertyValue("--accent-strong").trim() || "#5b8cff";
  document.addEventListener("themechange", () => {
    _particleColor = getComputedStyle(document.body).getPropertyValue("--accent-strong").trim() || "#5b8cff";
  });
  // Also refresh on body class changes (theme toggles add a class to body)
  new MutationObserver(() => {
    _particleColor = getComputedStyle(document.body).getPropertyValue("--accent-strong").trim() || "#5b8cff";
  }).observe(document.body, { attributeFilter: ["class"] });

  function animate() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const color = _particleColor;
    ctx.globalAlpha = .7;
    ctx.fillStyle = color;
    // Use cached _vpW/_vpH instead of reading window.innerWidth/Height each frame
    particles_.forEach((p,i) => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > _vpW)  p.vx *= -1;
      if (p.y < 0 || p.y > _vpH) p.vy *= -1;
      ctx.beginPath(); ctx.arc(p.x,p.y,1.5,0,Math.PI*2); ctx.fill();
      for (let j=i+1; j<particles_.length; j++) {
        const dx=p.x-particles_[j].x, dy=p.y-particles_[j].y, dist=dx*dx+dy*dy;
        if (dist < 120*120) {
          ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(particles_[j].x,particles_[j].y);
          ctx.strokeStyle = color+"22"; ctx.lineWidth=.5; ctx.stroke();
        }
      }
    });
    animId = requestAnimationFrame(animate);
  }
  animate();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(animId); else animate();
  });
  // Cursor glow — uses transform (compositor thread only, no layout reflow)
  // Previously used style.left/style.top which caused ~18ms forced reflow per frame.
  if (!isMobile) {
    const glow = document.createElement("div");
    glow.className = "cursor-glow";
    document.body.appendChild(glow);
    let mx=0, my=0, gx=0, gy=0;
    const HALF = 160; // half of 320px glow width — keeps pointer centered
    document.addEventListener("mousemove", e => { mx=e.clientX; my=e.clientY; }, { passive: true });
    (function animateGlow() {
      gx += (mx - gx) * 0.1;
      gy += (my - gy) * 0.1;
      // translate replaces left/top: no layout pass, GPU composited only
      glow.style.transform = `translate(${Math.round(gx - HALF)}px,${Math.round(gy - HALF)}px)`;
      requestAnimationFrame(animateGlow);
    })();
  }
}

/* ── PWA INSTALL ── */
let deferredPrompt = null;

const banner =
  document.getElementById("installBanner");

const installBtn =
  document.getElementById("installNow");

const laterBtn =
  document.getElementById("installLater");

/* hide initially */
if (banner) {
  banner.style.display = "none";
}

/* listen for install availability */
window.addEventListener(
  "beforeinstallprompt",
  (e) => {

    e.preventDefault();

    deferredPrompt = e;

    /* wait before showing */
    setTimeout(() => {

      /* still available */
      if (
        deferredPrompt &&
        banner
      ) {

        banner.style.display = "flex";

      }

    }, 45000); /* 45 seconds */

  }
);

/* install */
installBtn?.addEventListener(
  "click",
  async () => {

    if (!deferredPrompt) return;

    deferredPrompt.prompt();

    await deferredPrompt.userChoice;

    if (banner) {
      banner.style.display = "none";
    }

    deferredPrompt = null;

  }
);

/* later */
laterBtn?.addEventListener(
  "click",
  () => {

    if (banner) {
      banner.style.display = "none";
    }

  }
);
/* ── SERVICE WORKER ── */
if (
  "serviceWorker" in navigator &&
  location.protocol !== "file:"
) {

  navigator.serviceWorker.register("/service-worker.js")
    .then(reg => {

      function trackInstalling(worker) {

        worker.addEventListener("statechange", () => {

          if (
            worker.state === "installed" &&
            navigator.serviceWorker.controller
          ) {

            showToast("Update ready — refreshing...");

            worker.postMessage("SKIP_WAITING");
          }
        });
      }

      if (reg.installing) {
        trackInstalling(reg.installing);
      }

      reg.addEventListener("updatefound", () => {

        if (reg.installing) {
          trackInstalling(reg.installing);
        }

      });

      let refreshing = false;

      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {

          if (refreshing) return;

          refreshing = true;

          window.location.reload();
        }
      );

    })
    .catch(console.error);

}

document.body.classList.add("no-scroll");
document.body.classList.remove("no-scroll");

/* ── FAB ── */
let fabOpen = false;
function toggleFab() {
  fabOpen = !fabOpen;
  document.getElementById("fabMain").classList.toggle("open", fabOpen);
  document.getElementById("fabMenu").classList.toggle("open", fabOpen);
  document.getElementById("fabMain").setAttribute("aria-expanded", fabOpen);
}
function closeFab() {
  fabOpen = false;
  document.getElementById("fabMain")?.classList.remove("open");
  document.getElementById("fabMenu")?.classList.remove("open");
  document.getElementById("fabMain")?.setAttribute("aria-expanded", "false");
}
// Close FAB when clicking outside
document.addEventListener("click", e => {
  const fab = document.getElementById("fabContainer");
  if (fabOpen && fab && !fab.contains(e.target)) closeFab();
});

/* ── SOUNDSCAPE (Web Audio API — from proto) ── */
const soundscapeFiles = {
  rain:    "assets/sounds/rain.mp3",
  ocean:   "assets/sounds/rain.mp3",    // alias — replace with ocean.mp3 when added to assets
  forest:  "assets/sounds/forest.mp3",
  noise:   "assets/sounds/noise.mp3",
  library: "assets/sounds/library.mp3",
};
let currentSS = null;
let currentSSAudio = null;
function stopSS() {
  // stop audio
  if (currentSSAudio) {
    currentSSAudio.pause();
    currentSSAudio.currentTime = 0;
    currentSSAudio = null;
  }
  // remove active states
  document.querySelectorAll(".ss-btn")
    .forEach(btn => btn.classList.remove("active"));
  currentSS = null;
}
function toggleSS(name) {
  // toggle OFF if same sound clicked
  if (currentSS === name) {
    stopSS();
    return;
  }
  // stop previous
  stopSS();
  // silent mode protection
  if (silentMode) {
    showToast("Silent mode is on — unmute first");
    return;
  }
  const src = soundscapeFiles[name];
  if (!src) {
    console.error("Missing soundscape:", name);
    return;
  }
  // create audio
  const audio = new Audio(src);
  audio.loop = true;
  audio.preload = "auto";
  // volume sync
  audio.volume = Math.min(1, appVolume * 0.95);
  // play
  audio.play()
    .then(() => {
      currentSS = name;
      currentSSAudio = audio;
      document
        .getElementById("ss-" + name)
        ?.classList.add("active");
      showToast(
        `🎵 ${name.charAt(0).toUpperCase() + name.slice(1)} soundscape on`
      );
    })
    .catch(err => {
      console.error("Audio playback failed:", err);
      showToast("Unable to play soundscape");
    });
}
/* OPTIONAL:
   keep soundscape volume synced
   when user changes appVolume
*/
function updateSSVolume() {
  if (currentSSAudio) {
    currentSSAudio.volume = Math.min(1, appVolume * 0.95);
  }
}

/* ── DISTRACTION CAPTURE ── */
let distractions = JSON.parse(localStorage.getItem("distractions")) || [];
function saveDistractions() { localStorage.setItem("distractions", JSON.stringify(distractions)); }

function captureDistraction() {
  openModal("distractModal");
  requestAnimationFrame(() => document.getElementById("distractInput")?.focus());
}
function saveDistraction() {
  const text = document.getElementById("distractInput")?.value.trim();
  if (!text) { showToast("⚠ Write the distraction first"); return; }
  distractions.unshift({ text, date: new Date().toISOString() });
  saveDistractions();
  document.getElementById("distractInput").value = "";
  closeModal();
  renderDistractionList();
  showToast("📌 Captured! Back to work.");
}
function renderDistractionList() {
  const el = document.getElementById("distractionList");
  if (!el) return;
  const badge = document.getElementById("distractBadge");
  if (badge) badge.textContent = distractions.length ? `(${distractions.length})` : "";
  if (!distractions.length) {
    el.innerHTML = '<div class="task-empty" style="padding:28px 0"><p style="color:var(--muted)">No captured distractions yet.<br><small>Use "Capture distraction" during focus to log them here.</small></p></div>';
    return;
  }
  el.innerHTML = distractions.map((d, i) => {
    const dt = new Date(d.date);
    const time = dt.toLocaleTimeString("en-IN", {hour:"2-digit",minute:"2-digit"});
    return `<div class="distraction-item">
      <span>${escapeHtml(d.text)}</span>
      <small>${time}</small>
      <button class="distraction-del" onclick="deleteDistraction(${i})" title="Remove">✕</button>
    </div>`;
  }).join("");
}
function deleteDistraction(i) {
  distractions.splice(i, 1); saveDistractions(); renderDistractionList();
}
function escapeHtml(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

/* ── TASK TABS ── */
function switchTaskTab(tabId, btn) {
  document.querySelectorAll(".task-tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".task-tab-pane").forEach(p => p.classList.remove("active"));
  btn.classList.add("active");
  const pane = document.getElementById(tabId);
  if (pane) pane.classList.add("active");
  if (tabId === "tabDone") renderCompletedTasksList();
  if (tabId === "tabLater") renderDistractionList();
}
function renderCompletedTasksList() {
  const el = document.getElementById("tasksDone");
  if (!el) return;
  if (!completedTasks.length) {
    el.innerHTML = '<div class="task-empty" style="padding:28px 0"><p style="color:var(--muted)">Completed tasks appear here.</p></div>';
    return;
  }
  el.innerHTML = [...completedTasks].reverse().map(t => `
    <div class="task-row" style="opacity:.8;cursor:default" role="listitem">
      <div class="task-line" style="background:var(--success)"></div>
      <div class="task-content">
        <div class="task-title">
          <b style="text-decoration:line-through;opacity:.7">${escapeHtml(t.name)}</b>
          <span class="task-sessions">${t.sessions} sessions</span>
        </div>
        <small class="task-due" style="color:var(--success)">✓ Done · ${new Date(t.completedAt||t.date).toLocaleDateString("en-IN",{month:"short",day:"numeric"})}</small>
      </div>
    </div>`).join("");
}

/* ── FOCUS SCORE ── */
function updateFocusScore() {
  const s = stats[today] || { min:0, sess:0 };
  const ts = s.sess || 0;
  const done = completedTasks.filter(t => t.date === today).length;
  const score = Math.min(100, (ts*15) + (done*5) + Math.min(15, streak*2) + Math.round(Math.min(100, (s.min||0)/100*100)/10));
  const numEl = document.getElementById("scoreNum");
  const insEl = document.getElementById("scoreInsight");
  if (numEl) numEl.textContent = ts > 0 ? score : "--";
  if (insEl) {
    if (ts === 0) insEl.textContent = "Complete a session to build your score";
    else if (score >= 80) insEl.textContent = "Exceptional focus. Top-tier day. 🔥";
    else if (score >= 60) insEl.textContent = "Strong progress. Keep the momentum.";
    else if (score >= 40) insEl.textContent = "Decent start — keep building.";
    else insEl.textContent = "Early in the day. Grow this score.";
  }
}

/* ═══════════════════════════════════════════════
   FEATURE 1 — COMMAND PALETTE (Ctrl+K)
═══════════════════════════════════════════════ */
const CP_COMMANDS = [
  { group:"Timer",    icon:"▶",  name:"Start / Pause timer",    hint:"Space", action:()=>toggleTimer?.() },
  { group:"Timer",    icon:"🔁", name:"Restart session",         hint:"F",     action:()=>restartSession?.() },
  { group:"Timer",    icon:"↺",  name:"Reset timer",            hint:"R",     action:()=>resetPomodoro?.() },
  { group:"Timer",    icon:"🎯", name:"Toggle deep focus",       hint:"D",     action:()=>toggleDeepFocus?.() },
  { group:"Timer",    icon:"⏭", name:"Skip break",              hint:"S",     action:()=>skipBreak?.() },
  { group:"Focus Modes", icon:"⚡", name:"Sprint mode (15 min)",               action:()=>selectFocusMode("sprint") },
  { group:"Focus Modes", icon:"🎯", name:"Deep Work mode (50 min)",            action:()=>selectFocusMode("deep") },
  { group:"Focus Modes", icon:"🎨", name:"Creative mode (45 min)",             action:()=>selectFocusMode("creative") },
  { group:"Focus Modes", icon:"🌱", name:"Recovery mode (10 min)",             action:()=>selectFocusMode("recovery") },
  { group:"Focus Modes", icon:"🛡", name:"Burnout Safe mode (20 min)",         action:()=>selectFocusMode("burnout") },
  { group:"Focus Modes", icon:"⏱", name:"Standard mode (25 min)",             action:()=>selectFocusMode("standard") },
  { group:"Navigate", icon:"🏠", name:"Go to Home",              action:()=>showSection("home") },
  { group:"Navigate", icon:"⏱", name:"Go to Focus",             action:()=>showSection("focus") },
  { group:"Navigate", icon:"📋", name:"Go to Tasks",             action:()=>showSection("tasks") },
  { group:"Navigate", icon:"📊", name:"Go to Stats",             action:()=>showSection("stats") },
  { group:"Tasks",    icon:"＋", name:"Add new task",            hint:"N",     action:()=>openModal("taskModal") },
  { group:"Tasks",    icon:"⚡", name:"Smart Focus (best task)",               action:()=>startSmartFocus?.() },
  { group:"Tasks",    icon:"📌", name:"Capture distraction",                   action:()=>captureDistraction?.() },
  { group:"Settings", icon:"🌗", name:"Toggle theme",            hint:"L",     action:()=>toggleTheme?.() },
  { group:"Settings", icon:"🔇", name:"Toggle silent mode",      hint:"T",     action:()=>toggleSilent?.() },
  { group:"Settings", icon:"⚙", name:"Open settings",                         action:()=>openSettings?.() },
  { group:"Settings", icon:"📥", name:"Export stats JSON",                     action:()=>exportStats?.() },
];

let cpSelectedIdx = 0, cpFiltered = [];
function openCommandPalette() {
  const el = document.getElementById("commandPalette");
  if (!el) return;
  el.inert = false; el.removeAttribute("aria-hidden");
  el.classList.add("active");
  const input = document.getElementById("cpInput");
  input.value = "";
  renderCpResults("");
  requestAnimationFrame(() => { input.focus(); trapFocus(el); });
  input.oninput = () => renderCpResults(input.value.trim().toLowerCase());
  input.onkeydown = cpKeyNav;
}
function closeCommandPalette() {
  const el = document.getElementById("commandPalette");
  if (!el) return;
  releaseFocusTrap(el);
  el.classList.remove("active");
  el.inert = true; el.setAttribute("aria-hidden","true");
  try { lastFocusedEl?.focus(); } catch(_) {}
}
function renderCpResults(query) {
  const list = document.getElementById("cpResults");
  if (!list) return;
  cpFiltered = query ? CP_COMMANDS.filter(c =>
    c.name.toLowerCase().includes(query) || c.group.toLowerCase().includes(query)
  ) : CP_COMMANDS;
  if (!cpFiltered.length) { list.innerHTML = `<div class="cp-empty">No commands found for "${query}"</div>`; return; }
  const groups = {};
  cpFiltered.forEach(c => { (groups[c.group] = groups[c.group] || []).push(c); });
  let html = ""; let idx = 0;
  Object.keys(groups).forEach(g => {
    html += `<li class="cp-group-label" role="presentation">${g}</li>`;
    groups[g].forEach(c => {
      const hintHtml = c.hint ? `<span class="cp-item-hint">${c.hint}</span>` : "";
      html += `<li class="cp-item${idx===0?" cp-selected":""}" role="option" data-idx="${idx}" onclick="cpExecute(${idx})" onmouseover="cpHover(${idx})">
        <span class="cp-item-icon">${c.icon}</span>
        <span class="cp-item-name">${c.name}</span>${hintHtml}
      </li>`;
      idx++;
    });
  });
  list.innerHTML = html;
  cpSelectedIdx = 0;
}
function cpHover(idx) { cpSelectedIdx = idx; cpHighlight(); }
function cpHighlight() {
  document.querySelectorAll(".cp-item").forEach((el,i) => el.classList.toggle("cp-selected", i===cpSelectedIdx));
  document.querySelectorAll(".cp-item")[cpSelectedIdx]?.scrollIntoView({block:"nearest"});
}
function cpExecute(idx) {
  const cmd = cpFiltered[idx];
  if (!cmd) return;
  closeCommandPalette();
  setTimeout(() => cmd.action(), 80);
}
function cpKeyNav(e) {
  if (e.key === "ArrowDown") { e.preventDefault(); cpSelectedIdx = (cpSelectedIdx+1)%Math.max(1,cpFiltered.length); cpHighlight(); }
  if (e.key === "ArrowUp")   { e.preventDefault(); cpSelectedIdx = (cpSelectedIdx-1+Math.max(1,cpFiltered.length))%Math.max(1,cpFiltered.length); cpHighlight(); }
  if (e.key === "Enter")     { e.preventDefault(); cpExecute(cpSelectedIdx); }
}

/* ═══════════════════════════════════════════════
   FEATURE 2 — RECOVERY ENGINE
═══════════════════════════════════════════════ */
let recoveryLog = JSON.parse(localStorage.getItem("recoveryLog")) || [];
let recoveryStreak = Number(localStorage.getItem("recoveryStreak")) || 0;

const RECOVERY_INSIGHTS = {
  phone:      ["📱 Phone is the #1 focus killer. Put it face-down in another room next session.", "Next session: silent mode + screen away. Your focus is stronger than the notification."],
  thought:    ["💭 Thought spirals pull you out of the present. Try writing the thought down, then returning.", "Your mind wants to solve everything at once. Give it one anchor thought: the task in front of you."],
  resistance: ["😤 Resistance is normal — it often hides in the hardest, most important work.", "Start with just 5 minutes. Resistance melts when momentum starts. You restarted — that already took courage."],
  external:   ["🌍 External interruptions happen. The recovery is what matters — you came back.", "What can you control next session? Environment design is focus design."],
};

const RECOVERY_ADVICE = { phone:"Put your phone in another room.", thought:"Write the thought → return to task.", resistance:"Do just 5 minutes first.", external:"Note it and refocus." };

function showRecoveryOverlay() {
  const el = document.getElementById("recoveryOverlay");
  if (!el) return;
  document.getElementById("recoveryInsight").classList.remove("show");
  document.getElementById("recoveryInsight").textContent = "";
  document.getElementById("recoveryRestartBtn").style.display = "none";
  const scoreLine = document.getElementById("recoveryScoreLine");
  scoreLine.style.display = "none";
  document.getElementById("recoveryOptions").style.display = "flex";
  document.body.style.overflow = "hidden";
  el.inert = false; el.classList.add("active");
  requestAnimationFrame(() => { el.querySelector("button")?.focus(); trapFocus(el); });
}
function logRecovery(type) {
  recoveryLog.push({ type, time: Date.now(), date: today });
  localStorage.setItem("recoveryLog", JSON.stringify(recoveryLog));
  recoveryStreak++;
  localStorage.setItem("recoveryStreak", recoveryStreak);
  // Show insight
  const insights = RECOVERY_INSIGHTS[type] || [];
  const insight = insights[Math.floor(Math.random()*insights.length)] || "";
  const insightEl = document.getElementById("recoveryInsight");
  insightEl.textContent = insight;
  insightEl.classList.add("show");
  // Hide options, show restart
  document.getElementById("recoveryOptions").style.display = "none";
  document.getElementById("recoveryRestartBtn").style.display = "block";
  const scoreLine = document.getElementById("recoveryScoreLine");
  document.getElementById("recoveryStreakVal").textContent = recoveryStreak;
  scoreLine.style.display = "flex";
}
function recoveryRestart() {
  // Record restart time on the most recent log entry
  if (recoveryLog.length > 0 && !recoveryLog[recoveryLog.length-1].restartTime) {
    recoveryLog[recoveryLog.length-1].restartTime = Date.now();
    localStorage.setItem("recoveryLog", JSON.stringify(recoveryLog));
    updateRecoveryScore?.();
  }
  closeRecoveryOverlay();
  setTimeout(() => { restartSession?.(); showToast("🔁 Recovery restart — you came back."); }, 200);
}
function closeRecoveryOverlay() {
  const el = document.getElementById("recoveryOverlay");
  if (!el) return;
  releaseFocusTrap(el);
  el.classList.remove("active");
  el.inert = true;
  document.body.style.overflow = "";
}

/* ═══════════════════════════════════════════════
   FEATURE 3 — EMOTIONAL STATE CHECK
═══════════════════════════════════════════════ */
const EMOTION_MODES = {
  focused:   { modeRec:"deep",     sound:"forest",  msg:"🎯 You're primed. Deep Work mode loaded." },
  calm:      { modeRec:"deep",     sound:"forest",  msg:"😌 Calm focus is powerful. Deep Work awaits." },
  tired:     { modeRec:"sprint",   sound:"noise",   msg:"😴 Energy is low — Sprint mode keeps it achievable." },
  anxious:   { modeRec:"recovery", sound:"rain",    msg:"😰 Anxiety spikes with long sessions. Recovery mode first." },
  resistant: { modeRec:"sprint",   sound:"rain",    msg:"😤 Starting is the hard part. A 15-min Sprint breaks resistance." },
};

let emotionalStateChecked = !!localStorage.getItem("emotionalState_" + today);
let pendingTimerStart = false;

/* If user already checked in today AND has done at least one session,
   never show the modal again this calendar day regardless of page reload. */
function _shouldShowEmotionCheck() {
  if (emotionalStateChecked) return false;
  if ((stats[today]?.sess ?? 0) > 0) {
    // They've already done a session today — mark as checked so we stop asking
    emotionalStateChecked = true;
    return false;
  }
  return true;
}

function selectEmotion(stateId) {
  const cfg = EMOTION_MODES[stateId];
  if (!cfg) return;
  emotionalStateChecked = true;
  localStorage.setItem("emotionalState_" + today, stateId);
  // Apply mode recommendation
  selectFocusMode(cfg.modeRec);
  // Apply sound recommendation
  if (!silentMode && cfg.sound) toggleSS(cfg.sound);
  // Show banner message
  const banner = document.getElementById("stateRecBanner");
  banner.textContent = cfg.msg; banner.classList.add("show");
  // Close modal and start timer if pending
  setTimeout(() => {
    closeModal();
    if (pendingTimerStart) { pendingTimerStart = false; startSession("focus", settings.focus); updateTimerButton(); }
  }, 1400);
}
function skipEmotionCheck() {
  emotionalStateChecked = true;
  closeModal();
  if (pendingTimerStart) { pendingTimerStart = false; startSession("focus", settings.focus); updateTimerButton(); }
}

/* ═══════════════════════════════════════════════
   FEATURE 4 — MULTI-LAYER FOCUS MODES
═══════════════════════════════════════════════ */
const FOCUS_MODES = {
  standard: { label:"⏱ Standard",  focus:25, break:5, long:15, desc:"Classic Pomodoro · 25 min" },
  sprint:   { label:"⚡ Sprint",   focus:15, break:3, long:10, desc:"Intense 15-min burst · 3 min break" },
  deep:     { label:"🎯 Deep",     focus:50, break:7, long:15, desc:"Long uninterrupted work · 50 min" },
  creative: { label:"🎨 Creative", focus:45, break:8, long:15, desc:"Creative flow · 45 min, pressure-light" },
  recovery: { label:"🌱 Recovery", focus:10, break:5, long:10, desc:"Gentle re-entry · 10 min" },
  burnout:  { label:"🛡 Burnout Safe", focus:20, break:5, long:12, desc:"Reduced cognitive load · 20 min" },
};

let activeMode = localStorage.getItem("focusMode") || "standard";

function selectFocusMode(modeId) {
  if (Session.state === "running") { showToast("⚠ Finish or pause current session first"); return; }
  const m = FOCUS_MODES[modeId];
  if (!m) return;
  activeMode = modeId;
  localStorage.setItem("focusMode", modeId);
  settings.focus = m.focus; settings.break = m.break; settings.long = m.long;
  save(); resetPomodoro();
  // Update pill UI
  document.querySelectorAll(".mode-pill").forEach(p => p.classList.toggle("active", p.dataset.mode === modeId));
  const descEl = document.getElementById("modeDescRow");
  if (descEl) descEl.textContent = m.desc;
  showToast(`${m.label} · ${m.focus} min`);
}

function initFocusMode() {
  const m = FOCUS_MODES[activeMode] || FOCUS_MODES.standard;
  settings.focus = m.focus; settings.break = m.break; settings.long = m.long;
  document.querySelectorAll(".mode-pill").forEach(p => p.classList.toggle("active", p.dataset.mode === activeMode));
  const descEl = document.getElementById("modeDescRow");
  if (descEl) descEl.textContent = m.desc;
}

/* ═══════════════════════════════════════════════
   FEATURE 5 — POST-SESSION GUIDED REFLECTION
═══════════════════════════════════════════════ */
const REFLECTION_SETS = [
  { q1:"What made this session strong?",       q2:"What pulled you out of flow?",       q3:"What should tomorrow's sessions feel like?" },
  { q1:"Where were you most locked in?",       q2:"What weakened your focus?",           q3:"One insight from this session?" },
  { q1:"What did you protect time for?",       q2:"What resistance showed up?",          q3:"One thing worth repeating next time?" },
  { q1:"How clear was your intention?",        q2:"What external noise got in the way?", q3:"What would your future self thank you for?" },
];
let reflectionData = JSON.parse(localStorage.getItem("vf_reflections")) || [];

function setRitualReflectionQuestions(sessNum) {
  const set = REFLECTION_SETS[sessNum % REFLECTION_SETS.length];
  const el1 = document.getElementById("rq1label"); if (el1) el1.textContent = set.q1;
  const el2 = document.getElementById("rq2label"); if (el2) el2.textContent = set.q2;
  const el3 = document.getElementById("rq3label"); if (el3) el3.textContent = set.q3;
  // Clear previous answers
  ["rq1","rq2","rq3"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
}

function saveReflectionFromRitual() {
  const a1 = document.getElementById("rq1")?.value.trim();
  const a2 = document.getElementById("rq2")?.value.trim();
  const a3 = document.getElementById("rq3")?.value.trim();
  if (!a1 && !a2 && !a3) { closeRitual(); return; }
  const sessNum = Object.values(stats).reduce((s,d)=>s+(d.sess||0),0);
  const set = REFLECTION_SETS[sessNum % REFLECTION_SETS.length];
  reflectionData.push({ date: today, time: Date.now(), tag: currentSessionTag, mode: activeMode, q1:[set.q1,a1], q2:[set.q2,a2], q3:[set.q3,a3] });
  localStorage.setItem("vf_reflections", JSON.stringify(reflectionData));
  showToast("💬 Reflection saved");
  closeRitual();
}

/* ═══════════════════════════════════════════════
   FEATURE 6 — SESSION TAGGING
═══════════════════════════════════════════════ */
let currentSessionTag = localStorage.getItem("lastSessionTag") || null;

function setSessionTag(tag) {
  if (currentSessionTag === tag) { currentSessionTag = null; }
  else { currentSessionTag = tag; localStorage.setItem("lastSessionTag", tag); }
  document.querySelectorAll(".session-tag-btn").forEach(b => b.classList.toggle("active", b.dataset.tag === currentSessionTag));
  showToast(currentSessionTag ? `🏷 Tagged: ${currentSessionTag}` : "Tag removed");
}
function initSessionTagUI() {
  document.querySelectorAll(".session-tag-btn").forEach(b => b.classList.toggle("active", b.dataset.tag === currentSessionTag));
}

/* ── UPDATED showFocusRitual — now passes tag + reflection questions ── */
function showFocusRitual() {
  const ritual = document.getElementById("focusRitual");
  const lineEl = document.getElementById("ritualLine");
  if (!ritual || !lineEl) return;
  lineEl.textContent = RITUAL_LINES[Math.floor(Math.random() * RITUAL_LINES.length)];
  // Tag badge
  const tagBadge = document.getElementById("ritualTagBadge");
  if (tagBadge) {
    tagBadge.textContent = currentSessionTag ? `🏷 ${currentSessionTag}` : "";
    tagBadge.style.display = currentSessionTag ? "inline-block" : "none";
  }
  // XP / streak line
  const xpRow = document.getElementById("ritualXpRow");
  if (xpRow) { const streakLine = document.getElementById("ritualStreakLine"); if (streakLine) streakLine.textContent = streak > 0 ? `🔥 ${streak} day streak` : "Keep going!"; }
  // Set reflection questions
  const sessTotal = Object.values(stats).reduce((s,d)=>s+(d.sess||0),0);
  setRitualReflectionQuestions(sessTotal);
  document.body.style.overflow = "hidden";
  ritual.inert = false;
  ritual.classList.add("active");
  requestAnimationFrame(() => { ritual.querySelector("button")?.focus(); trapFocus(ritual); });
}

/* ═══════════════════════════════════════════════
   FEATURE 7 — RESISTANCE DETECTION
═══════════════════════════════════════════════ */
let resistanceMap = JSON.parse(localStorage.getItem("resistanceMap")) || {}; // { taskId: count }
const RESISTANCE_THRESHOLD = 3; // flag after 3 paused starts

function incrementResistance(taskId) {
  const key = String(taskId);
  resistanceMap[key] = (resistanceMap[key] || 0) + 1;
  localStorage.setItem("resistanceMap", JSON.stringify(resistanceMap));
  if (resistanceMap[key] === RESISTANCE_THRESHOLD) {
    const t = tasks.find(t => t.id === taskId);
    if (t) showToast(`⚠ "${shortName(t.name)}" flagged as High Resistance`, 3500);
  }
}
function clearResistance(taskId) {
  delete resistanceMap[String(taskId)];
  localStorage.setItem("resistanceMap", JSON.stringify(resistanceMap));
}
function getResistanceCount(taskId) { return resistanceMap[String(taskId)] || 0; }
function isHighResistance(taskId) { return getResistanceCount(taskId) >= getResistanceThresholdForUser(); }

let resistanceTargetId = null;
function openResistanceModal(taskId) {
  resistanceTargetId = taskId;
  const t = tasks.find(t => t.id === taskId);
  const nameEl = document.getElementById("resistanceTaskName");
  if (nameEl && t) nameEl.textContent = `"${shortName(t.name)}" has been paused ${getResistanceCount(taskId)} times. That's resistance — here's how to break through.`;
  openModal("resistanceModal");
}
function resistanceAction(type, taskId) {
  const id = taskId || resistanceTargetId;
  closeModal();
  if (id) { activeTaskId = id; save(); renderTasks(); }
  setTimeout(() => {
    if (type === "sprint")    { selectFocusMode("sprint");   showSection("focus"); toggleTimer?.(); }
    if (type === "recovery")  { selectFocusMode("recovery"); showSection("focus"); toggleTimer?.(); }
    if (type === "break")     { showToast("✂ Task linked — break it into smaller steps in the task name"); showSection("focus"); }
  }, 150);
}

/* ═══════════════════════════════════════════════
   FEATURE 8 — RECOVERY SCORE (proper metric)
═══════════════════════════════════════════════ */
function computeRecoveryScore() {
  const logs = recoveryLog || [];
  if (!logs.length) return { score: 0, restartRate: 0, speedPct: 0, consistPct: 0 };

  // Restart rate: % of logs that have a restartTime
  const withRestart = logs.filter(l => l.restartTime).length;
  const restartRate = withRestart / logs.length; // 0–1

  // Speed score: avg restart delay. ≤ 2 min = 100%, ≥ 10 min = 0%
  const restartTimes = logs.filter(l => l.restartTime).map(l => (l.restartTime - l.time) / 1000);
  const avgDelay = restartTimes.length ? restartTimes.reduce((a,b)=>a+b,0)/restartTimes.length : 600;
  const speedPct = Math.max(0, 1 - (avgDelay - 120) / (600 - 120));

  // Consistency: if user has recovered across multiple days
  const days = new Set(logs.filter(l => l.restartTime).map(l => l.date)).size;
  const consistPct = Math.min(1, days / 5); // max at 5 recovery days

  // Weighted score
  const score = Math.round((restartRate * 40) + (speedPct * 40) + (consistPct * 20));
  return { score, restartRate: Math.round(restartRate*100), speedPct: Math.round(speedPct*100), consistPct: Math.round(consistPct*100) };
}

function updateRecoveryScore() {
  const { score, restartRate, speedPct, consistPct } = computeRecoveryScore();
  const numEl = document.getElementById("recovScoreNum");
  if (numEl) numEl.textContent = recoveryLog.length ? score : "--";
  const rBar = document.getElementById("recovRestartBar");
  if (rBar) rBar.style.width = restartRate + "%";
  const sBar = document.getElementById("recovSpeedBar");
  if (sBar) sBar.style.width = speedPct + "%";
  const cBar = document.getElementById("recovConsistBar");
  if (cBar) cBar.style.width = consistPct + "%";
  const insEl = document.getElementById("recovInsightText");
  if (insEl) {
    if (!recoveryLog.length) insEl.textContent = "Log a distraction + restart to build your Recovery Score.";
    else if (score >= 80) insEl.textContent = "Exceptional recovery ability. You bounce back fast. 💪";
    else if (score >= 60) insEl.textContent = "Strong recovery. Most interruptions don't derail you.";
    else if (score >= 40) insEl.textContent = "Building recovery muscle. Each restart counts.";
    else if (score >= 20) insEl.textContent = "Recovery takes time — every comeback improves the score.";
    else insEl.textContent = "Hit 'Restart Session' after capturing a distraction to boost this.";
  }
}

/* ═══════════════════════════════════════════════
   SKILL TREE (Second Tier)
═══════════════════════════════════════════════ */
const SKILL_NODES = [
  { id:"awareness",  xp:50,   icon:"👁",  name:"Focus Awareness",     perk:"+1 XP bonus per session",     desc:"You've started understanding your patterns." },
  { id:"reader",     xp:150,  icon:"📖",  name:"Pattern Reader",       perk:"+2 XP bonus per session",     desc:"You read your focus patterns before they read you." },
  { id:"fighter",    xp:300,  icon:"⚔",  name:"Resistance Fighter",   perk:"Resistance flags at 2 attempts", desc:"You detect resistance earlier and act on it." },
  { id:"flow",       xp:600,  icon:"🌊",  name:"Flow State",           perk:"+5 XP on deep sessions",      desc:"Deep work unlocks extended bonus XP." },
  { id:"momentum",   xp:1000, icon:"⚡",  name:"Momentum Master",      perk:"Recovery Score feeds Focus Score", desc:"Your ability to recover is recognized in your score." },
  { id:"identity",   xp:2000, icon:"🌟",  name:"Master of Focus",      perk:"Identity tier: Legend",       desc:"You have built focus as an identity, not a habit." },
];

let unlockedSkills = JSON.parse(localStorage.getItem("unlockedSkills")) || [];

function checkSkillUnlocks(currentXp) {
  let newUnlock = false;
  SKILL_NODES.forEach(node => {
    if (currentXp >= node.xp && !unlockedSkills.includes(node.id)) {
      unlockedSkills.push(node.id);
      newUnlock = true;
      showToast(`🌟 Skill unlocked: ${node.name}!`, 3500);
    }
  });
  if (newUnlock) localStorage.setItem("unlockedSkills", JSON.stringify(unlockedSkills));
}

function getActiveSkillPerks() {
  return SKILL_NODES.filter(n => unlockedSkills.includes(n.id)).map(n => n.id);
}

function getXpForSession() {
  const perks = getActiveSkillPerks();
  let base = 10;
  if (perks.includes("awareness")) base += 1;
  if (perks.includes("reader"))    base += 2;
  if (perks.includes("flow") && activeMode === "deep") base += 5;
  return base;
}

function getResistanceThresholdForUser() {
  return getActiveSkillPerks().includes("fighter") ? 2 : 3;
}

function updateSkillTree() {
  const container = document.getElementById("skillTree");
  if (!container) return;
  checkSkillUnlocks(xp);
  container.innerHTML = SKILL_NODES.map(node => {
    const unlocked = unlockedSkills.includes(node.id);
    const isNext = !unlocked && xp >= (SKILL_NODES[SKILL_NODES.indexOf(node)-1]?.xp || 0);
    const cls = unlocked ? "skill-node unlocked" : isNext ? "skill-node active-perk" : "skill-node locked";
    const xpNeeded = node.xp - xp;
    return `<div class="${cls}">
      <div class="skill-icon">${node.icon}</div>
      <div class="skill-info">
        <div class="skill-name">${node.name}</div>
        <div class="skill-desc">${node.desc}</div>
        <div class="skill-perk">⚡ ${node.perk}</div>
        ${!unlocked ? `<div class="skill-xp-needed">${xpNeeded > 0 ? xpNeeded + " XP to unlock" : "Ready to unlock!"}</div>` : ""}
      </div>
      ${unlocked ? '<span style="font-size:14px;color:var(--success);align-self:center;">✓</span>' : `<span class="skill-lock-icon">🔒</span>`}
    </div>`;
  }).join("");
}

/* ═══════════════════════════════════════════════
   ADAPTIVE RECOMMENDATIONS (Second Tier)
═══════════════════════════════════════════════ */
function buildAdaptiveRecs() {
  const recs = [];
  const s = stats[today] || { min:0, sess:0 };
  const todaySess = s.sess || 0;
  const todayMin  = s.min  || 0;
  const emotion   = localStorage.getItem("emotionalState_" + today);
  const pauseCount = recoveryLog.filter(l => l.date === today).length;
  const resistCount = Object.values(resistanceMap).reduce((a,b)=>a+b,0);

  // Tired / anxious state recs
  if (emotion === "tired" && todaySess === 0) {
    recs.push({ icon:"😴", title:"Energy is low today", text:"Sprint mode (15 min) is more achievable than a full session.", action:"⚡ Switch to Sprint", fn: ()=>{ selectFocusMode("sprint"); showSection("focus"); } });
  }
  if (emotion === "anxious") {
    recs.push({ icon:"😰", title:"You checked in as anxious", text:"Recovery mode reduces pressure. Start gentle.", action:"🌱 Recovery Mode", fn: ()=>{ selectFocusMode("recovery"); showSection("focus"); } });
  }
  if (emotion === "resistant") {
    recs.push({ icon:"😤", title:"Resistance flagged this morning", text:"A 5-minute sprint breaks the pattern. You just need momentum.", action:"⚡ 5-min Sprint", fn: ()=>{ selectFocusMode("sprint"); showSection("focus"); toggleTimer?.(); } });
  }

  // Too many interruptions today
  if (pauseCount >= 2 && todaySess < 2) {
    recs.push({ icon:"🔄", title:"Multiple pauses today", text:"Try a shorter Sprint mode — less pressure, still counts.", action:"Switch to Sprint", fn: ()=>selectFocusMode("sprint") });
  }

  // High resistance tasks exist
  if (resistCount >= RESISTANCE_THRESHOLD) {
    const resistTask = tasks.find(t => isHighResistance(t.id));
    if (resistTask) {
      recs.push({ icon:"⚠", title:`"${shortName(resistTask.name)}" needs a breakthrough`, text:"This task keeps getting avoided. A 5-min starter often breaks resistance.", action:"⚡ Starter Sprint", fn: ()=>resistanceAction("sprint", resistTask.id) });
    }
  }

  // Good momentum: reinforce
  if (todaySess >= 3) {
    recs.push({ icon:"🔥", title:"Strong day — you're on a roll", text:`${todaySess} sessions done. Deep Work mode now gives +5 XP.`, action:"🎯 Go Deep", fn: ()=>{ selectFocusMode("deep"); showSection("focus"); } });
  }

  // Suggest reflection if 2+ sessions done with no reflection
  const reflections = JSON.parse(localStorage.getItem("vf_reflections") || "[]");
  const todayRef = reflections.filter(r => r.date === today);
  if (todaySess >= 2 && todayRef.length === 0) {
    recs.push({ icon:"💬", title:"Reflect on today's sessions", text:"2+ sessions in — a quick reflection sharpens tomorrow's focus.", action:"Go to Stats", fn: ()=>showSection("stats") });
  }

  return recs.slice(0, 3); // max 3 recs
}

function updateAdaptiveRecs() {
  const card = document.getElementById("adaptiveRecCard");
  const list = document.getElementById("recList");
  if (!card || !list) return;
  const recs = buildAdaptiveRecs();
  if (!recs.length) { card.style.display = "none"; return; }
  card.style.display = "";
  list.innerHTML = recs.map((r, i) => `
    <div class="rec-item" onclick="applyRec(${i})" role="button" tabindex="0" onkeydown="if(event.key==='Enter')applyRec(${i})">
      <span class="rec-icon">${r.icon}</span>
      <span class="rec-text"><b>${r.title}</b><span>${r.text}</span></span>
      <span class="rec-action">${r.action} →</span>
    </div>`).join("");
  window._currentRecs = recs;
}
function applyRec(idx) {
  const recs = window._currentRecs || [];
  if (!recs[idx]) return;
  // Execute the action
  recs[idx].fn?.();
  // Remove from list and re-render
  recs.splice(idx, 1);
  window._currentRecs = recs;
  const card = document.getElementById("adaptiveRecCard");
  const list = document.getElementById("recList");
  if (!recs.length) {
    if (card) { card.style.opacity = "0"; card.style.transform = "translateY(-8px)"; setTimeout(() => { card.style.display = "none"; card.style.opacity = ""; card.style.transform = ""; }, 280); }
    return;
  }
  if (list) {
    list.innerHTML = recs.map((r, i) => `
      <div class="rec-item" onclick="applyRec(${i})" role="button" tabindex="0" onkeydown="if(event.key==='Enter')applyRec(${i})">
        <span class="rec-icon">${r.icon}</span>
        <span class="rec-text"><b>${r.title}</b><span>${r.text}</span></span>
        <span class="rec-action">${r.action} →</span>
      </div>`).join("");
  }
}

/* ═══════════════════════════════════════════════
   BEHAVIORAL PATTERN ENGINE (Second Tier)
═══════════════════════════════════════════════ */
let sessionHourLog = JSON.parse(localStorage.getItem("sessionHourLog")) || [];
// Each entry: { hour, date, tag, mode }

function logSessionHour() {
  const hour = new Date().getHours();
  sessionHourLog.push({ hour, date: today, tag: currentSessionTag || null, mode: activeMode || "standard" });
  // Keep last 90 entries
  if (sessionHourLog.length > 90) sessionHourLog = sessionHourLog.slice(-90);
  localStorage.setItem("sessionHourLog", JSON.stringify(sessionHourLog));
}

function getBestFocusHour() {
  if (sessionHourLog.length < 3) return null;
  const hourCounts = {};
  sessionHourLog.forEach(l => { hourCounts[l.hour] = (hourCounts[l.hour] || 0) + 1; });
  const best = Object.keys(hourCounts).sort((a,b) => hourCounts[b]-hourCounts[a])[0];
  const bestNum = parseInt(best);
  const label = (h) => {
    if (h === 0) return "midnight";
    if (h < 12) return `${h}am`;
    if (h === 12) return "noon";
    return `${h-12}pm`;
  };
  return `${label(bestNum)}–${label(bestNum+1 > 23 ? 0 : bestNum+1)}`;
}

function getTopTag() {
  const allTags = {};
  Object.values(stats).forEach(d => {
    if (d.tags) Object.entries(d.tags).forEach(([k,v]) => { allTags[k] = (allTags[k]||0) + v; });
  });
  const sorted = Object.keys(allTags).sort((a,b)=>allTags[b]-allTags[a]);
  return sorted[0] || null;
}

function getTopMode() {
  const modeCounts = {};
  sessionHourLog.forEach(l => { modeCounts[l.mode] = (modeCounts[l.mode]||0)+1; });
  const sorted = Object.keys(modeCounts).sort((a,b)=>modeCounts[b]-modeCounts[a]);
  return sorted[0] || null;
}

function getAvgSessionsPerDay() {
  const days = Object.keys(stats).filter(d => stats[d].sess > 0);
  if (!days.length) return 0;
  const total = days.reduce((s,d)=>s+(stats[d].sess||0),0);
  return (total / days.length).toFixed(1);
}

function updateBehavioralPatterns() {
  const totalSess = Object.values(stats).reduce((s,d)=>s+(d.sess||0),0);
  const bestHour = getBestFocusHour();
  const topTag   = getTopTag();
  const topMode  = getTopMode();
  const avgSess  = getAvgSessionsPerDay();

  const bhEl = document.getElementById("patBestHour");
  if (bhEl) bhEl.textContent = bestHour || "--";
  const ttEl = document.getElementById("patTopTag");
  if (ttEl) ttEl.textContent = topTag || "--";
  const tmEl = document.getElementById("patTopMode");
  if (tmEl) tmEl.textContent = topMode ? (topMode.charAt(0).toUpperCase()+topMode.slice(1)) : "--";
  const asEl = document.getElementById("patAvgSess");
  if (asEl) asEl.textContent = avgSess;

  const insEl = document.getElementById("patternInsights");
  if (!insEl) return;
  const insights = [];
  if (totalSess < 5) {
    insights.push({ text:"Complete 5+ sessions to reveal behavioral patterns.", dim:true });
  } else {
    if (bestHour) insights.push({ text:`🕐 You focus most often at ${bestHour} — protect that window.`, dim:false });
    if (topTag)   insights.push({ text:`💻 "${topTag}" is your most-focused work type — you're building depth there.`, dim:false });
    if (topMode)  insights.push({ text:`⚡ ${topMode.charAt(0).toUpperCase()+topMode.slice(1)} mode is your go-to — your focus pattern is clear.`, dim:false });
    const bestDay = Object.keys(stats).filter(d=>stats[d].sess>0).sort((a,b)=>(stats[b].sess||0)-(stats[a].sess||0))[0];
    if (bestDay) {
      const dayName = new Date(bestDay).toLocaleDateString("en-IN",{weekday:"long"});
      insights.push({ text:`📅 ${dayName} tends to be your strongest focus day.`, dim:false });
    }
    const pauseHeavy = recoveryLog.length >= 5;
    if (pauseHeavy) {
      const common = recoveryLog.reduce((acc,l) => { acc[l.type]=(acc[l.type]||0)+1; return acc; }, {});
      const topDistr = Object.keys(common).sort((a,b)=>common[b]-common[a])[0];
      const labels = { phone:"phone/social media", thought:"thought spirals", resistance:"task resistance", external:"external interruptions" };
      if (topDistr) insights.push({ text:`📱 Your top distraction pattern: ${labels[topDistr] || topDistr}. Awareness is the first fix.`, dim:false });
    }
  }
  insEl.innerHTML = insights.map(i => `<div class="pattern-insight-row${i.dim?' dim':''}">${i.text}</div>`).join("") || '<div class="pattern-insight-row dim">More sessions needed to surface insights.</div>';
}

/* ── INIT ── */
function initApp() {
  // ── PHASE 1: Critical — must complete for the page to feel interactive ──
  activeTaskId = Number(localStorage.getItem("activeTaskId")) || null;
  focusIn.value = settings.focus;
  breakIn.value = settings.break;
  longIn.value  = settings.long;
  ensureTodayStats();
  applySavedTheme();   // must be before first paint to prevent flash
  resetPomodoro();
  initFocusMode();
  initSessionTagUI();
  updateClock();
  loadDailyIntent();
  renderTasks();
  renderInsight();
  updateUI();

  // Navigate to last or hash section
  const hashSection = window.location.hash.replace("#", "").toLowerCase();
  const validSections = ["home", "focus", "tasks", "stats"];
  const lastSec = (hashSection && validSections.includes(hashSection))
    ? hashSection
    : (localStorage.getItem("lastSection") || "home");
  showSection(lastSec);
  if (hashSection) history.replaceState(null, "", window.location.pathname);

  initNotifications();
  showPendingNotifications();

  // ── PHASE 2: Deferred — non-blocking, runs when the browser has idle time ──
  // Three cascading idle callbacks so no single long task blocks INP/TBT.
  // rIC timeout values are generous (500 ms) so work never starves on slow devices.
  const _idle = typeof requestIdleCallback === "function"
    ? (fn, opts) => requestIdleCallback(fn, opts)
    : (fn) => setTimeout(fn, 50);

  // 2a — Urgent idle: things visible in the active section on startup
  _idle(() => {
    showOnboarding();
    handleWeeklyReflection();
    updateTodayDashboard();
    updateCompletedTaskStats();
    updateFocusScore();
    // Only render heatmap/achievements if stats section was the startup section
    if (lastSec === "stats") {
      renderHeatmap();
      renderAchievements();
    }
  }, { timeout: 500 });

  // 2b — Secondary idle: background analytics + hidden-panel work
  _idle(() => {
    updateRecoveryScore();
    renderDistractionList();
    updateAdaptiveRecs();
  }, { timeout: 1000 });

  // 2c — Low-priority idle: skill tree, patterns, Ctrl+K hint injection
  _idle(() => {
    updateSkillTree();
    updateBehavioralPatterns();

    // Inject Ctrl+K hint into settings keyboard grid
    const kbdGrid = document.querySelector(".kbd-grid");
    if (kbdGrid && !document.getElementById("cpKbdHint")) {
      const row = document.createElement("div");
      row.className = "kbd-row"; row.id = "cpKbdHint";
      row.innerHTML = '<kbd>Ctrl+K</kbd><span>Command palette</span>';
      kbdGrid.insertBefore(row, kbdGrid.firstChild);
    }

    // Render heatmap/achievements now if they were deferred from 2a
    if (lastSec !== "stats") {
      renderHeatmap();
      renderAchievements();
    }
  }, { timeout: 2000 });
}

document.addEventListener("DOMContentLoaded", initApp);