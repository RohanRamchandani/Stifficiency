import { useEffect, useCallback } from 'react';
import useCamera from '../../hooks/useCamera';
import './ZoneOverlay.css';

/**
 * Renders semi-transparent zone rectangles on a <canvas> that sits
 * right on top of the webcam feed.  The canvas auto-resizes via
 * ResizeObserver so zones always stay proportional.
 */
export default function ZoneOverlay() {
  const { canvasRef, zones, activeZone, mode } = useCamera();

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width: W, height: H } = canvas;

    ctx.clearRect(0, 0, W, H);

    // Only draw zones in setup or scanning mode
    if (mode === 'idle') return;

    zones.forEach((zone) => {
      const x = zone.x * W;
      const y = zone.y * H;
      const w = zone.w * W;
      const h = zone.h * H;
      const isActive = activeZone === zone.id;

      // Fill
      ctx.fillStyle = isActive
        ? hexToRgba(zone.color, 0.35)
        : hexToRgba(zone.color, 0.15);
      ctx.fillRect(x, y, w, h);

      // Border
      ctx.strokeStyle = zone.color;
      ctx.lineWidth = isActive ? 3 : 1.5;
      ctx.setLineDash(isActive ? [] : [6, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);

      // Label
      ctx.font = `600 ${Math.max(12, H * 0.025)}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 4;
      ctx.fillText(zone.label, x + 8, y + Math.max(18, H * 0.035));
      ctx.shadowBlur = 0;

      // Active glow outline
      if (isActive) {
        ctx.save();
        ctx.shadowColor = zone.color;
        ctx.shadowBlur = 18;
        ctx.strokeStyle = zone.color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
      }
    });
  }, [canvasRef, zones, activeZone, mode]);

  // Re-draw whenever deps change
  useEffect(() => {
    draw();
  }, [draw]);

  // Keep canvas size in sync with its CSS dimensions
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      canvas.width = width;
      canvas.height = height;
      draw();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [canvasRef, draw]);

  return <canvas ref={canvasRef} className="zone-overlay-canvas" />;
}

/* ── helpers ── */
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
