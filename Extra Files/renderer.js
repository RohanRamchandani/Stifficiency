/**
 * renderer.js
 * All canvas drawing: zone boxes, depth indicators, dwell ring, hand dot, depth badge.
 * Pure functions — pass in state, get pixels out.
 */

import { palmToDepthPosition } from './depthCalibration.js'

// ─── Zone colour palette ──────────────────────────────────────────────────────
const ZONE_COLORS = [
  { fill: 'rgba(99,102,241,.18)',  border: '#6366f1' },
  { fill: 'rgba(14,165,233,.18)',  border: '#0ea5e9' },
  { fill: 'rgba(245,158,11,.18)',  border: '#f59e0b' },
  { fill: 'rgba(236,72,153,.18)',  border: '#ec4899' },
  { fill: 'rgba(139,92,246,.18)',  border: '#8b5cf6' },
  { fill: 'rgba(34,197,94,.18)',   border: '#22c55e' },
]

// ─── Main draw entry point ────────────────────────────────────────────────────
/**
 * Clear and redraw the entire canvas every frame.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLVideoElement}  video
 * @param {RenderState}       rs
 */
export function renderFrame(canvas, video, rs) {
  const W = video.videoWidth  || canvas.offsetWidth  || 640
  const H = video.videoHeight || canvas.offsetHeight || 480

  if (canvas.width  !== W) canvas.width  = W
  if (canvas.height !== H) canvas.height = H

  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, W, H)

  rs.zones.forEach((zone, i) => drawZone(ctx, zone, i, W, H, rs))

  // Draw preview rectangle when user is dragging to create a new zone
  if (rs.drawPreview) {
    const { x1, y1, x2, y2 } = rs.drawPreview
    const px = Math.min(x1, x2) * W, py = Math.min(y1, y2) * H
    const pw = Math.abs(x2 - x1) * W, ph = Math.abs(y2 - y1) * H
    ctx.fillStyle = 'rgba(245,158,11,.08)'
    ctx.fillRect(px, py, pw, ph)
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.5
    ctx.strokeRect(px, py, pw, ph)
    ctx.setLineDash([])
  }

  drawDepthBadge(ctx, W, rs)
  drawHandDot(ctx, W, H, rs)
}

// ─── Individual zone ──────────────────────────────────────────────────────────
function drawZone(ctx, zone, index, W, H, rs) {
  const x = zone.x_min * W
  const y = zone.y_min * H
  const w = (zone.x_max - zone.x_min) * W
  const h = (zone.y_max - zone.y_min) * H
  const col    = ZONE_COLORS[index % ZONE_COLORS.length]
  const isActive = rs.activeZoneId === zone.id

  // Fill
  ctx.fillStyle = col.fill
  ctx.fillRect(x, y, w, h)

  // Border — green + glow when active
  ctx.save()
  ctx.strokeStyle = isActive ? '#22c55e' : col.border
  ctx.lineWidth   = isActive ? 2.5 : 1.5
  if (isActive) { ctx.shadowBlur = 10; ctx.shadowColor = '#22c55e' }
  ctx.strokeRect(x, y, w, h)
  ctx.restore()

  // Zone label with depth indicator (◉ = depth set, ○ = 2D only)
  ctx.save()
  ctx.font = '600 10px "JetBrains Mono",monospace'
  const hasDepth = !!zone.depthTarget
  const label = zone.name + (hasDepth ? ' ◉' : ' ○')
  const labelW = ctx.measureText(label).width + 16
  ctx.fillStyle    = 'rgba(0,0,0,.68)'
  ctx.fillRect(x, y, labelW, 20)
  ctx.fillStyle    = hasDepth ? '#0ea5e9' : '#d1d5db'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x + 8, y + 10)
  ctx.restore()

  // Per-zone depth bar on left edge
  // A vertical bar showing: the zone's accepted depth range (sky blue band)
  // and a live dot for where the current hand depth sits
  if (hasDepth && rs.calibration) {
    drawZoneDepthBar(ctx, zone, x, y, w, h, rs)
  }

  // Dwell progress ring
  if (isActive && rs.dwellProgress > 0) {
    drawDwellRing(ctx, x, y, w, h, rs.dwellProgress)
  }
}

