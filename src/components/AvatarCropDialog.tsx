import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { Loader2, Minus, Plus } from 'lucide-react';
import type { CropArea } from '@/lib/image';
import { FormError, Modal } from './Modal';

/** Lado da área de recorte: 288px, ou menos em celulares estreitos. */
const viewSize = () => Math.max(200, Math.min(288, window.innerWidth - 80));
const MAX_ZOOM = 4;

interface Frame {
  zoom: number;
  /** Canto superior esquerdo da imagem em relação à área de recorte (px de tela). */
  x: number;
  y: number;
}

/**
 * Enquadramento da foto antes do envio: arrastar move, a barra (ou a roda do
 * mouse, ou + e −) aproxima, e as setas do teclado ajustam. O círculo mostra
 * exatamente o que vai aparecer no perfil.
 */
export function AvatarCropDialog({
  file,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  file: File | null;
  busy: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (crop: CropArea) => void;
}) {
  const [view] = useState(viewSize);
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [frame, setFrame] = useState<Frame>({ zoom: 1, x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => {
    setSize(null);
    if (!file) return setUrl(null);
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  const base = size ? view / Math.min(size.w, size.h) : 1;
  const scaleOf = (zoom: number) => base * zoom;

  /** Mantém a imagem cobrindo todo o círculo (sem bordas vazias). */
  const clamp = (f: Frame): Frame => {
    if (!size) return f;
    const s = scaleOf(f.zoom);
    const w = size.w * s;
    const h = size.h * s;
    return { zoom: f.zoom, x: Math.min(0, Math.max(view - w, f.x)), y: Math.min(0, Math.max(view - h, f.y)) };
  };

  /** Aproxima mantendo o centro da área de recorte no mesmo ponto da foto. */
  const zoomTo = (zoom: number) =>
    setFrame((f) => {
      const next = Math.min(MAX_ZOOM, Math.max(1, zoom));
      const cx = (view / 2 - f.x) / scaleOf(f.zoom);
      const cy = (view / 2 - f.y) / scaleOf(f.zoom);
      return clamp({ zoom: next, x: view / 2 - cx * scaleOf(next), y: view / 2 - cy * scaleOf(next) });
    });

  const onLoad = (img: HTMLImageElement) => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const s = view / Math.min(w, h);
    setSize({ w, h });
    setFrame({ zoom: 1, x: (view - w * s) / 2, y: (view - h * s) / 2 });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: frame.x, y: frame.y };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setFrame((f) => clamp({ ...f, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }));
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => zoomTo(frame.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      setFrame((f) => clamp({ ...f, x: f.x + dx, y: f.y + dy }));
    } else if (e.key === '+' || e.key === '=') zoomTo(frame.zoom * 1.15);
    else if (e.key === '-') zoomTo(frame.zoom / 1.15);
  };

  const confirm = () => {
    if (!size) return;
    const s = scaleOf(frame.zoom);
    onConfirm({ x: -frame.x / s, y: -frame.y / s, size: view / s });
  };

  const s = scaleOf(frame.zoom);
  return (
    <Modal
      open={Boolean(file)}
      onOpenChange={(open) => !open && !busy && onCancel()}
      title="Ajustar foto"
      description="Arraste para enquadrar e use o controle para aproximar."
    >
      {error && <FormError message={error} />}
      <div className="flex flex-col items-center gap-5">
        <div
          role="application"
          tabIndex={0}
          aria-label="Área de recorte: arraste ou use as setas para mover; + e − para aproximar"
          className="relative cursor-grab touch-none select-none overflow-hidden rounded-xl bg-subtle active:cursor-grabbing"
          style={{ width: view, height: view }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
        >
          {url && (
            <img
              src={url}
              alt=""
              draggable={false}
              onLoad={(e) => onLoad(e.currentTarget)}
              className="pointer-events-none absolute left-0 top-0 max-w-none origin-top-left"
              style={size ? { width: size.w * s, height: size.h * s, transform: `translate(${frame.x}px, ${frame.y}px)` } : { opacity: 0 }}
            />
          )}
          {/* Fora do círculo escurece: o que fica claro é o que aparece no perfil. */}
          <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgb(0_0_0/0.55)] ring-2 ring-white/80" aria-hidden />
          {!size && (
            <div className="absolute inset-0 grid place-items-center text-muted" aria-hidden>
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
        </div>

        <div className="flex w-full max-w-[18rem] items-center gap-3">
          <button type="button" className="btn-ghost p-2" onClick={() => zoomTo(frame.zoom / 1.15)} aria-label="Afastar" disabled={!size}>
            <Minus className="h-4 w-4" />
          </button>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={frame.zoom}
            onChange={(e) => zoomTo(Number(e.target.value))}
            aria-label="Aproximação"
            className="flex-1 accent-[rgb(var(--brand))]"
            disabled={!size}
          />
          <button type="button" className="btn-ghost p-2" onClick={() => zoomTo(frame.zoom * 1.15)} aria-label="Aproximar" disabled={!size}>
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button type="button" className="btn-primary" onClick={confirm} disabled={busy || !size}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Salvar foto
        </button>
      </div>
    </Modal>
  );
}
