import * as Tone from 'tone';
import { STEPS, STEPS_PER_BAR, type Composition, type Role, type Track } from './types';

// ganancia base por rol (mezcla)
const ROLE_GAIN: Record<Role, number> = {
  pad: 0.5,
  bass: 0.6,
  arp: 0.3,
  pluck: 0.35,
  bell: 0.16,
  texture: 0.14,
};

// envío a reverb por rol
const ROLE_REVERB: Record<Role, number> = {
  pad: 0.55,
  bass: 0.12,
  arp: 0.35,
  pluck: 0.3,
  bell: 0.75,
  texture: 0.6,
};

const ROLE_DELAY: Record<Role, number> = {
  pad: 0.1,
  bass: 0,
  arp: 0.4,
  pluck: 0.35,
  bell: 0.3,
  texture: 0.1,
};

interface TrackNodes {
  role: Role;
  trigger: (track: Track, step: number, time: number) => void;
  gain: Tone.Gain; // mezcla por rol × mute
  fade: Tone.Gain; // fade del derrumbe
  dispose: () => void;
}

export class CraterAudio {
  private ready = false;
  private startPromise: Promise<void> | null = null;
  private comp: Composition | null = null;
  private nodes = new Map<number, TrackNodes>();
  private master: Tone.Gain | null = null;
  private limiter: Tone.Limiter | null = null;
  private reverb: Tone.Reverb | null = null;
  private delay: Tone.PingPongDelay | null = null;
  private repeatId: number | null = null;
  private stepCount = 0;

  private stepListeners = new Set<(step: number) => void>();
  private triggerListeners = new Set<(trackId: number) => void>();

  onStep(fn: (step: number) => void): () => void {
    this.stepListeners.add(fn);
    return () => this.stepListeners.delete(fn);
  }

  onTrigger(fn: (trackId: number) => void): () => void {
    this.triggerListeners.add(fn);
    return () => this.triggerListeners.delete(fn);
  }

  get isReady(): boolean {
    return this.ready;
  }

  // memoizada: llamadas concurrentes (doble clic en derrumbar) comparten la misma
  // inicialización en vez de crear grafos de audio duplicados
  ensureStarted(): Promise<void> {
    this.startPromise ??= this.doStart().catch((e) => {
      this.startPromise = null;
      throw e;
    });
    return this.startPromise;
  }

  private async doStart(): Promise<void> {
    await Tone.start();
    this.limiter = new Tone.Limiter(-1.5).toDestination();
    this.master = new Tone.Gain(0.85).connect(this.limiter);
    this.reverb = new Tone.Reverb({ decay: 9, preDelay: 0.04, wet: 1 }).connect(this.master);
    // no esperamos al impulso del reverb: en pestañas ocultas su render por
    // trozos queda estrangulado y bloquearía el arranque; el reverb entra solo
    void this.reverb.ready.catch(() => {});
    this.delay = new Tone.PingPongDelay({ delayTime: '4n.', feedback: 0.35, wet: 1 }).connect(
      this.master,
    );
    this.ready = true;
    if (this.comp) this.buildTracks(this.comp);
  }

  setComposition(comp: Composition): void {
    this.comp = comp;
    Tone.getTransport().bpm.value = comp.bpm;
    if (this.ready) this.buildTracks(comp);
  }

  updateTracks(tracks: Track[]): void {
    if (!this.comp) return;
    this.comp = { ...this.comp, tracks };
    for (const t of tracks) {
      const n = this.nodes.get(t.id);
      if (n) n.gain.gain.rampTo(t.muted ? 0 : ROLE_GAIN[n.role], 0.08);
    }
  }

  setBpm(bpm: number): void {
    if (this.comp) this.comp = { ...this.comp, bpm };
    Tone.getTransport().bpm.rampTo(bpm, 0.3);
  }

  start(): void {
    if (!this.ready) return;
    this.stepCount = 0;
    const transport = Tone.getTransport();
    if (this.repeatId === null) {
      this.repeatId = transport.scheduleRepeat((time) => this.onRepeat(time), '8n');
    }
    transport.start('+0.05');
  }

  pause(): void {
    Tone.getTransport().pause();
  }

  resume(): void {
    Tone.getTransport().start();
  }

  stop(): void {
    const transport = Tone.getTransport();
    transport.stop();
    this.stepCount = 0;
    for (const n of this.nodes.values()) n.fade.gain.cancelScheduledValues(Tone.now());
  }

  setAllFades(v: number): void {
    for (const n of this.nodes.values()) n.fade.gain.value = v;
  }

  fadeInTrack(id: number, seconds: number): void {
    const n = this.nodes.get(id);
    if (n) n.fade.gain.rampTo(1, seconds);
  }

  setTrackFade(id: number, v: number): void {
    const n = this.nodes.get(id);
    if (n) n.fade.gain.value = v;
  }

  fadeOutAll(seconds: number): void {
    for (const n of this.nodes.values()) n.fade.gain.rampTo(0, seconds);
  }

  dispose(): void {
    this.stop();
    if (this.repeatId !== null) {
      Tone.getTransport().clear(this.repeatId);
      this.repeatId = null;
    }
    this.disposeTracks();
    this.reverb?.dispose();
    this.delay?.dispose();
    this.master?.dispose();
    this.limiter?.dispose();
    this.ready = false;
    this.startPromise = null;
  }

  // ------------------------------------------------------------------

