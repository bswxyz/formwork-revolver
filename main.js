/* REVOLVER — audio-reactive turntable.
   A spinning-vinyl deck driven by a WebAudio generative loop
   (evolving pad + a scheduled bass/hat/arp) feeding an AnalyserNode
   that draws a circular waveform ring around the record.
   No autoplay: sound only starts on a click gesture. */
(() => {
  'use strict';
  const docEl = document.documentElement;
  docEl.classList.add('js');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  /* ---------------- the crate ----------------
     Each track carries the musical parameters that retune the deck. */
  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const TRACKS = [
    { title: 'Neon Vespers',  artist: 'Halogen Choir', genre: 'Dub Techno',    time: '6:12', side: 'A1',
      root: 45, scale: [0,3,5,7,10],  wave: 'sawtooth', tempo: 84,  cutoff: 620 },
    { title: 'Molten Bloom',  artist: 'Rue Sévigné',   genre: 'Nu-Jazz',       time: '4:48', side: 'A2',
      root: 50, scale: [0,2,3,5,7,9,10], wave: 'triangle', tempo: 96, cutoff: 1250 },
    { title: 'Static Saints', artist: 'The Undertow',  genre: 'Krautrock',     time: '7:03', side: 'B1',
      root: 40, scale: [0,2,3,7,10],  wave: 'sawtooth', tempo: 132, cutoff: 900 },
    { title: 'Amber Static',  artist: 'Coma Sol',      genre: 'Ambient House', time: '5:27', side: 'B2',
      root: 48, scale: [0,2,4,7,9],   wave: 'sine',     tempo: 110, cutoff: 1500 },
    { title: 'Velvet Rotor',  artist: 'Bijou Machine', genre: 'Downtempo',     time: '5:55', side: 'C1',
      root: 43, scale: [0,3,5,7,10],  wave: 'triangle', tempo: 90,  cutoff: 780 },
    { title: 'Ghost Pressing', artist: 'Analog Widow', genre: 'Post-Punk',     time: '3:41', side: 'C2',
      root: 47, scale: [0,2,3,5,7,10], wave: 'sawtooth', tempo: 146, cutoff: 1040 },
  ];
  let current = 0;

  /* ---------------- element refs ---------------- */
  const $ = (id) => document.getElementById(id);
  const els = {
    play: $('play'), playWord: $('playWord'),
    nowTitle: $('nowTitle'), nowArtist: $('nowArtist'), nowGenre: $('nowGenre'), nowTime: $('nowTime'),
    labelSide: $('labelSide'), stState: $('stState'), stBpm: $('stBpm'),
    tracks: $('tracks'), viz: $('viz'), audioNote: $('audioNote'), deck: $('deck'),
  };

  /* ---------------- build the tracklist ---------------- */
  function buildTracks() {
    if (!els.tracks) return;
    els.tracks.innerHTML = '';
    TRACKS.forEach((t, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'track' + (i === current ? ' is-cued' : '');
      btn.setAttribute('aria-pressed', i === current ? 'true' : 'false');
      btn.dataset.i = String(i);
      btn.innerHTML =
        '<span class="t-idx">' + String(i + 1).padStart(2, '0') +
          '<span class="t-eq" aria-hidden="true"><i></i><i></i><i></i></span></span>' +
        '<span class="t-title">' + t.title + '</span>' +
        '<span class="t-artist">' + t.artist + '</span>' +
        '<span class="t-genre">' + t.genre + '</span>' +
        '<span class="t-time mono">' + t.time + '</span>';
      btn.addEventListener('click', () => loadTrack(i, true));
      li.appendChild(btn);
      els.tracks.appendChild(li);
    });
  }

  function setText(el, v) { if (el) el.textContent = v; }

  function loadTrack(i, alsoPlay) {
    current = clamp(i, 0, TRACKS.length - 1);
    const t = TRACKS[current];
    setText(els.nowTitle, t.title);
    setText(els.nowArtist, t.artist);
    setText(els.nowGenre, t.genre);
    setText(els.nowTime, t.time);
    setText(els.labelSide, t.side);
    setText(els.stBpm, String(t.tempo));
    document.querySelectorAll('.track').forEach((b) => {
      const on = Number(b.dataset.i) === current;
      b.classList.toggle('is-cued', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (audio.ctx) audio.retune(t);           // live-retune if the engine exists
    if (alsoPlay && !audio.playing) toggle();  // clicking a row cues + starts
  }

  /* ================= WEBAUDIO ENGINE ================= */
  const audio = {
    ctx: null, master: null, analyser: null, voiceBus: null,
    pad: [], filter: null, lfo: null, time: new Uint8Array(0),
    playing: false, sched: 0, nextT: 0, step: 0, bar: 0, seed: 0x1a2b, ok: true,
  };

  const AC = window.AudioContext || window.webkitAudioContext;

  function ensureAudio() {
    if (audio.ctx) return true;
    if (!AC) { audio.ok = false; return false; }
    let ctx;
    try { ctx = new AC(); } catch (e) { audio.ok = false; return false; }
    audio.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.0001;
    const comp = ctx.createDynamicsCompressor();  // keep it safe & glued
    comp.threshold.value = -18; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.82;
    master.connect(comp); comp.connect(analyser); analyser.connect(ctx.destination);
    audio.master = master; audio.analyser = analyser;
    audio.time = new Uint8Array(analyser.fftSize);

    const voiceBus = ctx.createGain();
    voiceBus.gain.value = 0.9; voiceBus.connect(master);
    audio.voiceBus = voiceBus;

    // evolving pad: three oscillators through a resonant lowpass, cutoff swept by an LFO
    const t = TRACKS[current];
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = t.cutoff; filter.Q.value = 7;
    const padGain = ctx.createGain(); padGain.gain.value = 0.14;
    filter.connect(padGain); padGain.connect(master);
    const voices = [0, 7, 12];
    audio.pad = voices.map((semi, k) => {
      const o = ctx.createOscillator();
      o.type = k === 0 ? t.wave : (k === 1 ? 'sine' : 'triangle');
      o.frequency.value = midi(t.root + semi);
      o.detune.value = (k - 1) * 5;
      o.connect(filter); o.start();
      return o;
    });
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 320;
    lfo.connect(lfoGain); lfoGain.connect(filter.frequency); lfo.start();
    audio.filter = filter; audio.lfo = lfo;
    return true;
  }

  audio.retune = function (t) {
    const ctx = audio.ctx; if (!ctx) return;
    const now = ctx.currentTime;
    const voices = [0, 7, 12];
    audio.pad.forEach((o, k) => {
      o.frequency.setTargetAtTime(midi(t.root + voices[k]), now, 0.12);
      if (k === 0) o.type = t.wave;
    });
    if (audio.filter) audio.filter.frequency.setTargetAtTime(t.cutoff, now, 0.2);
  };

  /* ---- tiny seeded PRNG so the arp is generative but stable per bar ---- */
  function rng() {
    audio.seed = (audio.seed * 1664525 + 1013904223) >>> 0;
    return audio.seed / 4294967296;
  }

  function voice(freq, time, dur, type, peak) {
    const ctx = audio.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, time);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + 0.014);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(g); g.connect(audio.voiceBus);
    o.start(time); o.stop(time + dur + 0.04);
  }

  function hat(time, peak) {
    const ctx = audio.ctx;
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(7200 + rng() * 1800, time);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    o.connect(hp); hp.connect(g); g.connect(audio.voiceBus);
    o.start(time); o.stop(time + 0.06);
  }

  function scheduleStep(step, time) {
    const t = TRACKS[current];
    const sc = t.scale, len = sc.length;
    // bass on the downbeats
    if (step % 4 === 0) {
      voice(midi(t.root - 12), time, 0.34, 'triangle', 0.5);
      if (step === 0) audio.bar++;
    }
    // soft hats on the offbeats
    if (step % 2 === 1) hat(time, step % 4 === 3 ? 0.05 : 0.03);
    // generative arpeggio — a note most steps, drawn from the scale
    if (rng() < 0.66) {
      const deg = sc[(Math.floor(rng() * len)) % len];
      const oct = rng() < 0.28 ? 12 : 0;
      voice(midi(t.root + deg + 12 + oct), time, 0.26 + rng() * 0.18, t.wave === 'sine' ? 'triangle' : t.wave, 0.14);
    }
  }

  function scheduler() {
    const ctx = audio.ctx; if (!ctx) return;
    const spb = 60 / TRACKS[current].tempo;    // seconds per beat
    const stepDur = spb / 4;                    // sixteenth notes
    while (audio.nextT < ctx.currentTime + 0.12) {
      scheduleStep(audio.step, audio.nextT);
      audio.nextT += stepDur;
      audio.step = (audio.step + 1) % 16;
    }
    audio.sched = window.setTimeout(scheduler, 25);
  }

  function play() {
    if (!ensureAudio()) { if (els.audioNote) els.audioNote.hidden = false; return; }
    const ctx = audio.ctx;
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    if (audio.playing) return;
    audio.playing = true;
    document.body.classList.add('playing');
    const now = ctx.currentTime;
    audio.master.gain.cancelScheduledValues(now);
    audio.master.gain.setValueAtTime(Math.max(audio.master.gain.value, 0.0001), now);
    audio.master.gain.exponentialRampToValueAtTime(0.42, now + 0.6);
    audio.nextT = now + 0.06; audio.step = 0;
    scheduler();
    setState(true);
  }

  function pause() {
    const ctx = audio.ctx; if (!ctx) return;
    audio.playing = false;
    document.body.classList.remove('playing');
    const now = ctx.currentTime;
    audio.master.gain.cancelScheduledValues(now);
    audio.master.gain.setValueAtTime(Math.max(audio.master.gain.value, 0.0001), now);
    audio.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    clearTimeout(audio.sched);
    window.setTimeout(() => { if (!audio.playing && ctx.suspend) ctx.suspend(); }, 460);
    setState(false);
  }

  function setState(on) {
    if (els.play) { els.play.setAttribute('aria-pressed', on ? 'true' : 'false');
      els.play.setAttribute('aria-label', on ? 'Pause the generative groove' : 'Play the generative groove'); }
    setText(els.playWord, on ? 'Pause' : 'Play');
    setText(els.stState, on ? 'Spinning' : 'Paused');
  }

  function toggle() { if (audio.playing) pause(); else play(); }
  if (els.play) els.play.addEventListener('click', toggle);

  /* ================= CIRCULAR VISUALIZER ================= */
  const viz = (() => {
    const canvas = els.viz;
    if (!canvas) return null;
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return null;
    let w = 0, h = 0, dpr = 1, raf = 0, t0 = performance.now();

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = canvas.clientWidth || 400; h = canvas.clientHeight || 400;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function frame(now) {
      const time = (now - t0) / 1000;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const R = Math.min(w, h) * 0.5;
      const base = R * 0.86;               // sits just outside the record edge
      const N = 128;
      const live = audio.playing && audio.analyser;
      if (live) audio.analyser.getByteTimeDomainData(audio.time);

      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#ff5a1f');
      grad.addColorStop(1, '#e8b04b');

      let sum = 0;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * TAU - Math.PI / 2;
        let amp;
        if (live) {
          const idx = Math.floor((i / N) * (audio.time.length - 1));
          const v = (audio.time[idx] - 128) / 128;   // -1..1
          amp = v * R * 0.11;
          sum += v * v;
        } else {
          // synthetic idle waveform — gentle, breathing
          amp = (Math.sin(a * 3 + time * 1.1) * 0.5 + Math.sin(a * 7 - time * 0.7) * 0.28)
                * R * 0.03 * (0.7 + 0.3 * Math.sin(time * 0.9));
        }
        const r = base + amp;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.lineWidth = Math.max(1.4, R * 0.012);
      ctx.strokeStyle = grad;
      ctx.stroke();

      // inner tick ring for texture
      ctx.strokeStyle = 'rgba(240,236,227,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, base * 0.985, 0, TAU); ctx.stroke();

      // live amplitude → CSS glow on the platter
      const level = live ? clamp(Math.sqrt(sum / N) * 2.6, 0, 1) : 0;
      docEl.style.setProperty('--level', level.toFixed(3));

      raf = requestAnimationFrame(frame);
    }

    function still() {  // one static frame for reduced-motion
      resize();
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.5, base = R * 0.86;
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#ff5a1f'); grad.addColorStop(1, '#e8b04b');
      ctx.strokeStyle = grad; ctx.lineWidth = Math.max(1.4, R * 0.012);
      ctx.beginPath(); ctx.arc(cx, cy, base, 0, TAU); ctx.stroke();
    }

    function start() {
      resize();
      if (reduce) { still(); return; }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    }
    let rt = 0;
    function onResize() { clearTimeout(rt); rt = setTimeout(() => { if (reduce) still(); else resize(); }, 180); }
    return { start, onResize };
  })();

  /* ================= boot / motion layer ================= */
  buildTracks();
  loadTrack(0, false);
  if (viz) viz.start();

  // hero intro (compositor-driven)
  const hero = document.querySelector('.hero');
  if (hero) {
    requestAnimationFrame(() => requestAnimationFrame(() => hero.classList.add('loaded')));
    setTimeout(() => hero.classList.add('loaded'), 400);
  }

  // scroll reveals
  const revealAll = () => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('is-in'));
  if (reduce || !('IntersectionObserver' in window)) {
    revealAll();
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    document.querySelectorAll('.reveal').forEach((el) => { if (!el.closest('.hero')) io.observe(el); });
  }

  // nav backdrop
  const nav = document.querySelector('.nav');
  if (nav) {
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 40);
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
  }

  // spacebar toggles play (unless a button/field is focused — let it handle its own key)
  addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test((e.target && e.target.tagName) || '')) {
      e.preventDefault(); toggle();
    }
  });

  addEventListener('resize', () => { if (viz) viz.onResize(); }, { passive: true });

  // pause cleanly if the tab is hidden
  document.addEventListener('visibilitychange', () => { if (document.hidden && audio.playing) pause(); });
})();
