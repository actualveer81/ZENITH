/* ═══════════════════════════════════════════════════════════════
   ZENITH — Phase 4: Gamification  (#11 · #12)
   ─────────────────────────────────────────────────────────────
   #11  Skill Tree System
        Replaces the plain skill-node list in app.js with a full
        visual tree: four branches (Discipline · Consistency ·
        Deep Work · Mindfulness), SVG connector arcs, animated
        unlock bursts, XP progress rings, and a perk feed.

   #12  Focus Streak Visualizations — four switchable themes:
        · Flame      — particle fire, intensity scales with streak
        · Neural     — growing synaptic network, node per session
        · Zen Garden — evolving sand ripple mandala
        · Galaxy     — stars + constellations, streak = star count

   Reads existing globals (no app.js edits):
        window.xp · window.streak · window.unlockedSkills
        window.SKILL_NODES · window.activeMode
        window.stats · window.Session

   Hooks fired from app.js already:
        window.updateSkillTree   (called after every session)
        window.updateFocusScore  (called after every session)
        window.updateUI          (called frequently)

   HTML injection: both modules self-inject into #statsSection.
   Load order: after app.js  ( <script defer src="phase4-gamification.js"> )
═══════════════════════════════════════════════════════════════ */
"use strict";

/* ════════════════════════════════════════════════════════════
   ██████████████████████████████████████████
   #11  ENHANCED SKILL TREE
   ██████████████████████████████████████████
════════════════════════════════════════════════════════════ */

