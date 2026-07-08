import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { makeDemos } from '../lib/demo';

interface Props {
  onImage: (src: string) => void;
  error: string | null;
}

const ACCEPTED = /^image\/(png|jpe?g|webp|gif|avif)$/;

export function Landing({ onImage, error }: Props) {
  const demos = useMemo(() => makeDemos(), []);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED.test(file.type)) {
      setLocalError('Ese archivo no parece una imagen (PNG, JPG, WebP, GIF o AVIF)');
      return;
    }
    setLocalError(null);
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    onImage(url);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  return (
    <div className="landing">
      <div className="landing-inner">
        <h1 className="logo">
          CRATER
          <span className="logo-dot" />
        </h1>
        <p className="tagline">
          Suelta una imagen y escúchala derrumbarse. Cada color es un acorde, cada píxel un grano
          de arena, cada columna un paso en el tiempo.
        </p>

        <label
          className={`dropzone${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = ''; // permitir reelegir el mismo archivo
            }}
          />
          <span className="dz-big">Arrastra tu PNG aquí</span>
          <span className="dz-small">o haz clic para elegir un archivo</span>
        </label>

        {(error ?? localError) && <p className="error">{error ?? localError}</p>}

        <div className="demos">
          <span className="demos-label">o excava uno de estos cráteres:</span>
          <div className="demo-grid">
            {demos.map((d) => (
              <button key={d.name} className="demo-card" onClick={() => onImage(d.dataUrl)}>
                <img src={d.dataUrl} alt={d.name} />
                <span>{d.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
