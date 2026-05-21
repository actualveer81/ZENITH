/* ═══════════════════════════════════════════════════════════════
   ZENITH — AI Focus Coach  (#6)
   ─────────────────────────────────────────────────────────────
   Uses Claude API to generate personalized session strategy
   grounded in the user's actual behavioral data.

   Requires:
     · analytics-engine.js loaded first (window.ZenithAnalytics)
     · User to enter their Anthropic API key in Settings
     · CSP update: connect-src must include https://api.anthropic.com
═══════════════════════════════════════════════════════════════ */
"use strict";

const ZenithAICoach = (() => {

  const API_KEY_STORAGE = "zenith_coach_api_key";
  const MODEL           = "claude-sonnet-4-20250514";
  const MAX_TOKENS      = 350;

  /* ── API key management ── */
  function getApiKey()    { return localStorage.getItem(API_KEY_STORAGE) || ""; }
  function saveApiKey(k)  { localStorage.setItem(API_KEY_STORAGE, k.trim()); }
  function clearApiKey()  { localStorage.removeItem(API_KEY_STORAGE); }
  function hasApiKey()    { return !!getApiKey(); }

  /* ── Build the analytics context string ── */
  function buildContext(report) {
    const now = new Date();
    const {
      totalSessions = 0,
      burnoutRisk   = { level: "low", score: 0 },
      consistencyIndex = { score: 0, activeDays: 0 },
      sessionVelocity  = { direction: "stable", pct: 0 },
      recoveryEfficiency = { score: null, avgMinutes: null },
      bestHourWindow   = null,
      peakDayOfWeek    = null,
      preferredMode    = null,
    } = report;

    const timeStr = now.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
    const dayStr  = now.toLocaleDateString("en", { weekday: "long" });

    return [
      `Current time: ${timeStr} (${dayStr})`,
      `Total sessions ever: ${totalSessions}`,
      ``,
      `BURNOUT RISK: ${burnoutRisk.level.toUpperCase()} (score ${burnoutRisk.score}/100)`,
      burnoutRisk.flags?.length ? `  Signals: ${burnoutRisk.flags.join(", ")}` : "",
      ``,
      `CONSISTENCY: ${consistencyIndex.score}/100 — ${consistencyIndex.activeDays} active days in last 21`,
      `SESSION VELOCITY: ${sessionVelocity.direction}`,
      sessionVelocity.pct !== 0 ? `  Change: ${sessionVelocity.pct > 0 ? "+" : ""}${sessionVelocity.pct}% vs last week` : "",
      ``,
      bestHourWindow ? `PEAK FOCUS WINDOW: ${bestHourWindow.label} (${bestHourWindow.confidence}% of sessions)` : "PEAK FOCUS WINDOW: insufficient data",
      peakDayOfWeek  ? `STRONGEST DAY: ${peakDayOfWeek.dayName}` : "",
      preferredMode  ? `PREFERRED MODE: ${preferredMode.mode} (${preferredMode.count} sessions)` : "",
      ``,
      recoveryEfficiency.score
        ? `RECOVERY EFFICIENCY: ${recoveryEfficiency.score}/100 (avg ${recoveryEfficiency.avgMinutes} min to restart)`
        : "RECOVERY EFFICIENCY: no data yet",
    ].filter(Boolean).join("\n");
  }

  /* ── System prompt for the coach ── */
  const SYSTEM_PROMPT = `You are ZENITH's AI Focus Coach — a sharp, direct, data-driven cognitive performance advisor.

Your role: analyze the user's real behavioral data and give a concise, specific strategy for TODAY.

Rules:
- Under 90 words total.
- Start with the single most important insight (burnout warning, peak window, momentum note — whatever the data demands).
- End with one concrete action: a specific session mode, duration, or schedule tweak.
- Never be generic. Every sentence must reference something from the data.
- Tone: direct, supportive, like a trusted coach — not a chatbot.
- Do NOT use bullet points. Plain prose only.`;

  /* ── Streaming Claude API call ── */
  async function fetchAdvice(onChunk, onDone, onError) {
    const apiKey = getApiKey();
    if (!apiKey) { onError("no_key"); return; }

    const report = window.ZenithAnalytics?.compute();
    if (!report || report.insufficient) { onError("no_data"); return; }

    const userMessage = `Here is my behavioral data:\n\n${buildContext(report)}\n\nGive me my focus strategy for today.`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type":                        "application/json",
          "x-api-key":                           apiKey,
          "anthropic-version":                   "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model:      MODEL,
          max_tokens: MAX_TOKENS,
          stream:     true,
          system:     SYSTEM_PROMPT,
          messages:   [{ role: "user", content: userMessage }],
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        onError(err?.error?.type || `http_${res.status}`);
        return;
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") { onDone(); return; }
          try {
            const evt = JSON.parse(data);
            if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
              onChunk(evt.delta.text);
            }
            if (evt.type === "message_stop") { onDone(); return; }
          } catch { /* skip malformed SSE */ }
        }
      }
      onDone();
    } catch (err) {
      onError(err.message?.includes("fetch") ? "network" : "unknown");
    }
  }

  /* ── Render coach card ── */
  function render() {
    const card = document.getElementById("coachCard");
    if (!card) return;

    if (!hasApiKey()) {
      _showSetup(card);
    } else {
      _showCoach(card);
    }
  }

  function _showSetup(card) {
    const body = card.querySelector(".coach-body");
    if (!body) return;
    body.innerHTML = `
      <p class="coach-setup-text">
        Connect your Anthropic API key to unlock personalized daily focus strategy 
        grounded in your behavioral data.
      </p>
      <div class="coach-key-row">
        <input type="password" id="coachApiInput" class="coach-api-input"
               placeholder="sk-ant-..." autocomplete="off" spellcheck="false"/>
        <button class="coach-connect-btn" onclick="ZenithAICoach.connectKey()">Connect</button>
      </div>
      <p class="coach-setup-hint">Your key is stored locally and never leaves your device.</p>
    `;
  }

  function _showCoach(card) {
    const body = card.querySelector(".coach-body");
    if (!body) return;
    body.innerHTML = `
      <div id="coachOutput" class="coach-output coach-idle">
        <span class="coach-idle-text">Ready to analyze your behavioral data.</span>
      </div>
      <div class="coach-actions">
        <button class="coach-generate-btn" id="coachGenBtn" onclick="ZenithAICoach.generate()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          Get Today's Strategy
        </button>
        <button class="coach-disconnect-btn" onclick="ZenithAICoach.disconnect()" title="Remove API key">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="coach-last-updated" id="coachTimestamp"></div>
    `;
  }

  /* ── Public API ── */
  function connectKey() {
    const input = document.getElementById("coachApiInput");
    const key   = input?.value.trim();
    if (!key || !key.startsWith("sk-")) {
      _showCoachError("Enter a valid Anthropic API key (starts with sk-).");
      return;
    }
    saveApiKey(key);
    render();
  }

  function disconnect() {
    clearApiKey();
    render();
  }

  function generate() {
    const output  = document.getElementById("coachOutput");
    const btn     = document.getElementById("coachGenBtn");
    if (!output || !btn) return;

    /* Loading state */
    btn.disabled  = true;
    output.className = "coach-output coach-streaming";
    output.innerHTML = `<span class="coach-cursor-blink">Analyzing your behavioral data</span>`;

    let fullText = "";

    fetchAdvice(
      /* onChunk */ (text) => {
        fullText += text;
        output.textContent = fullText;
        output.className = "coach-output coach-streaming";
      },
      /* onDone */ () => {
        output.className = "coach-output coach-done";
        btn.disabled     = false;
        const ts = document.getElementById("coachTimestamp");
        if (ts) ts.textContent = `Generated ${new Date().toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}`;
      },
      /* onError */ (type) => {
        output.className = "coach-output coach-error";
        output.textContent = _errorMessage(type);
        btn.disabled = false;
      }
    );
  }

  function _showCoachError(msg) {
    const existing = document.querySelector(".coach-key-error");
    if (existing) existing.remove();
    const el = document.createElement("p");
    el.className = "coach-key-error";
    el.textContent = msg;
    document.getElementById("coachApiInput")?.after(el);
  }

  function _errorMessage(type) {
    const map = {
      no_key:       "No API key found. Please reconnect.",
      no_data:      "Complete at least 5 focus sessions to unlock coaching.",
      network:      "Network error. Check your connection and try again.",
      authentication_error: "Invalid API key. Please reconnect with a valid key.",
      rate_limit_error:     "Rate limit hit — try again in a moment.",
    };
    return map[type] || `Error: ${type}. Check browser console for details.`;
  }

  /* Init on DOM ready */
  document.addEventListener("DOMContentLoaded", render);

  return { render, connectKey, disconnect, generate, hasApiKey };
})();

window.ZenithAICoach = ZenithAICoach;
