import * as Tone from 'tone';
import { STEPS, STEPS_PER_BAR, type Composition, type Role, type Track } from './types';

const ROOT_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// roles decorativos: pueden callar en las vueltas de baja intensidad
const DECORATIVE: ReadonlySet<Role> = new Set(['arp', 'pluck', 'bell', 'texture']);

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
  trigger: (track: Track, step: number, time: number, velScale: number, lift: boolean) => void;
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
  private masterFilter: Tone.Filter | null = null;
  private breathLfo: Tone.LFO | null = null;
  private limiter: Tone.Limiter | null = null;
  private reverb: Tone.Reverb | null = null;
  private delay: Tone.PingPongDelay | null = null;
  private drone: Tone.MonoSynth | null = null;
  private droneGain: Tone.Gain | null = null;
  private stepSynth: Tone.PluckSynth | null = null;
  private stepGain: Tone.Gain | null = null;
  private ecoSynth: Tone.PolySynth | null = null;
  private ecoGain: Tone.Gain | null = null;
  private walkPool: string[] = []; // notas consonantes para los pasos del Grano
  private lastStepTime = 0; // PluckSynth exige tiempos estrictamente crecientes
  private extraNodes: Array<{ dispose: () => void }> = [];
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
    // filtro respirante en el master: la mezcla entera se abre y cierra muy despacio
    this.masterFilter = new Tone.Filter(11000, 'lowpass').connect(this.limiter);
    this.breathLfo = new Tone.LFO({ frequency: 0.025, min: 5200, max: 14000 });
    this.breathLfo.connect(this.masterFilter.frequency);
    this.breathLfo.start();
    this.master = new Tone.Gain(0.85).connect(this.masterFilter);
    // drone de sub-bajo: el suelo armónico permanente de la pieza
    this.droneGain = new Tone.Gain(0).connect(this.master);
    this.drone = new Tone.MonoSynth({
      oscillator: { type: 'sine' },
      envelope: { attack: 6, decay: 0.1, sustain: 1, release: 9 },
      filterEnvelope: {
        attack: 5,
        decay: 0.1,
        sustain: 1,
        release: 9,
        baseFrequency: 110,
        octaves: 0.6,
      },
    }).connect(this.droneGain);
    // sonidos del modo caminata: pasos (cuerda pulsada suave) y ecos (campanas)
    this.stepGain = new Tone.Gain(0.4).connect(this.master);
    this.stepSynth = new Tone.PluckSynth({
      attackNoise: 0.4,
      dampening: 2600,
      resonance: 0.85,
    }).connect(this.stepGain);
    this.ecoGain = new Tone.Gain(0.5).connect(this.master);
    this.ecoSynth = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3.01,
      modulationIndex: 9,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.004, decay: 1.4, sustain: 0, release: 3 },
      modulationEnvelope: { attack: 0.004, decay: 0.8, sustain: 0, release: 2 },
    }).connect(this.ecoGain);
    this.ecoSynth.maxPolyphony = 32; // 6 ecos seguidos × 4 notas con colas largas
    this.reverb = new Tone.Reverb({ decay: 9, preDelay: 0.04, wet: 1 }).connect(this.master);
    // no esperamos al impulso del reverb: en pestañas ocultas su render por
    // trozos queda estrangulado y bloquearía el arranque; el reverb entra solo
    void this.reverb.ready.catch(() => {});
    // colas de reverb para pasos y ecos
    const stepRev = new Tone.Gain(0.35).connect(this.reverb);
    this.stepGain.connect(stepRev);
    const ecoRev = new Tone.Gain(0.8).connect(this.reverb);
    this.ecoGain.connect(ecoRev);
    this.extraNodes.push(stepRev, ecoRev);
    this.delay = new Tone.PingPongDelay({ delayTime: '4n.', feedback: 0.35, wet: 1 }).connect(
      this.master,
    );
    this.ready = true;
    if (this.comp) this.buildTracks(this.comp);
  }

  setComposition(comp: Composition): void {
    const rootChanged = this.comp && this.comp.rootPc !== comp.rootPc;
    this.comp = comp;
    Tone.getTransport().bpm.value = comp.bpm;
    // notas para los pasos: los tonos de la progresión, ordenados y con octava extra
    const uniq = [...new Set(comp.chords.flat())].sort(
      (a, b) => Tone.Frequency(a).toMidi() - Tone.Frequency(b).toMidi(),
    );
    this.walkPool = uniq.concat(uniq.map((n) => Tone.Frequency(n).transpose(12).toNote()));
    if (this.ready) this.buildTracks(comp);
    if (rootChanged && Tone.getTransport().state === 'started') this.startDrone();
  }

  // paso del Grano: la altura de la duna (0-1) elige la nota — dunas altas, notas altas
  playStep(height01: number): void {
    if (!this.ready || !this.stepSynth || this.walkPool.length === 0) return;
    const len = this.walkPool.length;
    const base = Math.round(Math.max(0, Math.min(1, height01)) * (len - 1));
    const idx = Math.min(len - 1, base + (Math.random() < 0.25 ? 1 : 0));
    const time = Math.max(Tone.now(), this.lastStepTime + 0.035);
    this.lastStepTime = time;
    try {
      this.stepSynth.triggerAttack(this.walkPool[idx], time);
    } catch {
      // un paso que no suena no debe romper la caminata
    }
  }

  // eco recogido: arpegio de campanas con el acorde asociado a esa pista
  playEco(trackId: number): void {
    if (!this.ready || !this.ecoSynth || !this.comp) return;
    const chord = this.comp.chords[trackId % this.comp.chords.length];
    const now = Tone.now();
    chord.forEach((n, i) => {
      const note = Tone.Frequency(n).transpose(12).toNote();
      this.ecoSynth?.triggerAttackRelease(note, '2n', now + i * 0.09, 0.55);
    });
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
    this.startDrone();
  }

  pause(): void {
    Tone.getTransport().pause();
    this.drone?.triggerRelease();
  }

  resume(): void {
    Tone.getTransport().start();
    this.startDrone();
  }

  stop(): void {
    const transport = Tone.getTransport();
    transport.stop();
    this.stepCount = 0;
    this.drone?.triggerRelease();
    this.droneGain?.gain.rampTo(0, 2);
    for (const n of this.nodes.values()) n.fade.gain.cancelScheduledValues(Tone.now());
  }

  private startDrone(): void {
    if (!this.drone || !this.droneGain || !this.comp) return;
    this.drone.triggerAttack(`${ROOT_NOTES[this.comp.rootPc]}1`);
    this.droneGain.gain.rampTo(0.14, 10);
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
    this.drone?.dispose();
    this.droneGain?.dispose();
    this.stepSynth?.dispose();
    this.stepGain?.dispose();
    this.ecoSynth?.dispose();
    this.ecoGain?.dispose();
    for (const n of this.extraNodes) n.dispose();
    this.extraNodes = [];
    this.breathLfo?.dispose();
    this.master?.dispose();
    this.masterFilter?.dispose();
    this.limiter?.dispose();
    this.ready = false;
    this.startPromise = null;
  }

  // ------------------------------------------------------------------

  private onRepeat(time: number): void {
    if (!this.comp) return;
    const step = this.stepCount % STEPS;
    const loop = Math.floor(this.stepCount / STEPS);
    this.stepCount++;

    // arco de intensidad: la pieza respira en ciclos de 8 vueltas (~2-4 min),
    // de escasa a plena y de vuelta — forma musical, no loop estático
    const cycle = (loop % 8) / 8;
    const intensity = 0.55 + 0.45 * Math.sin(Math.PI * cycle);
    // en la cresta del ciclo, el arpegio sube una octava
    const lift = cycle >= 0.375 && cycle < 0.625;

    for (const track of this.comp.tracks) {
      if (track.muted || !track.steps[step]) continue;
      const n = this.nodes.get(track.id);
      if (!n) continue;
      // los roles decorativos callan a veces en las vueltas tenues
      if (DECORATIVE.has(track.role) && Math.random() > intensity) continue;
      // humanización: micro-desfase de tiempo y variación de velocidad
      const t = time + (Math.random() - 0.5) * 0.018;
      const velScale = (0.82 + Math.random() * 0.24) * (0.72 + 0.28 * intensity);
      try {
        n.trigger(track, step, t, velScale, lift);
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
        // chorus lento: ensancha el manto en estéreo
        const chorus = new Tone.Chorus({ frequency: 0.24, delayTime: 4.5, depth: 0.7, wet: 0.5 })
          .connect(gain)
          .start();
        const filter = new Tone.Filter(1400, 'lowpass').connect(chorus);
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
        disposables.push(synth, filter, chorus);
        trigger = (t, step, time, velScale) => {
          const bar = Math.floor(step / STEPS_PER_BAR);
          synth.triggerAttackRelease(
            comp.chords[bar],
            '1m',
            time,
            t.velocities[step] * 0.55 * velScale,
          );
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
        trigger = (t, step, time, velScale) => {
          synth.triggerAttackRelease(
            t.pitches[step],
            '2n',
            time,
            t.velocities[step] * 0.9 * velScale,
          );
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
        trigger = (t, step, time, velScale, lift) => {
          const pitch = lift
            ? Tone.Frequency(t.pitches[step]).transpose(12).toNote()
            : t.pitches[step];
          synth.triggerAttackRelease(pitch, '8n', time, t.velocities[step] * velScale);
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
        trigger = (t, _step, time) => {
          synth.triggerAttack(t.pitches[_step], time);
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
        trigger = (t, step, time, velScale) => {
          synth.triggerAttackRelease(
            t.pitches[step],
            '1n',
            time,
            t.velocities[step] * 0.7 * velScale,
          );
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
        trigger = (t, step, time, velScale) => {
          synth.triggerAttackRelease('1m', time, t.velocities[step] * 0.5 * velScale);
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
