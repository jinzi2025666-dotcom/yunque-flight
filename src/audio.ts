import { IDLE_RPM, MAX_RPM } from './constants.ts';
import type { FlightState } from './physics.ts';
import { clamp } from './math.ts';

export class Soundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineA: OscillatorNode | null = null;
  private engineB: OscillatorNode | null = null;
  private windGain: GainNode | null = null;
  private stallGain: GainNode | null = null;
  private stallOsc: OscillatorNode | null = null;
  private muted = false;
  ready = false;

  get isMuted(): boolean {
    return this.muted;
  }

  unlock(): void {
    if (this.ready) {
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const master = ctx.createGain();
    master.gain.value = 0.72;
    master.connect(ctx.destination);

    const engineGain = ctx.createGain();
    engineGain.gain.value = 0.04;
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 240;
    engineFilter.Q.value = 0.7;
    const engineA = ctx.createOscillator();
    engineA.type = 'sawtooth';
    engineA.frequency.value = 70;
    const engineB = ctx.createOscillator();
    engineB.type = 'triangle';
    engineB.frequency.value = 48;
    engineA.connect(engineFilter);
    engineB.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);

    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const wind = ctx.createBufferSource();
    wind.buffer = buffer;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 520;
    windFilter.Q.value = 0.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);

    const stallOsc = ctx.createOscillator();
    stallOsc.type = 'square';
    stallOsc.frequency.value = 880;
    const stallGain = ctx.createGain();
    stallGain.gain.value = 0;
    stallOsc.connect(stallGain);
    stallGain.connect(master);

    engineA.start();
    engineB.start();
    wind.start();
    stallOsc.start();

    this.ctx = ctx;
    this.master = master;
    this.engineGain = engineGain;
    this.engineFilter = engineFilter;
    this.engineA = engineA;
    this.engineB = engineB;
    this.windGain = windGain;
    this.stallGain = stallGain;
    this.stallOsc = stallOsc;
    this.ready = true;
    if (ctx.state === 'suspended') void ctx.resume();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.72;
  }

  update(state: FlightState): void {
    if (!this.ctx || !this.engineA || !this.engineB || !this.engineGain || !this.engineFilter || !this.windGain || !this.stallGain) {
      return;
    }
    const now = this.ctx.currentTime;
    const spool = clamp((state.rpm - IDLE_RPM) / (MAX_RPM - IDLE_RPM), 0, 1);
    this.engineA.frequency.setTargetAtTime(62 + spool * 78 + state.airspeed * 0.12, now, 0.08);
    this.engineB.frequency.setTargetAtTime(41 + spool * 55, now, 0.08);
    this.engineFilter.frequency.setTargetAtTime(160 + spool * 980, now, 0.1);
    const engineLevel = (0.035 + spool * 0.09 + Math.min(state.airspeed, 60) * 0.0006) * (state.crashed ? 0.25 : 1);
    this.engineGain.gain.setTargetAtTime(engineLevel, now, 0.08);
    this.windGain.gain.setTargetAtTime(clamp(state.airspeed / 70, 0, 1) * 0.07, now, 0.12);
    const beep = state.stallWarn && !state.crashed && Math.sin(state.flightTime * 16) > 0.15;
    this.stallOsc?.frequency.setTargetAtTime(beep ? 960 : 880, now, 0.05);
    this.stallGain.gain.setTargetAtTime(beep ? 0.035 : 0, now, 0.02);
  }

  touch(hard: boolean): void {
    this.blip(hard ? 90 : 180, hard ? 0.22 : 0.09, hard ? 0.18 : 0.07);
  }

  crash(): void {
    this.blip(48, 0.45, 0.35);
    this.noiseBurst(0.4);
  }

  private blip(freq: number, gain: number, duration: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(gain, this.ctx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    osc.connect(amp);
    amp.connect(this.master);
    osc.start();
    osc.stop(this.ctx.currentTime + duration + 0.02);
  }

  private noiseBurst(duration: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const buffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * duration), this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    const amp = this.ctx.createGain();
    amp.gain.value = 0.5;
    source.connect(filter);
    filter.connect(amp);
    amp.connect(this.master);
    source.start();
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.ready = false;
  }
}
