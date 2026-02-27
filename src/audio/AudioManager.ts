/**
 * AudioManager — all game audio synthesised via Web Audio API.
 *
 * Uses the AudioContext provided by Phaser's WebAudioSoundManager so that
 * Phaser handles browser autoplay-unlock automatically.
 *
 * Placeholder asset filenames (for future replacement with real files):
 *   public/audio/roswell_bark.mp3   — dog bark (single short bark)
 *   public/audio/mollie_pant.mp3    — soft breath loop
 *   public/audio/bg_house.mp3       — Level 1 ambient
 *   public/audio/bg_waterpark.mp3   — Level 2 ambient
 *   public/audio/bg_park.mp3        — Level 3 ambient
 *   public/audio/bg_city.mp3        — Level 4 ambient
 */
export class AudioManager {
  private ctx: AudioContext;

  /** Single master gain — toggled by mute. */
  private masterGain: GainNode;

  /** Background ambient routed through a separate gain for fade-in. */
  private bgGain: GainNode;
  private bgSource: AudioBufferSourceNode | null = null;

  /** Panting output routed through a separate gain for fade-in/out. */
  private pantGain: GainNode;

  /** Counts ms since player last started moving (for pant loudness ramp). */
  private movingTime = 0;
  /** Ms until next pant burst fires. */
  private pantTimer = 0;

  private isMuted = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 1;
    this.masterGain.connect(ctx.destination);

    this.bgGain = ctx.createGain();
    this.bgGain.gain.value = 0;
    this.bgGain.connect(this.masterGain);

    this.pantGain = ctx.createGain();
    this.pantGain.gain.value = 0;
    this.pantGain.connect(this.masterGain);
  }

  // ── Background per-level ambient ─────────────────────────────────────────

  /**
   * Start a new bandpass-filtered white-noise loop tuned to `freq` Hz.
   * Each level passes a different frequency for a distinct sonic signature.
   */
  setBgFreq(freq: number): void {
    this.stopBg();
    try {
      const sr = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, sr * 2, sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

      this.bgSource = this.ctx.createBufferSource();
      this.bgSource.buffer = buf;
      this.bgSource.loop = true;

      const flt = this.ctx.createBiquadFilter();
      flt.type = 'bandpass';
      flt.frequency.value = freq;
      flt.Q.value = 1.5;

      this.bgSource.connect(flt);
      flt.connect(this.bgGain);

      // Gentle fade-in so the ambient doesn't pop on level start.
      this.bgGain.gain.setTargetAtTime(0.03, this.ctx.currentTime, 0.8);
      this.bgSource.start();
    } catch { /* Web Audio not available */ }
  }

  stopBg(): void {
    try { this.bgSource?.stop(); } catch { /* already stopped */ }
    this.bgSource = null;
    try {
      this.bgGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    } catch { /* ignore */ }
  }

  // ── Roswell bark ─────────────────────────────────────────────────────────

  /**
   * Synthesise a short dog bark.
   * @param distance  Pixel distance from Roswell to Mollie.
   *                  Closer = louder (linear attenuation up to 500 px).
   */
  playBark(distance: number): void {
    try {
      const t = this.ctx.currentTime;
      const maxDist = 500;
      const normalised = Math.min(distance / maxDist, 1);
      // Full volume at 0 px; ~15% at maxDist.
      const barkGain = (1 - normalised * 0.85) * 0.28;
      if (barkGain < 0.002) return;

      // ── Pitch sweep: sawtooth 650 Hz → 180 Hz ──
      const envGain = this.ctx.createGain();
      envGain.gain.setValueAtTime(barkGain, t);
      envGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      envGain.connect(this.masterGain);

      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(650, t);
      osc.frequency.exponentialRampToValueAtTime(180, t + 0.15);
      osc.connect(envGain);
      osc.start(t);
      osc.stop(t + 0.24);

      // ── Noise burst for "boof" transient texture ──
      const noiseLen = Math.floor(this.ctx.sampleRate * 0.12);
      const noiseBuf = this.ctx.createBuffer(1, noiseLen, this.ctx.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < noiseLen; i++) nd[i] = Math.random() * 2 - 1;

      const noiseSrc = this.ctx.createBufferSource();
      noiseSrc.buffer = noiseBuf;

      const bpf = this.ctx.createBiquadFilter();
      bpf.type = 'bandpass';
      bpf.frequency.value = 750;
      bpf.Q.value = 1.2;

      const noiseEnv = this.ctx.createGain();
      noiseEnv.gain.setValueAtTime(barkGain * 0.45, t);
      noiseEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

      noiseSrc.connect(bpf);
      bpf.connect(noiseEnv);
      noiseEnv.connect(this.masterGain);
      noiseSrc.start(t);
    } catch { /* ignore */ }
  }

  // ── Mollie panting ───────────────────────────────────────────────────────

  /**
   * Call every frame.  Manages fade in/out and fires breath bursts on a timer.
   * @param isMoving  True if Mollie has non-negligible velocity this frame.
   * @param delta     Frame delta in ms.
   */
  updatePant(isMoving: boolean, delta: number): void {
    try {
      if (isMoving) {
        // Ramp up loudness for continuous movement (caps at 3 s).
        this.movingTime = Math.min(this.movingTime + delta, 3000);
        const moveFactor = this.movingTime / 3000;
        const targetGain = 0.028 + moveFactor * 0.028;
        this.pantGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.3);

        // Fire a breath burst when the timer expires.
        this.pantTimer -= delta;
        if (this.pantTimer <= 0) {
          this.firePantBurst();
          // ~2.5 breaths/s with slight randomness; a bit faster when moving a long time.
          const baseInterval = 350 - moveFactor * 60;
          this.pantTimer = baseInterval + Math.random() * 120;
        }
      } else {
        this.movingTime = Math.max(this.movingTime - delta * 2, 0);
        // Smooth fade-out over ~300 ms.
        this.pantGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
        this.pantTimer = 0;
      }
    } catch { /* ignore */ }
  }

  private firePantBurst(): void {
    try {
      const t = this.ctx.currentTime;
      // Short (70 ms) filtered noise burst = one breath.
      const len = Math.floor(this.ctx.sampleRate * 0.07);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

      const src = this.ctx.createBufferSource();
      src.buffer = buf;

      const bpf = this.ctx.createBiquadFilter();
      bpf.type = 'bandpass';
      bpf.frequency.value = 440;
      bpf.Q.value = 0.9;

      src.connect(bpf);
      bpf.connect(this.pantGain);
      src.start(t);
    } catch { /* ignore */ }
  }

  // ── Mute toggle ──────────────────────────────────────────────────────────

  /** Returns the new muted state. */
  toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    try {
      this.masterGain.gain.setTargetAtTime(
        this.isMuted ? 0 : 1,
        this.ctx.currentTime,
        0.05,
      );
    } catch { /* ignore */ }
    return this.isMuted;
  }

  getMuted(): boolean {
    return this.isMuted;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  stop(): void {
    this.stopBg();
    try {
      this.pantGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    } catch { /* ignore */ }
  }
}
