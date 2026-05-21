/* ═══════════════════════════════════════════════════════════════
   ZENITH — Focus Music AI  (#19)
   ─────────────────────────────────────────────────────────────
   Procedurally generates audio using the Web Audio API.
   No MP3 files. Everything computed in real-time and adapted
   to session mode, intensity, and behavioral data.

   FOUR GENERATORS:
     neural   — binaural beats + ambient drone + pink texture
     binaural — stereo psychoacoustic beat frequencies
     rain     — filtered noise with natural variation
     drone    — harmonic oscillator pad with LFO breathing

   ADAPTIVE PARAMETERS (update every 30 s):
     · session intensity (0→1 as session progresses)
     · burnout risk (from ZenithAnalytics cache)
     · focus mode (standard · sprint · deep · creative · recovery · burnout)

   Beat frequencies by mode:
     deep/standard → Beta  18 Hz  (focused sustained attention)
     sprint        → Gamma 38 Hz  (peak performance, heightened alertness)
     creative      → Alpha 10 Hz  (relaxed, divergent thinking)
     recovery      → Theta  7 Hz  (light relaxation, mind-wandering)
     burnout       → Theta  5 Hz  (deep calm, stress reduction)
═══════════════════════════════════════════════════════════════ */
"use strict";

/* IIFE wrapper: class stays private; window.ZenithMusicAI is always the instance. */
(function () {

class ZenithMusicAI {

  constructor() {
    this.ctx          = null;       // AudioContext — created on first user gesture
    this.masterGain   = null;       // GainNode at end of chain
    this.activeType   = null;       // current generator: null | 'neural' | 'binaural' | 'rain' | 'drone'
    this.nodes        = [];         // all disposable nodes — cleared on stop()
    this.sources      = [];         // all BufferSource / Oscillator nodes (need .stop())
    this.intensityTimer = null;     // setInterval handle
    this.sessionIntensity = 0;      // 0.0 → 1.0
    this.targetVolume = 0.65;       // master output (sync'd with appVolume)
    this._isTransitioning = false;
  }

  /* ════════════════════════════════════════════
     INIT — must run inside a user gesture
  ════════════════════════════════════════════ */
  _ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0; // start silent, fade in
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  /* ════════════════════════════════════════════
     PUBLIC API
  ════════════════════════════════════════════ */

  /** Play a generator. Stops any current generator first. */
  play(type) {
    if (this._isTransitioning) return;
    this._ensureContext();

    if (this.activeType === type) { this.stop(); return; } // toggle off

    this._fadeOut(() => {
      this._stopAllNodes();
      this.activeType = type;
      this._startIntensityTracking();

      switch (type) {
        case "neural":   this._buildNeural();   break;
        case "binaural": this._buildBinaural(); break;
        case "rain":     this._buildRain();     break;
        case "drone":    this._buildDrone();    break;
      }

      this._fadeIn();
      this._updateUI();
    });
  }

  /** Graceful stop */
  stop() {
    this._fadeOut(() => {
      this._stopAllNodes();
      this.activeType = null;
      this._stopIntensityTracking();
      this._updateUI();
    });
  }

  /** Set master volume (0-1), synced with appVolume */
  setVolume(v) {
    this.targetVolume = Math.max(0, Math.min(1, v));
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.targetVolume, this.ctx.currentTime, 0.1);
    }
  }

  /** Called when session focus mode changes — updates frequencies */
  onModeChange(mode) {
    if (!this.activeType || !this.ctx) return;
    this._updateIntensityParams();
  }

  /* ════════════════════════════════════════════
     GENERATOR: NEURAL SOUNDSCAPE
     binaural beats + harmonic drone + pink noise
  ════════════════════════════════════════════ */
_buildNeural() {
  const ctx  = this.ctx;
  const mode = window.activeMode ?? "standard";

  const binauralGain = this._gain(0.55);
  const droneGain    = this._gain(0.30);
  const noiseGain    = this._gain(0.10);

  this.masterGain.disconnect();
  binauralGain.connect(this.masterGain);
  droneGain.connect(this.masterGain);    // FIX: was missing — drone was generated but never heard
  noiseGain.connect(this.masterGain);
  this.masterGain.connect(ctx.destination);

  this._buildBinauralLayer(binauralGain, mode);
  this._buildDroneLayer(droneGain, mode);
  this._buildPinkNoiseLayer(noiseGain);
  this._buildSpatialShimmer(droneGain);   // adds spatial panning on top of the drone
}

  /* ════════════════════════════════════════════
     GENERATOR: BINAURAL BEATS
     pure stereo psychoacoustic tones
  ════════════════════════════════════════════ */
  _buildBinaural() {
    const mode = window.activeMode ?? "standard";
    const gain = this._gain(0.7);
    gain.connect(this.masterGain);

    this._buildBinauralLayer(gain, mode);

    /* Low pink noise underlayer (prevents ear fatigue) */
    const noiseGain = this._gain(0.08);
    noiseGain.connect(this.masterGain);
    this._buildPinkNoiseLayer(noiseGain);
  }

  /* Shared binaural beat builder — used by both Neural and Binaural generators */
  _buildBinauralLayer(targetGain, mode) {
    const ctx       = this.ctx;
    const carrier   = 200;                   // carrier frequency Hz
    const beatFreq  = this._beatFreq(mode);  // difference between L/R
    const intensity = this.sessionIntensity;

    /* Slightly higher carrier = slightly more alert feeling */
    const carrierAdj = carrier + intensity * 8;

    /* Left ear oscillator */
    const leftOsc   = ctx.createOscillator();
    const leftPan   = ctx.createStereoPanner();
    leftOsc.type             = "sine";
    leftOsc.frequency.value  = carrierAdj;
    leftPan.pan.value        = -1;
    leftOsc.connect(leftPan);
    leftPan.connect(targetGain);
    leftOsc.start();

    /* Right ear oscillator (carrier + beat) */
    const rightOsc  = ctx.createOscillator();
    const rightPan  = ctx.createStereoPanner();
    rightOsc.type             = "sine";
    rightOsc.frequency.value  = carrierAdj + beatFreq;
    rightPan.pan.value        = 1;
    rightOsc.connect(rightPan);
    rightPan.connect(targetGain);
    rightOsc.start();

    this.sources.push(leftOsc, rightOsc);
    this.nodes.push(leftPan, rightPan);

    /* Store refs for adaptive updates */
    this._leftOsc  = leftOsc;
    this._rightOsc = rightOsc;
    this._carrier  = carrierAdj;
  }

  /* ════════════════════════════════════════════
     GENERATOR: GENERATIVE RAIN
     layered filtered noise — no MP3 needed
  ════════════════════════════════════════════ */
  _buildRain() {
    const ctx = this.ctx;

    /* Three noise layers: light drizzle, main rain, distant rumble */
    const layers = [
      { freq: 3200, Q: 0.4, gain: 0.35 },  // high sibilance (drizzle)
      { freq: 900,  Q: 0.5, gain: 0.55 },  // main rain body
      { freq: 200,  Q: 1.2, gain: 0.20 },  // low rumble
    ];

    layers.forEach(({ freq, Q, gain: gv }) => {
      const buf  = this._createNoiseBuffer(2);
      const src  = ctx.createBufferSource();
      const bp   = ctx.createBiquadFilter();
      const g    = this._gain(gv);

      src.buffer = buf;
      src.loop   = true;

      bp.type            = "bandpass";
      bp.frequency.value = freq;
      bp.Q.value         = Q;

      src.connect(bp);
      bp.connect(g);
      g.connect(this.masterGain);

      src.start();
      this.sources.push(src);
      this.nodes.push(bp, g);
    });

    /* Natural variation — slow amplitude LFO (gusts) */
    this._attachGustLFO(this.masterGain, 0.05, 0.12, 0.15);

    /* Store filter ref for intensity adaptation */
    this._rainFilters = this.nodes.filter(n => n instanceof BiquadFilterNode);
  }

  /* ════════════════════════════════════════════
     GENERATOR: AMBIENT DRONE
     harmonic oscillators with slow breathing LFO
  ════════════════════════════════════════════ */
  _buildDrone() {
    const mode = window.activeMode ?? "standard";
    const gain = this._gain(0.85);
    gain.connect(this.masterGain);

    this._buildDroneLayer(gain, mode);
  }

  /* Shared drone builder */
  _buildDroneLayer(targetGain, mode) {
    const ctx      = this.ctx;
    const freq     = this._droneFreq(mode);
    /* Overtone series: fundamental + 2nd + 3rd + 5th harmonic */
    const harmonics = [
      { mult: 1,   amp: 0.40 },
      { mult: 2,   amp: 0.22 },
      { mult: 3,   amp: 0.14 },
      { mult: 5,   amp: 0.08 },
      { mult: 0.5, amp: 0.10 }, // sub-harmonic warmth
    ];

    harmonics.forEach(({ mult, amp }) => {
      const osc  = ctx.createOscillator();
      const g    = this._gain(amp);
      osc.type             = "sine";
      osc.frequency.value  = freq * mult;
      osc.connect(g);
      g.connect(targetGain);
      osc.start();
      this.sources.push(osc);
      this.nodes.push(g);
    });

    /* Breathing LFO — 0.07 Hz = ~14s cycle */
    this._attachBreathLFO(targetGain, 0.07, 0.12, 0.12);

    /* Slight detune on one oscillator = natural chorusing */
    const chorus = ctx.createOscillator();
    const cg     = this._gain(0.08);
    chorus.type              = "sine";
    chorus.frequency.value   = freq * 1 + 1.2; // +1.2 Hz detune
    chorus.connect(cg);
    cg.connect(targetGain);
    chorus.start();
    this.sources.push(chorus);
    this.nodes.push(cg);

    this._droneFundamental = freq;
    this._droneOscillators = this.sources.slice(-harmonics.length - 1);
  }

  /* ════════════════════════════════════════════
     ADAPTIVE INTENSITY SYSTEM
  ════════════════════════════════════════════ */

  _startIntensityTracking() {
    this._stopIntensityTracking();
    this._updateIntensityParams(); // immediate
    this.intensityTimer = setInterval(() => this._updateIntensityParams(), 30_000);
  }

  _stopIntensityTracking() {
    if (this.intensityTimer) { clearInterval(this.intensityTimer); this.intensityTimer = null; }
  }

  _updateIntensityParams() {
    const total     = window.Session?.total     ?? 0;
    const remaining = window.Session?.remaining ?? 0;
    const elapsed   = total - remaining;

    /* 0 = just started, 1 = complete */
    this.sessionIntensity = total > 0 ? Math.min(1, elapsed / total) : 0;

    /* Factor in burnout risk: high burnout → reduce intensity */
    const burnout = this._getBurnoutLevel();
    if (burnout === "high")   this.sessionIntensity *= 0.55;
    if (burnout === "medium") this.sessionIntensity *= 0.75;

    this._applyIntensity();
  }

  _applyIntensity() {
    if (!this.ctx || !this.activeType) return;
    const t = this.ctx.currentTime;
    const i = this.sessionIntensity;
    const mode = window.activeMode ?? "standard";

    if (this.activeType === "binaural" || this.activeType === "neural") {
      /* Binaural: frequency rises slightly with intensity (more alert) */
      const newBeat = this._beatFreq(mode);
      if (this._leftOsc && this._rightOsc) {
        const carrierAdj = this._carrier + i * 8;
        this._leftOsc.frequency.setTargetAtTime(carrierAdj, t, 2);
        this._rightOsc.frequency.setTargetAtTime(carrierAdj + newBeat, t, 2);
      }
    }

    if (this.activeType === "rain") {
      /* Rain: bandpass freq rises with intensity (more sibilant = more energizing) */
      if (this._rainFilters?.[0]) {
        const newFreq = 900 + i * 600; // 900 Hz → 1500 Hz
        this._rainFilters[0].frequency.setTargetAtTime(newFreq, t, 4);
      }
    }

    this._renderIntensityBar();
  }

  /* ════════════════════════════════════════════
     HELPERS — oscillators, noise, LFOs
  ════════════════════════════════════════════ */

  _gain(value) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    this.nodes.push(g);
    return g;
  }

  _createNoiseBuffer(durationSecs) {
    const sr  = this.ctx.sampleRate;
    const len = Math.floor(sr * durationSecs);
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
    /* Pink noise approximation (Paul Kellet's algorithm) */
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886*b0 + w*0.0555179; b1 = 0.99332*b1 + w*0.0750759;
      b2 = 0.96900*b2 + w*0.1538520; b3 = 0.86650*b3 + w*0.3104856;
      b4 = 0.55000*b4 + w*0.5329522; b5 = -0.7616*b5 - w*0.0168980;
      data[i] = (b0+b1+b2+b3+b4+b5+b6 + w*0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  }

  _buildPinkNoiseLayer(targetGain) {
    const buf = this._createNoiseBuffer(3);
    const src = this.ctx.createBufferSource();
    const lp  = this.ctx.createBiquadFilter();
    lp.type            = "lowpass";
    lp.frequency.value = 400;
    src.buffer = buf;
    src.loop   = true;
    src.connect(lp);
    lp.connect(targetGain);
    src.start();
    this.sources.push(src);
    this.nodes.push(lp);
  }

  _attachBreathLFO(target, rate, depth, offset) {
    const lfo  = this.ctx.createOscillator();
    const lfoG = this.ctx.createGain();
    lfo.type             = "sine";
    lfo.frequency.value  = rate;
    lfoG.gain.value      = depth;
    lfo.connect(lfoG);
    lfoG.connect(target.gain);
    target.gain.value    = offset;
    lfo.start();
    this.sources.push(lfo);
    this.nodes.push(lfoG);
  }

  _attachGustLFO(target, rate, depth, offset) {
    /* Uses a second, slightly faster LFO multiplied on the first for irregular gusts */
    const lfo1  = this.ctx.createOscillator();
    const lfo2  = this.ctx.createOscillator();
    const lfoG1 = this.ctx.createGain();
    const lfoG2 = this.ctx.createGain();

    lfo1.type = lfo2.type = "sine";
    lfo1.frequency.value = rate;
    lfo2.frequency.value = rate * 3.7; // prime ratio → irregular pattern
    lfoG1.gain.value = depth;
    lfoG2.gain.value = depth * 0.4;

    lfo1.connect(lfoG1); lfoG1.connect(target.gain);
    lfo2.connect(lfoG2); lfoG2.connect(target.gain);
    target.gain.value = offset;

    lfo1.start(); lfo2.start();
    this.sources.push(lfo1, lfo2);
    this.nodes.push(lfoG1, lfoG2);
  }

  _buildSpatialShimmer(targetGain) {
    /* Very slow stereo width modulation — makes sound feel alive.
       Routes through masterGain so volume/fade control works correctly. */
    const lfo  = this.ctx.createOscillator();
    const lfoG = this.ctx.createGain();
    const pan  = this.ctx.createStereoPanner();
    lfo.type             = "sine";
    lfo.frequency.value  = 0.04; // 25-second cycle
    lfoG.gain.value      = 0.3;
    pan.pan.value        = 0;
    lfo.connect(lfoG);
    lfoG.connect(pan.pan);           // LFO modulates pan position
    targetGain.connect(pan);         // drone signal → panner
    pan.connect(this.masterGain);    // FIX: route through masterGain, not destination
    lfo.start();
    this.sources.push(lfo);
    this.nodes.push(lfoG, pan);
  }

  /* ════════════════════════════════════════════
     LOOKUP TABLES
  ════════════════════════════════════════════ */

  _beatFreq(mode) {
    const FREQS = {
      deep:     18,   // Beta — sustained focus
      standard: 16,   // Low Beta — alert
      sprint:   38,   // Gamma — peak performance
      creative: 10,   // Alpha — open, divergent
      recovery:  7,   // Theta — calm, restorative
      burnout:   5,   // Low Theta — deep calm
    };
    return FREQS[mode] ?? 16;
  }

  _droneFreq(mode) {
    const FREQS = {
      deep:     110,  // A2 — grounding, anchored
      standard: 131,  // C3 — neutral, clear
      sprint:   147,  // D3 — energizing, forward
      creative:  82,  // E2 — warm, open
      recovery:  87,  // F2 — soothing, gentle
      burnout:   65,  // C2 — very low, calming
    };
    return FREQS[mode] ?? 131;
  }

  _getBurnoutLevel() {
    try {
      const cache = JSON.parse(localStorage.getItem("zenith_intelligence_v1") || "{}");
      return cache.burnoutRisk?.level ?? "low";
    } catch { return "low"; }
  }

  /* ════════════════════════════════════════════
     FADE IN / OUT (prevents audio clicks)
  ════════════════════════════════════════════ */

  _fadeIn(duration = 1.5) {
    if (!this.masterGain) return;
    const t = this.ctx.currentTime;
    this.masterGain.gain.setValueAtTime(0.001, t);
    this.masterGain.gain.exponentialRampToValueAtTime(this.targetVolume, t + duration);
  }

  _fadeOut(onDone, duration = 0.8) {
    if (!this.masterGain || !this.ctx) { onDone?.(); return; }
    this._isTransitioning = true;
    const t = this.ctx.currentTime;
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value || 0.001, t);
    this.masterGain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    setTimeout(() => {
      this._isTransitioning = false;
      onDone?.();
    }, duration * 1000 + 50);
  }

  /* ════════════════════════════════════════════
     NODE CLEANUP
  ════════════════════════════════════════════ */

  _stopAllNodes() {
    const t = this.ctx?.currentTime ?? 0;
    this.sources.forEach(s => { try { s.stop(t); } catch { /* already stopped */ } });
    this.nodes.forEach(n => { try { n.disconnect(); } catch { /* already disconnected */ } });

    /* Rebuild master gain */
    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain.gain.value = 0;
      this.masterGain.connect(this.ctx.destination);
    }

    this.sources = [];
    this.nodes   = [];
    this._leftOsc = this._rightOsc = null;
    this._rainFilters = null;
    this._droneOscillators = null;
  }

  /* ════════════════════════════════════════════
     UI SYNC
  ════════════════════════════════════════════ */

  _updateUI() {
    /* Update all buttons */
    const types = ["neural", "binaural", "rain", "drone"];
    types.forEach(t => {
      const btn = document.getElementById(`mai-btn-${t}`);
      if (btn) btn.classList.toggle("mai-active", t === this.activeType);
    });

    /* Status label */
    const status = document.getElementById("maiStatus");
    if (status) {
      if (!this.activeType) {
        status.textContent = "Off";
        status.className = "mai-status mai-off";
      } else {
        const mode     = window.activeMode ?? "standard";
        const beatFreq = this._beatFreq(mode);
        const labels   = { neural:"Neural", binaural:"Binaural", rain:"Rain", drone:"Drone" };
        const modeLabels = {
          deep:"Deep Work · Beta", standard:"Standard · Low Beta", sprint:"Sprint · Gamma",
          creative:"Creative · Alpha", recovery:"Recovery · Theta", burnout:"Burnout Safe · Theta",
        };
        const extra = (this.activeType === "binaural" || this.activeType === "neural")
          ? ` · ${beatFreq} Hz`
          : "";
        status.textContent = `${labels[this.activeType]} · ${modeLabels[mode] ?? mode}${extra}`;
        status.className = "mai-status mai-on";
      }
    }

    this._renderIntensityBar();
  }

  _renderIntensityBar() {
    const bar  = document.getElementById("maiIntensityFill");
    const pct  = document.getElementById("maiIntensityPct");
    const val  = Math.round(this.sessionIntensity * 100);
    if (bar)  bar.style.width  = `${val}%`;
    if (pct)  pct.textContent  = `${val}%`;
  }
}

