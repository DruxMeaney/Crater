import { memo } from 'react';
import { ROLE_LABELS, STEPS, STEPS_PER_BAR, type Track } from '../lib/types';

interface Props {
  tracks: Track[];
  currentStep: number;
  playing: boolean;
  onToggleStep: (trackId: number, step: number) => void;
  onToggleMute: (trackId: number) => void;
}

export const Timeline = memo(function Timeline({
  tracks,
  currentStep,
  playing,
  onToggleStep,
  onToggleMute,
}: Props) {
  return (
    <div className="timeline">
      {tracks.map((track) => (
        <div className={`tl-row${track.muted ? ' muted' : ''}`} key={track.id}>
          <div className="tl-head">
            <button
              className="tl-mute"
              title={track.muted ? 'Activar pista' : 'Silenciar pista'}
              onClick={() => onToggleMute(track.id)}
              style={{ borderColor: track.color.hex }}
            >
              <span className="tl-swatch" style={{ background: track.color.hex }} />
            </button>
            <div className="tl-label">
              <span className="tl-role">{ROLE_LABELS[track.role]}</span>
              <span className="tl-code">{track.color.code}</span>
            </div>
          </div>
          <div className="tl-steps">
            {Array.from({ length: STEPS }, (_, s) => {
              const active = track.steps[s];
              const isPlayhead = playing && s === currentStep;
              const barStart = s % STEPS_PER_BAR === 0;
              return (
                <button
                  key={s}
                  className={`tl-cell${active ? ' on' : ''}${isPlayhead ? ' ph' : ''}${barStart ? ' bar' : ''}`}
                  style={active ? { background: track.color.hex } : undefined}
                  title={active && track.pitches[s] ? track.pitches[s] : `paso ${s + 1}`}
                  onClick={() => onToggleStep(track.id, s)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
});
