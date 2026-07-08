import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CraterAudio } from './lib/audio';
import { analyzeImage } from './lib/palette';
import { compose, MODE_NAMES, SOLFEGE } from './lib/music';
import { Landing } from './components/Landing';
import { SandCanvas } from './components/SandCanvas';
import { Timeline } from './components/Timeline';
import { CHARACTERS, spriteDataUrl, type Character } from './lib/sprites';
import type { AnalyzedImage, Composition, Phase, Role, Track } from './lib/types';

const ROLE_PRIORITY: Role[] = ['pad', 'bass', 'arp', 'pluck', 'bell', 'texture'];

export default function App() {
  const audioRef = useRef<CraterAudio | null>(null);
  if (!audioRef.current) audioRef.current = new CraterAudio();
  const audio = audioRef.current;

  const [analyzed, setAnalyzed] = useState<AnalyzedImage | null>(null);
  const [comp, setComp] = useState<Composition | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [phase, setPhase] = useState<Phase>('intact');
  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [bpm, setBpm] = useState(70);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [walkMode, setWalkMode] = useState(false);
  const [ecos, setEcos] = useState({ collected: 0, total: 0 });
  const [won, setWon] = useState(false);
  const [character, setCharacter] = useState<Character | null>(null);
  const [selecting, setSelecting] = useState(false);

  // la caminata solo existe sobre las dunas ya formadas
  useEffect(() => {
    if (phase !== 'collapsed') {
      setWalkMode(false);
      setWon(false);
    }
  }, [phase]);

  // refs para leer el estado vigente tras un await (evita cierres obsoletos)
  const compRef = useRef(comp);
  compRef.current = comp;
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const analysisIdRef = useRef(0);
  const releasedRef = useRef(new Set<number>());

  useEffect(() => audio.onStep(setCurrentStep), [audio]);
  useEffect(() => () => audio.dispose(), [audio]);

  // evitar que soltar un archivo fuera del dropzone navegue fuera de la app
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  const applyComposition = useCallback(
    (c: Composition) => {
      setComp(c);
      setTracks(c.tracks);
      setBpm(c.bpm);
      audio.setComposition(c);
    },
    [audio],
  );

  const handleImage = useCallback(
    async (src: string) => {
      const id = ++analysisIdRef.current;
      setError(null);
      setAnalyzing(true);
      try {
        const seed = Math.floor(Math.random() * 1e9);
        const a = await analyzeImage(src, seed);
        if (id !== analysisIdRef.current) return; // llegó otra imagen mientras tanto
        audio.stop();
        setPlaying(false);
        setPhase('intact');
        setAnalyzed(a);
        applyComposition(compose(a, seed));
      } catch (e) {
        if (id !== analysisIdRef.current) return;
        setError(e instanceof Error ? e.message : 'No se pudo procesar la imagen');
      } finally {
        if (id === analysisIdRef.current) setAnalyzing(false);
      }
    },
    [audio, applyComposition],
  );

  const releaseOrder = useMemo(() => {
    return [...tracks]
      .sort((a, b) => ROLE_PRIORITY.indexOf(a.role) - ROLE_PRIORITY.indexOf(b.role))
      .map((t) => t.id);
  }, [tracks]);

  const collapse = useCallback(async () => {
    if (!compRef.current) return;
    await audio.ensureStarted();
    // releer tras el await: el usuario pudo regenerar o cambiar bpm mientras tanto
    const c = compRef.current;
    if (!c) return;
    audio.setComposition({ ...c, tracks: tracksRef.current });
    releasedRef.current = new Set();
    audio.setAllFades(0);
    audio.start();
    setPlaying(true);
    setPhase('collapsing');
  }, [audio]);

  const reform = useCallback(() => {
    audio.fadeOutAll(1.1);
    setPhase('reforming');
  }, [audio]);

  const togglePlay = useCallback(async () => {
    if (phase === 'intact') {
      await collapse();
      return;
    }
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      await audio.ensureStarted();
      audio.resume();
      setPlaying(true);
    }
  }, [phase, playing, audio, collapse]);

  // barra espaciadora = play/pausa
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !comp) return;
      const target = e.target as HTMLElement;
      if (target.closest('input, button, select, textarea')) return;
      e.preventDefault();
      void togglePlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, comp]);

  const regenerate = useCallback(
    (overrides: { rootPc?: number; modeName?: string } = {}, newSeed = true) => {
      if (!analyzed || !comp) return;
      const seed = newSeed ? Math.floor(Math.random() * 1e9) : comp.seed;
      const c = compose(analyzed, seed, {
        rootPc: overrides.rootPc ?? undefined,
        modeName: overrides.modeName ?? undefined,
      });
      applyComposition(c);
      // reconstruir pistas resetea los fades a 1: restaurar el estado del derrumbe
      if (phase === 'collapsed') {
        audio.setAllFades(1);
      } else if (phase === 'collapsing') {
        for (const t of c.tracks) audio.setTrackFade(t.id, releasedRef.current.has(t.id) ? 1 : 0);
      } else if (phase === 'reforming' || phase === 'intact') {
        audio.setAllFades(0);
      }
    },
    [analyzed, comp, applyComposition, phase, audio],
  );

  // sincronizar el motor de audio con cada cambio de pistas
  useEffect(() => {
    if (tracks.length) audio.updateTracks(tracks);
  }, [tracks, audio]);

  const onToggleStep = useCallback(
    (trackId: number, step: number) => {
      setTracks((prev) =>
        prev.map((t) => {
          if (t.id !== trackId) return t;
          const steps = [...t.steps];
          steps[step] = !steps[step];
          const pitches = [...t.pitches];
          const velocities = [...t.velocities];
          if (steps[step]) {
            if (!pitches[step]) {
              // paso nuevo: hereda el tono del paso con tono más cercano
              let nearest = '';
              for (let d = 1; d < pitches.length && !nearest; d++) {
                nearest = pitches[step - d] || pitches[step + d] || '';
              }
              pitches[step] = nearest || 'C4';
            }
            if (!velocities[step]) velocities[step] = 0.7;
          }
          return { ...t, steps, pitches, velocities };
        }),
      );
    },
    [],
  );

  const onToggleMute = useCallback((trackId: number) => {
    setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)));
  }, []);

  const onBpm = useCallback(
    (v: number) => {
      setBpm(v);
      setComp((c) => (c ? { ...c, bpm: v } : c)); // que el bpm editado sobreviva al derrumbe
      audio.setBpm(v);
    },
    [audio],
  );

  const reset = useCallback(() => {
    audio.stop();
    setPlaying(false);
    setPhase('intact');
    setAnalyzed(null);
    setComp(null);
    setTracks([]);
  }, [audio]);

  if (!analyzed || !comp) {
    return (
      <>
        <Landing onImage={(src) => void handleImage(src)} error={error} />
        {analyzing && <div className="analyzing">escuchando la imagen…</div>}
      </>
    );
  }

  const chordLabel = comp.chordNames.join(' · ');

  return (
    <div className="studio">
      <header className="topbar">
        <button className="logo-small" onClick={reset} title="Nueva imagen">
          CRATER<span className="logo-dot" />
        </button>
        <div className="comp-info">
          <span className="comp-key">
            {comp.rootName} {comp.modeName}
          </span>
          <span className="comp-chords">{chordLabel}</span>
        </div>
        <div className="controls">
          <label className="bpm">
            <span>{bpm} bpm</span>
            <input
              type="range"
              min={50}
              max={110}
              value={bpm}
              onChange={(e) => onBpm(Number(e.target.value))}
            />
          </label>
          <select
            className="sel"
            value={comp.rootPc}
            title="Nota raíz"
            onChange={(e) => regenerate({ rootPc: Number(e.target.value), modeName: comp.modeName })}
          >
            {SOLFEGE.map((n, i) => (
              <option key={n} value={i}>
                {n}
              </option>
            ))}
          </select>
          <select
            className="sel"
            value={comp.modeName}
            title="Modo"
            onChange={(e) => regenerate({ rootPc: comp.rootPc, modeName: e.target.value })}
          >
            {MODE_NAMES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => regenerate()} title="Nueva variación con la misma imagen">
            ⟳ reimaginar
          </button>
        </div>
      </header>

      <div className="stage">
        <SandCanvas
          analyzed={analyzed}
          audio={audio}
          phase={phase}
          walkMode={walkMode}
          character={character ?? 'lupa'}
          releaseOrder={releaseOrder}
          onGroupRelease={(pi) => {
            releasedRef.current.add(pi);
            audio.fadeInTrack(pi, 2.4);
          }}
          onCollapseDone={() => setPhase('collapsed')}
          onReformDone={() => {
            audio.stop();
            setPlaying(false);
            setPhase('intact');
          }}
          onEcoProgress={(collected, total) => setEcos({ collected, total })}
          onWin={() => setWon(true)}
        />
        {selecting && (
          <div className="win-overlay">
            <div className="win-card select-card">
              <span className="win-title">elige a tu custodio</span>
              <span className="win-sub">
                cruzarás el Marco para devolverle el Canto a este cuadro
              </span>
              <div className="char-grid">
                {CHARACTERS.map((c) => (
                  <button
                    key={c.id}
                    className="char-card"
                    onClick={() => {
                      setCharacter(c.id);
                      setSelecting(false);
                      setWalkMode(true);
                    }}
                  >
                    <img src={spriteDataUrl(c.id)} alt={c.name} />
                    <span className="char-name">{c.name}</span>
                    <span className="char-meta">
                      {c.species} · batita {c.flag}
                    </span>
                  </button>
                ))}
              </div>
              <button className="btn" onClick={() => setSelecting(false)}>
                mejor luego
              </button>
            </div>
          </div>
        )}
        {won && (
          <div className="win-overlay">
            <div className="win-card">
              <span className="win-title">✦ canto restaurado</span>
              <span className="win-sub">
                el hechizo de reconstrucción devolvió el color al lienzo; las dunas quedaron
                como arena de ceniza — la huella de lo que el cuadro perdió y recuperó
              </span>
              <div className="win-actions">
                <button className="btn" onClick={() => setWon(false)}>
                  seguir caminando
                </button>
                <button
                  className="btn primary"
                  onClick={() => {
                    setWon(false);
                    setWalkMode(false);
                  }}
                >
                  volver al estudio
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="transport">
        <button className="btn primary" onClick={() => void togglePlay()}>
          {phase === 'intact' ? '◈ derrumbar' : playing ? '❚❚ pausa' : '▶ reanudar'}
        </button>
        {phase === 'collapsed' && (
          <button
            className={`btn${walkMode ? '' : ' walk'}`}
            onClick={() => {
              if (walkMode) setWalkMode(false);
              else if (character) setWalkMode(true);
              else setSelecting(true);
            }}
          >
            {walkMode ? '◫ volver al estudio' : '⬡ entrar al cuadro'}
          </button>
        )}
        {walkMode && (
          <span className="eco-chip">
            ✦ orbes {ecos.collected}/{ecos.total}
          </span>
        )}
        {(phase === 'collapsed' || phase === 'collapsing') && !walkMode && (
          <button className="btn" onClick={reform}>
            ◇ reformar imagen
          </button>
        )}
        <div className="palette-strip">
          {analyzed.palette.map((p) => (
            <span key={p.code} className="chip" title={`${p.code} · ${Math.round(p.coverage * 100)}%`}>
              <i style={{ background: p.hex }} />
              {p.code}
            </span>
          ))}
        </div>
      </div>

      {!walkMode && (
        <Timeline
          tracks={tracks}
          currentStep={currentStep}
          playing={playing}
          onToggleStep={onToggleStep}
          onToggleMute={onToggleMute}
        />
      )}
    </div>
  );
}