/* ════════════════════════════════════════════
   SINGLETON + INTEGRATION
════════════════════════════════════════════ */
window.ZenithMusicAI = new ZenithMusicAI();

document.addEventListener("DOMContentLoaded", () => {

  /* Sync volume with existing appVolume slider */
  const slider = document.getElementById("volumeControl");
  if (slider) {
    slider.addEventListener("input", () => {
      window.ZenithMusicAI.setVolume(parseFloat(slider.value));
    });
  }

  /* Sync with existing session state via setFocusState wrapper */
  const _origSetFocusState = window.setFocusState;
  if (typeof _origSetFocusState === "function") {
    window.setFocusState = function(state, ...args) {
      _origSetFocusState.call(this, state, ...args);
      if (state === "end" || state === "pause") {
        /* Fade but don't stop — let user manually control */
      }
    };
  }

  /* Sync when focus mode changes */
  const _origSelectMode = window.selectFocusMode;
  if (typeof _origSelectMode === "function") {
    window.selectFocusMode = function(modeId, ...args) {
      _origSelectMode.call(this, modeId, ...args);
      window.ZenithMusicAI.onModeChange(modeId);
    };
  }

  /* Set initial volume from appVolume */
  const vol = parseFloat(localStorage.getItem("appVolume")) || 0.7;
  window.ZenithMusicAI.targetVolume = vol * 0.85; // slightly softer than SFX
});

})(); /* end IIFE */