function drawZoneDepthBar(ctx, zone, x, y, w, h, rs) {
  const barH = h * 0.55
  const barY = y + h * 0.22

  const lo = palmToDepthPosition(zone.depthTarget - zone.depthTolerance, rs.calibration)
  const hi = palmToDepthPosition(zone.depthTarget + zone.depthTolerance, rs.calibration)

  ctx.save()

  // Track background
  ctx.fillStyle = 'rgba(255,255,255,.05)'
  ctx.fillRect(x - 6, barY, 4, barH)

  // Accepted range band
  const ry  = barY + barH * (1 - hi)
  const rbh = barH * (hi - lo)
  ctx.fillStyle   = 'rgba(14,165,233,.2)'
  ctx.fillRect(x - 6, ry, 4, rbh)
  ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 1
  ctx.strokeRect(x - 6, ry, 4, rbh)

  // Live hand depth dot on bar
  if (rs.palmSmooth > 0) {
    const pos = palmToDepthPosition(rs.palmSmooth, rs.calibration)
    const dotY = barY + barH * (1 - pos)
    const inRange = Math.abs(rs.palmSmooth - zone.depthTarget) <= zone.depthTolerance
    ctx.fillStyle = inRange ? '#22c55e' : '#555'
    if (inRange) { ctx.shadowBlur = 6; ctx.shadowColor = '#22c55e' }
    ctx.beginPath()
    ctx.arc(x - 4, dotY, 4, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

// ─── Dwell ring ───────────────────────────────────────────────────────────────
function drawDwellRing(ctx, zx, zy, zw, zh, progress) {
  const cx  = zx + zw / 2
  const cy  = zy + zh / 2
  const r   = Math.min(zw, zh) / 2 + 11
  const col = progress >= 1 ? '#34d399' : '#22c55e'

  ctx.save()
  // Background track
  ctx.strokeStyle = 'rgba(34,197,94,.12)'; ctx.lineWidth = 4
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()

  // Progress arc
  ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.lineCap = 'round'
  ctx.shadowBlur = 10; ctx.shadowColor = col
  ctx.beginPath()
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2)
  ctx.stroke()

  // Label below ring
  ctx.font         = '600 10px "JetBrains Mono",monospace'
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'bottom'
  ctx.shadowBlur   = 5
  ctx.fillStyle    = col
  const label = progress >= 1 ? '✓ Confirmed' : `Hold ${Math.round(progress * 100)}%`
  ctx.fillText(label, cx, zy + zh + r + 4)
  ctx.restore()
}

// ─── Depth badge (top-right corner) ──────────────────────────────────────────
function drawDepthBadge(ctx, W, rs) {
  let text, color

  if (!rs.landmarks) {
    text = '○ NO HAND'; color = '#444'
  } else if (!rs.calibration) {
    text = '○ UNCAL'; color = '#555'
  } else {
    const p = palmToDepthPosition(rs.palmSmooth, rs.calibration)
    if (p > 0.65)      { text = '▲ NEAR'; color = '#f59e0b' }
    else if (p < 0.35) { text = '▼ FAR';  color = '#22c55e' }
    else               { text = '◆ MID';  color = '#0ea5e9' }
  }

  ctx.save()
  ctx.font = '600 10px "JetBrains Mono",monospace'
  const tw = ctx.measureText(text).width
  const bw = tw + 20, bh = 22, bx = W - bw - 10, by = 10

  roundRect(ctx, bx, by, bw, bh, 4)
  ctx.fillStyle   = 'rgba(0,0,0,.65)'; ctx.fill()
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke()

  ctx.fillStyle    = color
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  if (color !== '#555' && color !== '#444') { ctx.shadowBlur = 5; ctx.shadowColor = color }
  ctx.fillText(text, bx + bw / 2, by + bh / 2)
  ctx.restore()
}

// ─── Hand dot (palm centroid with crosshair) ──────────────────────────────────
function drawHandDot(ctx, W, H, rs) {
  if (!rs.landmarks || rs.palmSmooth < 1) return

  const cx  = rs.posX * W
  const cy  = rs.posY * H
  const col = rs.gracePeriod ? '#f59e0b' : '#22c55e'

  ctx.save()

  // Outer glow ring
  ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2)
  ctx.strokeStyle = col + '44'; ctx.lineWidth = 1.5; ctx.stroke()

  // Centre dot
  ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2)
  ctx.fillStyle = col; ctx.shadowBlur = 10; ctx.shadowColor = col; ctx.fill()

  // Crosshair arms
  ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.shadowBlur = 0
  ctx.beginPath(); ctx.moveTo(cx - 14, cy); ctx.lineTo(cx - 7,  cy); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx +  7, cy); ctx.lineTo(cx + 14, cy); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy -  7); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx, cy +  7); ctx.lineTo(cx, cy + 14); ctx.stroke()

  ctx.restore()
}

// ─── Helper ───────────────────────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

/**
 * @typedef {Object} RenderState
 * @property {StorageZone[]}    zones
 * @property {string|null}      activeZoneId
 * @property {number}           dwellProgress     0–1
 * @property {number}           palmSmooth
 * @property {number}           posX              0–1
 * @property {number}           posY              0–1
 * @property {boolean}          gracePeriod
 * @property {Array|null}       landmarks
 * @property {Calibration|null} calibration
 * @property {DrawPreview|null} drawPreview       null when not drawing
 *
 * @typedef {Object} DrawPreview
 * @property {number} x1
 * @property {number} y1
 * @property {number} x2
 * @property {number} y2
 */