  private onRepeat(time: number): void {
    if (!this.comp) return;
    const step = this.stepCount % STEPS;
    this.stepCount++;

    for (const track of this.comp.tracks) {
      if (track.muted || !track.steps[step]) continue;
      const n = this.nodes.get(track.id);
      if (!n) continue;
      try {
        n.trigger(track, step, time);
      } catch {
        // un trigger fallido no debe tumbar el transporte
      }
      Tone.getDraw().schedule(() => {
        for (const fn of this.triggerListeners) fn(track.id);
      }, time);
    }

    Tone.getDraw().schedule(() => {
      for (const fn of this.stepListeners) fn(step);
    }, time);
  }

  private disposeTracks(): void {
    for (const n of this.nodes.values()) n.dispose();
    this.nodes.clear();
  }

  private buildTracks(comp: Composition): void {
    this.disposeTracks();
    for (const track of comp.tracks) {
      this.nodes.set(track.id, this.buildTrack(track, comp));
    }
  }

  private buildTrack(track: Track, comp: Composition): TrackNodes {
    if (!this.master || !this.reverb || !this.delay) throw new Error('audio no inicializado');
    const role = track.role;
    const gain = new Tone.Gain(track.muted ? 0 : ROLE_GAIN[role]);
    const fade = new Tone.Gain(1);
    gain.connect(fade);
    fade.connect(this.master);
    const revSend = new Tone.Gain(ROLE_REVERB[role]);
    fade.connect(revSend);
    revSend.connect(this.reverb);
    const disposables: Array<{ dispose: () => void }> = [gain, fade, revSend];
    let delSend: Tone.Gain | null = null;
    if (ROLE_DELAY[role] > 0) {
      delSend = new Tone.Gain(ROLE_DELAY[role]);
      fade.connect(delSend);
      delSend.connect(this.delay);
      disposables.push(delSend);
    }

    let trigger: TrackNodes['trigger'];

    switch (role) {
      case 'pad': {
        const filter = new Tone.Filter(1400, 'lowpass').connect(gain);
        const synth = new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 1.01,
          modulationIndex: 3.5,
          oscillator: { type: 'sine' },
          modulation: { type: 'triangle' },
          envelope: { attack: 2.2, decay: 1.5, sustain: 0.65, release: 6 },
          modulationEnvelope: { attack: 3.5, decay: 1, sustain: 0.5, release: 6 },
        }).connect(filter);
        // 4 notas × '1m' + 6s de release: a 110 bpm coexisten hasta 4 acordes → 16 voces
        synth.maxPolyphony = 24;
        disposables.push(synth, filter);
        trigger = (t, step, time) => {
          const bar = Math.floor(step / STEPS_PER_BAR);
          synth.triggerAttackRelease(comp.chords[bar], '1m', time, t.velocities[step] * 0.55);
        };
        break;
      }
      case 'bass': {
        const synth = new Tone.MonoSynth({
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.08, decay: 0.4, sustain: 0.75, release: 1.6 },
          filterEnvelope: {
            attack: 0.05,
            decay: 0.6,
            sustain: 0.4,
            release: 1.2,
            baseFrequency: 90,
            octaves: 2.2,
          },
        }).connect(gain);
        disposables.push(synth);
        trigger = (t, step, time) => {
          synth.triggerAttackRelease(t.pitches[step], '2n', time, t.velocities[step] * 0.9);
        };
        break;
      }
      case 'arp': {
        const synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.012, decay: 0.35, sustain: 0.08, release: 1.4 },
        }).connect(gain);
        synth.maxPolyphony = 12;
        disposables.push(synth);
        trigger = (t, step, time) => {
          synth.triggerAttackRelease(t.pitches[step], '8n', time, t.velocities[step]);
        };
        break;
      }
      case 'pluck': {
        const synth = new Tone.PluckSynth({
          attackNoise: 0.7,
          dampening: 3400,
          resonance: 0.92,
        }).connect(gain);
        disposables.push(synth);
        trigger = (t, step, time) => {
          synth.triggerAttack(t.pitches[step], time);
        };
        break;
      }
      case 'bell': {
        const synth = new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 5.07,
          modulationIndex: 14,
          oscillator: { type: 'sine' },
          envelope: { attack: 0.002, decay: 1.6, sustain: 0, release: 3.5 },
          modulationEnvelope: { attack: 0.002, decay: 0.9, sustain: 0, release: 2 },
        }).connect(gain);
        synth.maxPolyphony = 8;
        disposables.push(synth);
        trigger = (t, step, time) => {
          synth.triggerAttackRelease(t.pitches[step], '1n', time, t.velocities[step] * 0.7);
        };
        break;
      }
      case 'texture': {
        const filter = new Tone.Filter(500, 'lowpass').connect(gain);
        const lfo = new Tone.LFO({ frequency: 0.06, min: 250, max: 1100 });
        lfo.connect(filter.frequency);
        lfo.start();
        const synth = new Tone.NoiseSynth({
          noise: { type: 'pink' },
          envelope: { attack: 2.5, decay: 1.5, sustain: 0.25, release: 5 },
        }).connect(filter);
        disposables.push(synth, filter, lfo);
        trigger = (t, step, time) => {
          synth.triggerAttackRelease('1m', time, t.velocities[step] * 0.5);
        };
        break;
      }
    }

    return {
      role,
      trigger,
      gain,
      fade,
      dispose: () => {
        for (const d of disposables) d.dispose();
      },
    };
  }
}
