import { useCallback, useEffect, useRef, useState } from 'react';

interface WeightPainterProps {
  targetUrl: string;
  brushSize: number;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

const CANVAS_RES = 512;
const PAINT_COLOR = 'rgba(100, 108, 255, 0.35)';

export function WeightPainter({
  targetUrl,
  brushSize,
  canvasRef,
}: WeightPainterProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [painting, setPainting] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = CANVAS_RES;
    canvas.height = CANVAS_RES;
  }, [canvasRef]);

  const getCanvasPos = useCallback(
    (e: React.PointerEvent): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * CANVAS_RES,
        y: ((e.clientY - rect.top) / rect.height) * CANVAS_RES,
      };
    },
    [canvasRef],
  );

  const drawDot = useCallback(
    (x: number, y: number) => {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      const radius = (brushSize / 100) * CANVAS_RES * 0.5;
      ctx.fillStyle = PAINT_COLOR;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    },
    [canvasRef, brushSize],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setPainting(true);
      const { x, y } = getCanvasPos(e);
      drawDot(x, y);
    },
    [getCanvasPos, drawDot],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!painting) return;
      const { x, y } = getCanvasPos(e);
      drawDot(x, y);
    },
    [painting, getCanvasPos, drawDot],
  );

  const onPointerUp = useCallback(() => {
    setPainting(false);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full" style={{ aspectRatio: '1' }}>
      <img
        src={targetUrl}
        alt="Target"
        className="absolute inset-0 block h-full w-full object-cover"
        draggable={false}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full cursor-crosshair touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
    </div>
  );
}

export function clearWeights(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}
