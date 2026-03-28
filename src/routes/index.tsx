import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type ImagifyResult, imagify, renderFrame } from '#/engine';

export const Route = createFileRoute('/')({ component: App });

const SIZE_OPTIONS = [8, 16, 32, 48, 64, 96, 128, 192, 256];
const EXACT_THRESHOLD = 2304;

function App() {
  const [size, setSize] = useState(32);
  const [phase, setPhase] = useState('');
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [animating, setAnimating] = useState(false);
  const [duration, setDuration] = useState(3);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resultRef = useRef<ImagifyResult | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const run = useCallback(async () => {
    cancelAnimationFrame(rafRef.current);
    setAnimating(false);
    setRunning(true);
    setElapsed(null);
    setMethod(null);
    resultRef.current = null;

    try {
      const result = await imagify(size, (p, pct) => {
        setPhase(p);
        setProgress(pct);
      });

      resultRef.current = result;

      const dest = canvasRef.current;
      if (dest) {
        dest.width = result.canvas.width;
        dest.height = result.canvas.height;
        dest.getContext('2d')!.drawImage(result.canvas, 0, 0);
      }
      setElapsed(result.elapsedMs);
      setMethod(result.method);
    } catch (err) {
      console.error('Imagify failed:', err);
    } finally {
      setRunning(false);
      setPhase('');
    }
  }, [size]);

  const animate = useCallback(() => {
    const result = resultRef.current;
    const canvas = canvasRef.current;
    if (!result || !canvas) return;

    cancelAnimationFrame(rafRef.current);
    setAnimating(true);

    const durationMs = duration * 1000;
    const startTime = performance.now();

    const tick = () => {
      const t = Math.min(1, (performance.now() - startTime) / durationMs);
      renderFrame(result, t, canvas);

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setAnimating(false);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [duration]);

  const stopAnimation = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setAnimating(false);

    const result = resultRef.current;
    const canvas = canvasRef.current;
    if (result && canvas) {
      renderFrame(result, 1, canvas);
    }
  }, []);

  const n = size * size;
  const isExact = n <= EXACT_THRESHOLD;
  const hasResult = resultRef.current !== null && !running;

  return (
    <main className="mx-auto max-w-2xl px-4 py-14">
      <h1 className="mb-6 text-2xl font-bold">Imagify</h1>

      <div className="mb-6 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Size ({size}&times;{size} = {n.toLocaleString()} pixels)
          <select
            value={size}
            disabled={running || animating}
            onChange={(e) => setSize(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
          >
            {SIZE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}&times;{s}
              </option>
            ))}
          </select>
        </label>

        <span className="pb-2 text-xs text-gray-500 dark:text-gray-400">
          {isExact
            ? 'Exact (Hungarian algorithm)'
            : 'Heuristic (Morton sort + 2-opt refinement)'}
        </span>

        <button
          onClick={run}
          disabled={running || animating}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {running ? 'Running...' : 'Run'}
        </button>
      </div>

      {running && (
        <div className="mb-6">
          <p className="mb-1 text-sm text-gray-500 dark:text-gray-400">
            {phase} ({Math.round(progress * 100)}%)
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-200"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
      )}

      {elapsed !== null && !running && (
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Completed in {(elapsed / 1000).toFixed(2)}s
          {method &&
            ` — ${method === 'exact' ? 'Hungarian (exact)' : 'Heuristic (sort + refine)'}`}
        </p>
      )}

      {hasResult && (
        <div className="mb-6 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Duration ({duration}s)
            <input
              type="range"
              min={0.5}
              max={10}
              step={0.5}
              value={duration}
              disabled={animating}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-36"
            />
          </label>

          {animating ? (
            <button
              onClick={stopAnimation}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={animate}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Animate
            </button>
          )}
        </div>
      )}

      <canvas
        ref={canvasRef}
        className="border border-gray-300 dark:border-gray-600"
        style={{ imageRendering: 'pixelated', width: 512, height: 512 }}
      />
    </main>
  );
}