const ZenithSkillTree = (() => {

  /* ── Four visual branches ── */
  const BRANCHES = {
    discipline: {
      label: "Discipline",
      icon:  "⚔",
      color: "#f59e0b",
      nodes: [
        { id:"awareness",  xp:50,   icon:"👁",  name:"Focus Awareness",   perk:"+1 XP / session",              desc:"Patterns start becoming visible." },
        { id:"fighter",    xp:300,  icon:"⚔",  name:"Resistance Fighter", perk:"Resistance flags after 2× pauses", desc:"You detect resistance early." },
        { id:"iron_will",  xp:800,  icon:"🔱", name:"Iron Will",          perk:"+3 XP / session bonus",         desc:"Willpower has become structural." },
      ],
    },
    consistency: {
      label: "Consistency",
      icon:  "📅",
      color: "#4f9cf9",
      nodes: [
        { id:"reader",     xp:150,  icon:"📖",  name:"Pattern Reader",    perk:"+2 XP / session",               desc:"You read your rhythms clearly." },
        { id:"momentum",   xp:1000, icon:"⚡",  name:"Momentum Master",   perk:"Recovery feeds Focus Score",    desc:"Comebacks are part of your system." },
        { id:"clockwork",  xp:1800, icon:"🕰",  name:"Clockwork",         perk:"Streak days give +5 XP",         desc:"Showing up is automatic." },
      ],
    },
    deepwork: {
      label: "Deep Work",
      icon:  "🎯",
      color: "#00e5c0",
      nodes: [
        { id:"flow",       xp:600,  icon:"🌊",  name:"Flow State",        perk:"+5 XP on deep sessions",        desc:"You reliably enter deep flow." },
        { id:"deep_arch",  xp:1200, icon:"🏛",  name:"Deep Architect",    perk:"50-min sessions count ×1.5",    desc:"Long blocks are your default." },
        { id:"zenith_mode",xp:2500, icon:"🌌",  name:"Zenith Mode",       perk:"All XP bonuses stack ×1.2",     desc:"You operate at the ceiling." },
      ],
    },
    mindfulness: {
      label: "Mindfulness",
      icon:  "🌱",
      color: "#a78bfa",
      nodes: [
        { id:"stillness",  xp:200,  icon:"🧘",  name:"Stillness",         perk:"Recovery sessions +3 XP",       desc:"Rest is intentional, not collapse." },
        { id:"awareness2", xp:500,  icon:"💜",  name:"Deep Presence",     perk:"Emotional check-in unlocks sound",desc:"Mood shapes your session, wisely." },
        { id:"identity",   xp:2000, icon:"🌟",  name:"Master of Focus",   perk:"Identity tier: Legend",          desc:"Focus is who you are." },
      ],
    },
  };

  /* Flatten for XP lookup */
  const ALL_NODES = Object.values(BRANCHES).flatMap(b =>
    b.nodes.map(n => ({ ...n, branch: b.label, color: b.color }))
  );

  /* ── Unlock state ── */
  function _unlocked(id) { return (window.unlockedSkills || []).includes(id); }
  function _xp()         { return window.xp ?? 0; }
  function _streak()     { return window.streak ?? 0; }

  /* Total sessions ever */
  function _totalSess() {
    return Object.values(window.stats || {}).reduce((s, d) => s + (d.sess || 0), 0);
  }

  /* XP to next overall milestone */
  function _nextMilestone() {
    const milestones = ALL_NODES.map(n => n.xp).sort((a, b) => a - b);
    return milestones.find(m => m > _xp()) ?? milestones[milestones.length - 1];
  }

  /* ── Inject container into stats section ── */
  function _ensureContainer() {
    if (document.getElementById("skillTreeCard")) return;

    /* Replace old skill tree card if it exists */
    const oldCard = document.getElementById("skillTree")?.closest(".card");
    const target  = oldCard || document.querySelector(".desktop-stats-grid") || document.getElementById("statsSection");
    if (!target) return;

    const card = document.createElement("div");
    card.className = "card";
    card.id        = "skillTreeCard";
    card.innerHTML = `
      <div class="card-label">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
        Skill Tree
      </div>

      <!-- XP Summary bar -->
      <div class="st-xp-bar-wrap">
        <div class="st-xp-info">
          <span class="st-xp-num" id="stXpNum">0 XP</span>
          <span class="st-xp-next" id="stXpNext">→ 50 XP next unlock</span>
        </div>
        <div class="st-xp-track">
          <div class="st-xp-fill" id="stXpFill" style="width:0%"></div>
          <div class="st-xp-glow" id="stXpGlow" style="width:0%"></div>
        </div>
      </div>

      <!-- Branch tabs -->
      <div class="st-branch-tabs" id="stBranchTabs" role="tablist"></div>

      <!-- Active branch nodes -->
      <div class="st-nodes-panel" id="stNodesPanel"></div>

      <!-- Unlocked perks feed -->
      <div class="st-perks-feed" id="stPerksFeed"></div>

      <!-- Overall progress legend -->
      <div class="st-legend" id="stLegend"></div>
    `;

    if (oldCard) { oldCard.replaceWith(card); }
    else         { target.appendChild(card); }

    /* Override app.js updateSkillTree → route to our render */
    window.updateSkillTree = () => ZenithSkillTree.render();
  }

  /* ── Main render ── */
  let _activeBranch = "discipline";

  function render() {
    _ensureContainer();
    _renderXpBar();
    _renderBranchTabs();
    _renderNodes();
    _renderPerksFeed();
    _renderLegend();
    _checkNewUnlocks();
  }

  function _renderXpBar() {
    const curXp    = _xp();
    const next     = _nextMilestone();
    const prev     = ALL_NODES.map(n => n.xp).sort((a,b)=>a-b).filter(m => m <= curXp).pop() ?? 0;
    const range    = Math.max(1, next - prev);
    const pct      = Math.min(100, Math.round(((curXp - prev) / range) * 100));

    _setText("stXpNum",  `${curXp.toLocaleString()} XP`);
    _setText("stXpNext", curXp >= next ? "Max tier reached 🌟" : `→ ${(next - curXp).toLocaleString()} XP to next unlock`);
    _setWidth("stXpFill", pct);
    _setWidth("stXpGlow", pct);
  }

  function _renderBranchTabs() {
    const container = document.getElementById("stBranchTabs");
    if (!container) return;

    container.innerHTML = Object.entries(BRANCHES).map(([key, branch]) => {
      const total    = branch.nodes.length;
      const unlocked = branch.nodes.filter(n => _unlocked(n.id)).length;
      const active   = key === _activeBranch ? " st-tab-active" : "";
      return `
        <button class="st-tab${active}" role="tab" aria-selected="${key === _activeBranch}"
          onclick="ZenithSkillTree.switchBranch('${key}')"
          style="--branch-color:${branch.color}">
          <span class="st-tab-icon">${branch.icon}</span>
          <span class="st-tab-label">${branch.label}</span>
          <span class="st-tab-prog">${unlocked}/${total}</span>
        </button>`;
    }).join("");
  }

  function _renderNodes() {
    const panel  = document.getElementById("stNodesPanel");
    if (!panel) return;
    const branch = BRANCHES[_activeBranch];
    if (!branch) return;

    const curXp = _xp();

    const nodesHtml = branch.nodes.map((node, idx) => {
      const unlocked = _unlocked(node.id);
      const isNext   = !unlocked && (idx === 0 || _unlocked(branch.nodes[idx-1]?.id));
      const pct      = unlocked ? 100 : Math.min(100, Math.round((curXp / node.xp) * 100));
      const stateClass = unlocked ? "st-node-unlocked" : isNext ? "st-node-next" : "st-node-locked";

      /* SVG progress ring */
      const R    = 22, C = 2 * Math.PI * R;
      const dash = (pct / 100) * C;
      const ring = `<svg class="st-node-ring-svg" viewBox="0 0 52 52">
        <circle cx="26" cy="26" r="${R}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="4"/>
        <circle cx="26" cy="26" r="${R}" fill="none"
          stroke="${branch.color}" stroke-width="4"
          stroke-linecap="round"
          stroke-dasharray="${dash.toFixed(1)} ${C.toFixed(1)}"
          stroke-dashoffset="${(C/4).toFixed(1)}"
          style="transition:stroke-dasharray .9s cubic-bezier(.34,1.56,.64,1);opacity:${unlocked?1:0.55}"/>
      </svg>`;

      /* Connector line (between nodes) */
      const connector = idx < branch.nodes.length - 1
        ? `<div class="st-connector ${unlocked ? "st-connector-done" : ""}" style="--branch-color:${branch.color}"></div>`
        : "";

      return `
        <div class="${stateClass} st-node-wrap" data-nodeid="${node.id}">
          <div class="st-node-visual">
            <div class="st-node-ring-wrap" style="--branch-color:${branch.color}">
              ${ring}
              <span class="st-node-emoji">${node.icon}</span>
              ${unlocked ? `<span class="st-node-check" aria-label="Unlocked">✓</span>` : ""}
            </div>
            ${connector}
          </div>
          <div class="st-node-info">
            <div class="st-node-name" style="color:${unlocked ? branch.color : "inherit"}">${node.name}</div>
            <div class="st-node-desc">${node.desc}</div>
            <div class="st-node-perk">⚡ ${node.perk}</div>
            ${!unlocked ? `<div class="st-node-xp-need">${Math.max(0, node.xp - curXp).toLocaleString()} XP to unlock · ${pct}%</div>` : ""}
          </div>
        </div>`;
    }).join("");

    panel.innerHTML = `<div class="st-branch-header" style="color:${branch.color}">
      ${branch.icon} ${branch.label} Path
    </div>${nodesHtml}`;
  }

  function _renderPerksFeed() {
    const feed = document.getElementById("stPerksFeed");
    if (!feed) return;

    const active = ALL_NODES.filter(n => _unlocked(n.id));
    if (!active.length) {
      feed.innerHTML = `<div class="st-feed-empty">Unlock your first skill to activate perks.</div>`;
      return;
    }

    feed.innerHTML = `<div class="st-feed-title">Active Perks</div>` +
      active.map(n => `
        <div class="st-feed-row">
          <span class="st-feed-icon" style="color:${n.color}">${n.icon}</span>
          <span class="st-feed-name">${n.name}</span>
          <span class="st-feed-perk">⚡ ${n.perk}</span>
        </div>`).join("");
  }

  function _renderLegend() {
    const leg = document.getElementById("stLegend");
    if (!leg) return;

    const total    = ALL_NODES.length;
    const unlocked = ALL_NODES.filter(n => _unlocked(n.id)).length;
    const pct      = Math.round((unlocked / total) * 100);

    const tierLabel =
      pct >= 100 ? "Zenith Legend 🌟" :
      pct >= 75  ? "Elite Practitioner 🔥" :
      pct >= 50  ? "Deep Architect 🎯" :
      pct >= 25  ? "Pattern Reader 📖" :
                   "Apprentice 🌱";

    leg.innerHTML = `
      <div class="st-legend-row">
        <span class="st-legend-tier">${tierLabel}</span>
        <span class="st-legend-count">${unlocked}/${total} nodes · ${pct}%</span>
      </div>
      <div class="st-legend-track">
        <div class="st-legend-fill" style="width:${pct}%"></div>
      </div>`;
  }

  /* ── New unlock burst animation ── */
  let _knownUnlocked = new Set(window.unlockedSkills || []);

  function _checkNewUnlocks() {
    const current = new Set(window.unlockedSkills || []);
    current.forEach(id => {
      if (!_knownUnlocked.has(id)) {
        _knownUnlocked.add(id);
        const node = ALL_NODES.find(n => n.id === id);
        if (node) _burstAnimation(node);
      }
    });
    _knownUnlocked = current;
  }

  function _burstAnimation(node) {
    const el = document.querySelector(`[data-nodeid="${node.id}"] .st-node-ring-wrap`);
    if (!el) return;

    el.classList.add("st-burst");
    const label = document.createElement("div");
    label.className = "st-burst-label";
    label.textContent = `🌟 ${node.name} unlocked!`;
    label.style.color = node.color;
    el.appendChild(label);

    setTimeout(() => {
      el.classList.remove("st-burst");
      label.remove();
    }, 2000);
  }

  /* ── Public API ── */
  function switchBranch(branchKey) {
    _activeBranch = branchKey;
    _renderBranchTabs();
    _renderNodes();
  }

  /* Init on DOM ready */
  document.addEventListener("DOMContentLoaded", () => {
    render();

    /* Re-render when stats tab opens */
    const statsSection = document.getElementById("statsSection");
    if (statsSection) {
      new MutationObserver(() => {
        if (statsSection.classList.contains("active")) render();
      }).observe(statsSection, { attributes: true, attributeFilter: ["class"] });
    }

    /* Also hook updateSkillTree */
    window.updateSkillTree = () => render();
  });

  /* Helpers */
  function _setText(id, v)  { const el = document.getElementById(id); if (el) el.textContent = v; }
  function _setWidth(id, v) { const el = document.getElementById(id); if (el) el.style.width = v + "%"; }

  return { render, switchBranch };
})();

