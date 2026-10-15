import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Barra de rolagem da página desenhada por cima do conteúdo.
 *
 * A barra nativa do navegador reserva uma faixa à direita pintada com cor sólida,
 * o que corta os gradientes que vão até a borda. A nativa fica oculta (ver
 * index.css) e esta a substitui visualmente. A rolagem continua 100% nativa
 * (roda do mouse, teclado, toque); aqui só se exibe a posição e se permite arrastar.
 */
export function OverlayScrollbar() {
  const [metrics, setMetrics] = useState({ visible: false, height: 0, top: 0 });
  const [active, setActive] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startY: number; startScroll: number } | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    let idleTimer = 0;

    // Leitura barata (duas medidas); o React agrupa as atualizações de estado.
    const measure = () => {
      const viewport = window.innerHeight;
      const total = root.scrollHeight;
      if (total <= viewport + 1) {
        setMetrics((m) => (m.visible ? { visible: false, height: 0, top: 0 } : m));
        return;
      }
      const height = Math.max(40, (viewport * viewport) / total);
      const top = (window.scrollY / (total - viewport)) * (viewport - height);
      setMetrics({ visible: true, height, top });
    };

    const wake = () => {
      setActive(true);
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => setActive(false), 1000);
    };
    const onScroll = () => {
      measure();
      wake();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.clientX >= window.innerWidth - 20) wake();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    measure();

    return () => {
      window.clearTimeout(idleTimer);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
      window.removeEventListener('pointermove', onPointerMove);
      observer.disconnect();
    };
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startScroll: window.scrollY };
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const viewport = window.innerHeight;
    const total = document.documentElement.scrollHeight;
    const ratio = (total - viewport) / Math.max(1, viewport - metrics.height);
    window.scrollTo({ top: drag.current.startScroll + (e.clientY - drag.current.startY) * ratio });
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  if (!metrics.visible) return null;
  const emphasized = active || dragging;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-y-0 right-0 z-[70] w-3.5">
      <div
        className={`hv-scroll-thumb pointer-events-auto absolute right-[3px] cursor-default rounded-full transition-[opacity,width,background-color] duration-200 ${
          emphasized ? 'w-2 bg-brand/70 opacity-100' : 'w-1.5 bg-brand/45 opacity-80'
        }`}
        style={{ height: metrics.height, transform: `translateY(${metrics.top}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerEnter={() => setActive(true)}
      />
    </div>
  );
}
