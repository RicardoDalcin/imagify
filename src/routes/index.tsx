import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type ImagifyResult, imagify, renderFrame } from '#/engine';
import { WeightPainter, clearWeights } from '#/components/WeightPainter';

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
  const [brushSize, setBrushSize] = useState(8);

  const [sourceBlob, setSourceBlob] = useState<Blob | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [targetBlob, setTargetBlob] = useState<Blob | null>(null);
  const [targetUrl, setTargetUrl] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paintRef = useRef<HTMLCanvasElement>(null);
  const resultRef = useRef<ImagifyResult | null>(null);
  const rafRef = useRef<number>(0);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const targetInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      if (targetUrl) URL.revokeObjectURL(targetUrl);
    };
  }, []);

  const handleSourceUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      const blob = file as Blob;
      const url = URL.createObjectURL(blob);
      setSourceBlob(blob);
      setSourceUrl(url);
      resultRef.current = null;
    },
    [sourceUrl],
  );

  const handleTargetUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (targetUrl) URL.revokeObjectURL(targetUrl);
      const blob = file as Blob;
      const url = URL.createObjectURL(blob);
      setTargetBlob(blob);
      setTargetUrl(url);
      clearWeights(paintRef.current);
      resultRef.current = null;
    },
    [targetUrl],
  );

  const run = useCallback(async () => {
    if (!sourceBlob || !targetBlob) return;
    cancelAnimationFrame(rafRef.current);
    setAnimating(false);
    setRunning(true);
    setElapsed(null);
    setMethod(null);
    resultRef.current = null;

    try {
      const result = await imagify(
        sourceBlob,
        targetBlob,
        paintRef.current,
        size,
        (p, pct) => {
          setPhase(p);
          setProgress(pct);
        },
      );

      resultRef.current = result;

      const dest = canvasRef.current;
      if (dest) {
        renderFrame(result, 0, dest);
      }
      setElapsed(result.elapsedMs);
      setMethod(result.method);
    } catch (err) {
      console.error('Imagify failed:', err);
    } finally {
      setRunning(false);
      setPhase('');
    }
  }, [sourceBlob, targetBlob, size]);

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
  const canCompute = !!sourceBlob && !!targetBlob && !running && !animating;

  return (
    <main className="page-wrap py-12 lg:py-20">
      {/* ---- Input grid: source + target/weights ---- */}
      <div className="rise-in grid-frame grid-frame-top grid grid-cols-1 lg:grid-cols-2">
        {/* Source upload */}
        <div className="grid-cell border-b border-(--line) lg:border-r lg:border-b-0">
          <input
            ref={sourceInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleSourceUpload}
          />
          {sourceUrl ? (
            <div
              className="upload-zone-filled"
              onClick={() => sourceInputRef.current?.click()}
            >
              <img
                src={sourceUrl}
                alt="Source"
                className="block w-full object-cover"
                style={{ aspectRatio: '1' }}
                draggable={false}
              />
              <span className="upload-overlay-label">Change source</span>
            </div>
          ) : (
            <div
              className="upload-zone"
              onClick={() => sourceInputRef.current?.click()}
            >
              <span className="kicker">Source</span>
              <span className="mt-2 text-sm text-(--text-2)">
                Click to upload
              </span>
            </div>
          )}
        </div>

        {/* Target upload + weight painting */}
        <div className="grid-cell border-b border-(--line) lg:border-b-0">
          <input
            ref={targetInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleTargetUpload}
          />
          {targetUrl ? (
            <div className="flex flex-col">
              <WeightPainter
                targetUrl={targetUrl}
                brushSize={brushSize}
                canvasRef={paintRef}
              />
              <div className="flex items-center gap-3 border-t border-(--line) px-4 py-2.5">
                <span className="font-mono text-xs text-(--text-2) shrink-0">
                  brush: {brushSize}
                </span>
                <input
                  type="range"
                  min={2}
                  max={30}
                  step={1}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                  className="range-input flex-1"
                />
                <button
                  type="button"
                  className="btn-secondary px-2.5 py-1 text-xs"
                  onClick={() => clearWeights(paintRef.current)}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="btn-secondary px-2.5 py-1 text-xs"
                  onClick={() => targetInputRef.current?.click()}
                >
                  Change
                </button>
              </div>
            </div>
          ) : (
            <div
              className="upload-zone"
              onClick={() => targetInputRef.current?.click()}
            >
              <span className="kicker">Target</span>
              <span className="mt-2 text-sm text-(--text-2)">
                Click to upload
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ---- Output grid: result canvas + controls ---- */}
      <div className="rise-in grid-frame grid-frame-bottom grid grid-cols-1 lg:grid-cols-12" style={{ animationDelay: '60ms' }}>
        {/* Canvas */}
        <div className="grid-cell border-b border-(--line) lg:col-span-8 lg:row-span-3 lg:border-r lg:border-b-0">
          <canvas
            ref={canvasRef}
            className="block w-full bg-(--bg-soft)"
            style={{ imageRendering: 'pixelated', aspectRatio: '1' }}
          />
        </div>

        {/* Config */}
        <div className="grid-cell flex flex-col gap-4 border-b border-(--line) p-5 lg:col-span-4 lg:border-b">
          <span className="kicker">Configuration</span>

          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-(--text-2)">size</span>
            <select
              value={size}
              disabled={running || animating}
              onChange={(e) => setSize(Number(e.target.value))}
              className="select-input"
            >
              {SIZE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s} &times; {s}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-2 font-mono text-xs text-(--text-2)">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: isExact ? 'var(--accent)' : 'var(--green)' }}
            />
            {isExact ? 'kuhn-munkres (exact)' : 'morton + 2-opt (heuristic)'}
          </div>

          <button
            onClick={run}
            disabled={!canCompute}
            className="btn-primary mt-auto w-full"
          >
            {running ? 'Computing\u2026' : 'Compute'}
          </button>
        </div>

        {/* Output */}
        <div className="grid-cell flex flex-col gap-3 border-b border-(--line) p-5 lg:col-span-4 lg:border-b">
          <span className="kicker">Output</span>

          {running ? (
            <div className="flex flex-1 flex-col justify-center gap-2">
              <div className="font-mono text-xs text-(--text-2)">
                {phase} &mdash; {Math.round(progress * 100)}%
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-(--line)">
                <div
                  className="h-full rounded-full bg-(--accent) transition-all duration-200"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>
          ) : hasResult ? (
            <div className="code-block">
              {'{'}<br />
              &nbsp;&nbsp;<span className="key">elapsed</span>:{' '}
              <span className="num">{(elapsed! / 1000).toFixed(2)}</span>s,<br />
              &nbsp;&nbsp;<span className="key">method</span>:{' '}
              <span className="str">
                &quot;{method === 'exact' ? 'hungarian' : 'heuristic'}&quot;
              </span>,<br />
              &nbsp;&nbsp;<span className="key">pixels</span>:{' '}
              <span className="num">{n.toLocaleString()}</span><br />
              {'}'}
            </div>
          ) : (
            <p className="code-block comment">
              {sourceBlob && targetBlob
                ? '// ready to compute'
                : '// upload both images first'}
            </p>
          )}
        </div>

        {/* Animation */}
        <div className="grid-cell flex flex-col gap-4 p-5 lg:col-span-4">
          <span className="kicker">Animation</span>

          <label className="flex flex-col gap-2">
            <span className="font-mono text-xs text-(--text-2)">
              duration: {duration}s
            </span>
            <input
              type="range"
              min={0.5}
              max={10}
              step={0.5}
              value={duration}
              disabled={animating || !hasResult}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="range-input"
            />
          </label>

          {animating ? (
            <button onClick={stopAnimation} className="btn-danger mt-auto w-full">
              Stop
            </button>
          ) : (
            <button
              onClick={animate}
              disabled={!hasResult}
              className="btn-secondary mt-auto w-full"
            >
              Animate
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