window.ZenithSkillTree = ZenithSkillTree;


/* ════════════════════════════════════════════════════════════
   ██████████████████████████████████████████
   #12  FOCUS STREAK VISUALIZATIONS
   ██████████████████████████████████████████
════════════════════════════════════════════════════════════ */

const ZenithStreakViz = (() => {

  const LS_KEY = "zenith_streak_viz_theme";

  const THEMES = ["flame", "neural", "zen", "galaxy"];
  let _theme   = localStorage.getItem(LS_KEY) || "flame";
  let _canvas  = null;
  let _ctx     = null;
  let _raf     = null;
  let _particles = [];
  let _frame   = 0;

  /* ── Helpers ── */
  function _streak()    { return window.streak ?? 0; }
  function _sessions()  { return Object.values(window.stats || {}).reduce((s,d)=>s+(d.sess||0),0); }
  function _accentHex() { return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#00e5c0"; }
  function _hexToRgb(h) {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
    return r ? { r:parseInt(r[1],16), g:parseInt(r[2],16), b:parseInt(r[3],16) } : { r:0,g:229,b:192 };
  }

  /* ── Inject container ── */
  function _ensureContainer() {
    if (document.getElementById("streakVizCard")) return;

    const grid = document.querySelector(".desktop-stats-grid") || document.getElementById("statsSection");
    if (!grid) return;

    const card = document.createElement("div");
    card.className = "card sv-card";
    card.id        = "streakVizCard";
    card.innerHTML = `
      <div class="card-label">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
          <path d="M12 6v6l4 2"/>
        </svg>
        Focus Streak
      </div>

      <!-- Streak stats row -->
      <div class="sv-stats-row">
        <div class="sv-stat">
          <div class="sv-stat-val" id="svStreakNum">0</div>
          <div class="sv-stat-lbl">Day Streak</div>
        </div>
        <div class="sv-stat">
          <div class="sv-stat-val" id="svSessionsNum">0</div>
          <div class="sv-stat-lbl">Total Sessions</div>
        </div>
        <div class="sv-stat">
          <div class="sv-stat-val" id="svTierLabel">—</div>
          <div class="sv-stat-lbl">Tier</div>
        </div>
      </div>

      <!-- Visualization canvas -->
      <div class="sv-canvas-wrap">
        <canvas id="svCanvas" class="sv-canvas" aria-label="Focus streak visualization" role="img"></canvas>
        <div class="sv-canvas-overlay" id="svCanvasOverlay"></div>
      </div>

      <!-- Theme switcher -->
      <div class="sv-theme-row" role="group" aria-label="Streak visualization theme">
        <button class="sv-theme-btn" data-theme="flame"  onclick="ZenithStreakViz.setTheme('flame')"  title="Flame">🔥 Flame</button>
        <button class="sv-theme-btn" data-theme="neural" onclick="ZenithStreakViz.setTheme('neural')" title="Neural">🧠 Neural</button>
        <button class="sv-theme-btn" data-theme="zen"    onclick="ZenithStreakViz.setTheme('zen')"    title="Zen Garden">🌿 Zen</button>
        <button class="sv-theme-btn" data-theme="galaxy" onclick="ZenithStreakViz.setTheme('galaxy')" title="Galaxy">🌌 Galaxy</button>
      </div>

      <!-- Streak milestone bar -->
      <div class="sv-milestones" id="svMilestones"></div>
    `;

    grid.appendChild(card);
  }

  /* ── Canvas setup ── */
  function _setupCanvas() {
    _canvas = document.getElementById("svCanvas");
    if (!_canvas) return false;
    _ctx    = _canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const W   = _canvas.parentElement.clientWidth || 320;
    const H   = 180;
    _canvas.width  = W * dpr;
    _canvas.height = H * dpr;
    _canvas.style.width  = W + "px";
    _canvas.style.height = H + "px";
    _ctx.scale(dpr, dpr);
    return true;
  }

  /* ═══════════════
     THEME: FLAME
  ═══════════════ */
  function _initFlame() {
    _particles = [];
    const s  = _streak();
    const count = Math.min(80, 15 + s * 2);
    const W  = _canvas.width  / (window.devicePixelRatio || 1);
    const H  = _canvas.height / (window.devicePixelRatio || 1);

    for (let i = 0; i < count; i++) {
      _particles.push({
        x:   W / 2 + (Math.random() - 0.5) * W * 0.6,
        y:   H + Math.random() * 20,
        vx:  (Math.random() - 0.5) * 0.6,
        vy:  -(1.5 + Math.random() * 2.5),
        life: Math.random(),
        maxLife: 0.5 + Math.random() * 0.5,
        size: 3 + Math.random() * (s > 7 ? 8 : 5),
        hue:  Math.random() < 0.5 ? 30 : 15,
      });
    }
  }

  function _drawFlame() {
    const W   = _canvas.width  / (window.devicePixelRatio || 1);
    const H   = _canvas.height / (window.devicePixelRatio || 1);
    const s   = _streak();
    const ctx = _ctx;

    ctx.clearRect(0, 0, W, H);

    /* Glow base */
    const grad = ctx.createRadialGradient(W/2, H, 0, W/2, H, W * 0.5);
    grad.addColorStop(0, s > 7 ? "rgba(245,158,11,0.18)" : "rgba(239,68,68,0.12)");
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    /* Particles */
    _particles.forEach(p => {
      p.x    += p.vx + Math.sin(_frame * 0.04 + p.y * 0.05) * 0.4;
      p.y    += p.vy;
      p.life -= 0.012;
      p.vy   -= 0.03;      // accelerates upward

      if (p.life <= 0 || p.y < -10) {
        /* Respawn */
        p.x    = W/2 + (Math.random()-0.5) * W * 0.55;
        p.y    = H + 5;
        p.vy   = -(1.5 + Math.random() * 2.5);
        p.vx   = (Math.random()-0.5) * 0.6;
        p.life = p.maxLife;
      }

      const alpha = Math.max(0, p.life / p.maxLife);
      const size  = p.size * alpha;
      const hue   = p.hue + (1 - alpha) * 20;   // drift toward yellow

      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${hue},100%,${50 + alpha*20}%,${alpha * 0.9})`;
      ctx.fill();
    });

    /* Streak number floating */
    if (s > 0) {
      ctx.save();
      ctx.globalAlpha = 0.18 + Math.sin(_frame * 0.05) * 0.05;
      ctx.font = `bold ${Math.min(90, 40 + s * 3)}px sans-serif`;
      ctx.textAlign   = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle   = "#fff";
      ctx.fillText(`🔥 ${s}`, W/2, H/2);
      ctx.restore();
    }
  }

  /* ═══════════════
     THEME: NEURAL
  ═══════════════ */
  let _neuralNodes = [];

  function _initNeural() {
    _neuralNodes = [];
    const total = Math.min(60, _sessions() + 1);
    const W = _canvas.width  / (window.devicePixelRatio || 1);
    const H = _canvas.height / (window.devicePixelRatio || 1);
    const cx = W / 2, cy = H / 2;

    for (let i = 0; i < total; i++) {
      const angle  = (i / total) * Math.PI * 2;
      const radius = 30 + Math.random() * (W * 0.35);
      _neuralNodes.push({
        x:     cx + Math.cos(angle) * radius * (0.4 + Math.random() * 0.6),
        y:     cy + Math.sin(angle) * radius * (0.4 + Math.random() * 0.6),
        vx:    (Math.random()-0.5) * 0.25,
        vy:    (Math.random()-0.5) * 0.25,
        r:     2 + Math.random() * 3,
        born:  i,
        pulse: Math.random() * Math.PI * 2,
      });
    }
  }

  function _drawNeural() {
    const W   = _canvas.width  / (window.devicePixelRatio || 1);
    const H   = _canvas.height / (window.devicePixelRatio || 1);
    const ctx = _ctx;
    const acc = _accentHex();
    const rgb = _hexToRgb(acc);
    const s   = _streak();

    ctx.clearRect(0, 0, W, H);

    /* Slowly drift nodes */
    _neuralNodes.forEach(n => {
      n.x += n.vx; n.y += n.vy;
      if (n.x < 4 || n.x > W-4) n.vx *= -1;
      if (n.y < 4 || n.y > H-4) n.vy *= -1;
      n.pulse += 0.04;
    });

    /* Draw edges between nearby nodes */
    const threshold = 80;
    for (let i = 0; i < _neuralNodes.length; i++) {
      for (let j = i+1; j < _neuralNodes.length; j++) {
        const a = _neuralNodes[i], b = _neuralNodes[j];
        const dx = a.x-b.x, dy = a.y-b.y;
        const dist = Math.sqrt(dx*dx+dy*dy);
        if (dist < threshold) {
          const alpha = (1 - dist / threshold) * 0.4;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
          ctx.lineWidth   = 0.8;
          ctx.stroke();
        }
      }
    }

    /* Draw nodes */
    _neuralNodes.forEach(n => {
      const pulse = 0.7 + Math.sin(n.pulse + _frame * 0.02) * 0.3;
      const isActive = n.born < s;   // nodes born < streak glow brighter
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * pulse, 0, Math.PI * 2);
      ctx.fillStyle = isActive
        ? `rgba(${rgb.r},${rgb.g},${rgb.b},0.9)`
        : `rgba(${rgb.r},${rgb.g},${rgb.b},0.3)`;
      ctx.fill();
    });

    /* Center label */
    ctx.save();
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign   = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle   = `rgba(${rgb.r},${rgb.g},${rgb.b},0.7)`;
    ctx.fillText(`${_sessions()} sessions`, W/2, H/2);
    ctx.restore();
  }

  /* ═══════════════
     THEME: ZEN
  ═══════════════ */
  function _drawZen() {
    const W   = _canvas.width  / (window.devicePixelRatio || 1);
    const H   = _canvas.height / (window.devicePixelRatio || 1);
    const ctx = _ctx;
    const s   = _streak();
    const cx  = W / 2, cy = H / 2;
    const acc = _accentHex();
    const rgb = _hexToRgb(acc);

    ctx.clearRect(0, 0, W, H);

    /* Sand base */
    ctx.fillStyle = "rgba(255,255,255,0.02)";
    ctx.fillRect(0, 0, W, H);

    /* Rings — more rings = higher streak */
    const rings  = Math.min(12, 3 + s);
    const maxR   = Math.min(cx, cy) * 0.9;
    const breathe = Math.sin(_frame * 0.025) * 3;

    for (let i = 1; i <= rings; i++) {
      const r     = (i / rings) * maxR + breathe;
      const alpha = 0.06 + (i / rings) * 0.18;
      const lw    = i % 3 === 0 ? 1.5 : 0.7;

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
      ctx.lineWidth   = lw;
      ctx.stroke();
    }

    /* Petal spokes — rotated slowly */
    const spokes = Math.min(16, 4 + s);
    const rot    = _frame * 0.003;

    for (let i = 0; i < spokes; i++) {
      const angle = (i / spokes) * Math.PI * 2 + rot;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR);
      ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.07)`;
      ctx.lineWidth   = 0.8;
      ctx.stroke();
    }

    /* Petal arcs */
    for (let i = 0; i < spokes; i++) {
      const a1 = (i / spokes) * Math.PI * 2 + rot;
      const a2 = ((i+1) / spokes) * Math.PI * 2 + rot;
      const r  = maxR * 0.6;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a1, a2);
      ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.15)`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    /* Centre gem */
    ctx.beginPath();
    ctx.arc(cx, cy, 6 + breathe * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.7)`;
    ctx.fill();

    /* Streak text */
    ctx.save();
    ctx.font = "12px sans-serif";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle    = `rgba(${rgb.r},${rgb.g},${rgb.b},0.5)`;
    ctx.fillText(s > 0 ? `${s} days` : "begin", cx, cy + maxR * 0.75);
    ctx.restore();
  }

  /* ═══════════════
     THEME: GALAXY
  ═══════════════ */
  let _stars = [];

  function _initGalaxy() {
    _stars = [];
    const total = Math.min(120, 20 + _streak() * 3 + _sessions());
    const W = _canvas.width  / (window.devicePixelRatio || 1);
    const H = _canvas.height / (window.devicePixelRatio || 1);

    for (let i = 0; i < total; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r     = 10 + Math.pow(Math.random(), 0.5) * (Math.min(W, H) * 0.45);
      _stars.push({
        x:     W/2 + Math.cos(angle) * r,
        y:     H/2 + Math.sin(angle) * r,
        r:     0.5 + Math.random() * 2.5,
        twinkle: Math.random() * Math.PI * 2,
        speed:   0.03 + Math.random() * 0.04,
        orbitR:  r,
        orbitA:  angle,
        orbitSpeed: (Math.random()-0.5) * 0.003,
      });
    }
  }

  function _drawGalaxy() {
    const W   = _canvas.width  / (window.devicePixelRatio || 1);
    const H   = _canvas.height / (window.devicePixelRatio || 1);
    const ctx = _ctx;
    const s   = _streak();
    const acc = _accentHex();
    const rgb = _hexToRgb(acc);

    ctx.clearRect(0, 0, W, H);

    /* Nebula core */
    const core = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, W * 0.4);
    core.addColorStop(0,   `rgba(${rgb.r},${rgb.g},${rgb.b},0.08)`);
    core.addColorStop(0.5, `rgba(79,156,249,0.04)`);
    core.addColorStop(1,   "transparent");
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, W, H);

    /* Stars orbit slowly */
    _stars.forEach(st => {
      st.orbitA  += st.orbitSpeed;
      st.x        = W/2 + Math.cos(st.orbitA) * st.orbitR;
      st.y        = H/2 + Math.sin(st.orbitA) * st.orbitR;
      st.twinkle += st.speed;

      const alpha = 0.4 + Math.sin(st.twinkle) * 0.4;
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
      ctx.fill();
    });

    /* Constellation lines for streak milestones */
    const lined = Math.min(_stars.length, s * 2);
    for (let i = 0; i < lined - 1; i++) {
      const a = _stars[i], b = _stars[i+1];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.12)`;
      ctx.lineWidth   = 0.6;
      ctx.stroke();
    }

    /* Streak label */
    ctx.save();
    ctx.font = `bold 28px sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle    = `rgba(${rgb.r},${rgb.g},${rgb.b},0.2)`;
    ctx.fillText(`${_streak()} 🌌`, W/2, H/2);
    ctx.restore();
  }

  /* ── Animation loop ── */
  function _loop() {
    _frame++;
    if (!_ctx) { _raf = requestAnimationFrame(_loop); return; }

    if      (_theme === "flame")  _drawFlame();
    else if (_theme === "neural") _drawNeural();
    else if (_theme === "zen")    _drawZen();
    else if (_theme === "galaxy") _drawGalaxy();

    _raf = requestAnimationFrame(_loop);
  }

  /* ── Stats row ── */
  function _renderStats() {
    const s   = _streak();
    const ses = _sessions();
    const tier =
      s >= 30 ? "Legend 🌟" :
      s >= 14 ? "Elite 🔥" :
      s >= 7  ? "Strong 💪" :
      s >= 3  ? "Building 📈" : "Starting 🌱";

    const el1 = document.getElementById("svStreakNum");
    const el2 = document.getElementById("svSessionsNum");
    const el3 = document.getElementById("svTierLabel");
    if (el1) el1.textContent = s;
    if (el2) el2.textContent = ses;
    if (el3) el3.textContent = tier;
  }

  /* ── Milestone bar ── */
  function _renderMilestones() {
    const el = document.getElementById("svMilestones");
    if (!el) return;
    const s = _streak();
    const milestones = [1, 3, 7, 14, 21, 30, 60, 100];
    el.innerHTML = milestones.map(m => {
      const done = s >= m;
      return `<div class="sv-ms ${done ? "sv-ms-done" : ""}" title="${m} days${done?" ✓":""}">
        <div class="sv-ms-dot"></div>
        <div class="sv-ms-lbl">${m}d</div>
      </div>`;
    }).join("");
  }

  /* ── Theme switcher UI ── */
  function _syncThemeButtons() {
    document.querySelectorAll(".sv-theme-btn").forEach(btn => {
      btn.classList.toggle("sv-theme-active", btn.dataset.theme === _theme);
    });
  }

  /* ── Public API ── */
  function setTheme(t) {
    _theme = t;
    localStorage.setItem(LS_KEY, t);
    _syncThemeButtons();
    _resetForTheme();
  }

  function _resetForTheme() {
    if      (_theme === "flame")  _initFlame();
    else if (_theme === "neural") _initNeural();
    else if (_theme === "galaxy") _initGalaxy();
    /* zen needs no init */
  }

  function render() {
    _ensureContainer();

    const ready = _canvas ? true : _setupCanvas();
    if (!ready) return;

    _renderStats();
    _renderMilestones();
    _syncThemeButtons();

    if (!_raf) {
      _resetForTheme();
      _loop();
    }
  }

  /* ── Init ── */document.addEventListener("DOMContentLoaded", () => {
  // Only render (and start the loop) if stats is already the active section.
  // Avoids burning RAF on a section the user hasn't opened yet.
  const statsSection = document.getElementById("statsSection");

  if (statsSection?.classList.contains("active")) {
    render();
  } else {
    // Inject the card shell so the DOM is ready, but don't loop yet.
    _ensureContainer();
    _renderStats();
    _renderMilestones();
    _syncThemeButtons();
  }

  /* Pause loop when tab is backgrounded */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(_raf);
      _raf = null;
    } else if (statsSection?.classList.contains("active")) {
      // Cancel any stale loop before starting a fresh one
      cancelAnimationFrame(_raf);
      _raf = null;
      _resetForTheme();
      _loop();
    }
  });

  /* Re-render when stats tab opens; STOP loop when it closes */
  if (statsSection) {
    new MutationObserver(() => {
      if (statsSection.classList.contains("active")) {
        // Always cancel first to prevent duplicate loops
        cancelAnimationFrame(_raf);
        _raf = null;
        _setupCanvas();
        _resetForTheme();
        _loop();
        _renderStats();
        _renderMilestones();
      } else {
        // Stats tab closed — kill the loop immediately
        cancelAnimationFrame(_raf);
        _raf = null;
      }
    }).observe(statsSection, { attributes: true, attributeFilter: ["class"] });
  }

  /* Re-init on resize only when stats is visible */
  window.addEventListener("resize", () => {
    if (!statsSection?.classList.contains("active")) return;
    // Cancel loop before re-initialising canvas dimensions
    cancelAnimationFrame(_raf);
    _raf = null;
    _setupCanvas();
    _resetForTheme();
    _loop();
  });

  /* Re-render stat numbers after each session */
  const origUpdateUI = window.updateUI;
  if (typeof origUpdateUI === "function") {
    window.updateUI = function (...args) {
      origUpdateUI.apply(this, args);
      _renderStats();
      _renderMilestones();
    };
  }
});

  return { render, setTheme };
})();

window.ZenithStreakViz = ZenithStreakViz;