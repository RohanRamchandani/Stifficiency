/**
 * app.js
 * Main entry point. Wires all modules together and runs the animation loop.
 *
 * Module roles:
 *   HandTracker     — MediaPipe, palm size, centroid, grace period
 *   ZoneTracker     — zone matching (position + per-zone depth), dwell timer
 *   renderer.js     — canvas drawing (zones, rings, hand dot, depth badge)
 *   CalibrationUI   — global two-step depth calibration modal
 *   ZoneDepthUI     — per-zone depth assignment modal
 *   ZoneDrawUI      — click-drag zone creation on video canvas
 *   DataPanel       — right-hand panel readouts + zone list
 */

import { HandTracker }     from './handTracker.js'
import { ZoneTracker }     from './zoneTracker.js'
import { renderFrame }     from './renderer.js'
import { CalibrationUI }   from './calibrationUI.js'
import { ZoneDepthUI }     from './zoneDepthUI.js'
import { ZoneDrawUI }      from './zoneDrawUI.js'
import { DataPanel }       from './dataPanel.js'
import {
  loadCalibration,
  loadZones,
  saveZones,
} from './depthCalibration.js'

// ─── Settings (adjusted via UI sliders / toggles) ───────────────────────────
const settings = {
  dwellMs:      1500,
  graceMs:      600,
  depthGating:  true,
}

// ─── Shared state ────────────────────────────────────────────────────────────
let zones       = []
let calibration = null
let zoneIdSeq   = 0
const makeId    = () => 'z' + (++zoneIdSeq)

// ─── Notify helper ───────────────────────────────────────────────────────────
function notify(msg, cls = '') {
  const area = document.getElementById('notif-area')
  if (!area) return
  const el = document.createElement('div')
  el.className   = 'notif ' + cls
  el.textContent = msg
  area.appendChild(el)
  setTimeout(() => el.remove(), 3300)
}

// ─── Module instantiation ─────────────────────────────────────────────────────
const video  = document.getElementById('video')
const canvas = document.getElementById('zone-canvas')

const hand = new HandTracker(video)

const zoneTracker = new ZoneTracker({
  depthGating: settings.depthGating,
})

const panel = new DataPanel({
  onSetDepth:   id => zoneDepthUI.open(id),
  onClearDepth: id => {
    const z = zones.find(z => z.id === id); if (!z) return
    z.depthTarget = null; z.depthTolerance = 20
    saveZones(zones)
    panel.log(`Depth cleared: "${z.name}"`, 'a')
  },
  onDeleteZone: id => {
    zones = zones.filter(z => z.id !== id)
    if (zoneTracker.activeZone?.id === id) zoneTracker.resetDwell()
    saveZones(zones)
    panel.log('Zone deleted')
  },
})

const calUI = new CalibrationUI({
  getPalmRaw:    () => hand.state.palmRaw,
  getHandVisible:() => hand.state.handVisible,
  getGracePeriod:() => hand.state.gracePeriod,
  onCalibrated:  cal => {
    if (cal) {
      calibration = cal
      panel.log(`Calibrated — range ${cal.farPalmSize.toFixed(0)}→${cal.nearPalmSize.toFixed(0)}px`, 'g')
    } else {
      notify('Depth calibration skipped — 2D mode only', 'amber')
    }
  },
})
window.__calUI = calUI   // CalibrationUI renders inline onclick= buttons that reference this

const zoneDepthUI = new ZoneDepthUI({
  getPalmRaw:     () => hand.state.palmRaw,
  getHandVisible: () => hand.state.handVisible,
  getGracePeriod: () => hand.state.gracePeriod,
  getPalmSmooth:  () => hand.state.palmSmooth,
  getCalibration: () => calibration,
  zones,
  onDepthSet: zone => {
    notify(`Depth set for "${zone.name}" ✓`, 'green')
    panel.log(`Depth set: "${zone.name}" → ${zone.depthTarget.toFixed(0)}px ±${zone.depthTolerance}px`, 'g')
  },
})
window.__zdmUI = zoneDepthUI  // inline onclick= references

const drawUI = new ZoneDrawUI({
  video,
  zones,
  generateId:  makeId,
  onZoneAdded: zone => {
    panel.log(`Zone added: "${zone.name}"`)
  },
})
window.__drawUI = drawUI   // referenced by zone-save-btn / zone-cancel-btn onclick in HTML

// ─── Camera ──────────────────────────────────────────────────────────────────
async function initCamera() {
  const offline = document.getElementById('cam-offline')
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    })
    video.srcObject = stream
    await new Promise(r => (video.onloadedmetadata = r))
    video.play()
    if (offline) offline.classList.remove('show')
    document.getElementById('topbar-status').textContent =
      'CAMERA ACTIVE · DEPTH-AWARE ZONE TRACKER'
    panel.log('Camera initialized', 'g')

    hand.init()
      .then(() => panel.log('MediaPipe Hands loaded', 'g'))
      .catch(() => panel.log('MediaPipe unavailable — 2D mode only', 'a'))
  } catch (e) {
    if (offline) offline.classList.add('show')
    video.style.display = 'none'
    document.getElementById('topbar-status').textContent = 'CAMERA UNAVAILABLE'
    panel.log('Camera error: ' + e.message, 'a')
  }
}

// ─── Animation loop ───────────────────────────────────────────────────────────
function loop() {
  // 1. Grace period tick — freeze or expire stale landmarks
  hand.tick(settings.graceMs)

  // 2. Zone matching
  zoneTracker.depthGating = settings.depthGating
  zoneTracker.matchZones(hand.state, zones)

  // 3. Dwell timer — returns confirmed zone if timer just completed
  const confirmed = zoneTracker.tickDwell(settings.dwellMs)
  if (confirmed) {
    const msg = `✓ Placement confirmed → ${confirmed.name}`
    notify(msg, 'green')
    panel.log(msg, 'g')
    // After confirmation, reset so the user can place again in the same zone
    // without holding until the next wave. Uncomment if desired:
    // zoneTracker.resetDwell()
  }

  // 4. Canvas render
  renderFrame(canvas, video, {
    zones,
    activeZoneId:  zoneTracker.activeZone?.id ?? null,
    dwellProgress: zoneTracker.dwellProgress,
    palmSmooth:    hand.state.palmSmooth,
    posX:          hand.state.posX,
    posY:          hand.state.posY,
    gracePeriod:   hand.state.gracePeriod,
    landmarks:     hand.state.landmarks,
    calibration,
    drawPreview:   drawUI.drawPreview,
  })

  // 5. Data panel
  panel.update({
    landmarks:    hand.state.landmarks,
    palmRaw:      hand.state.palmRaw,
    palmSmooth:   hand.state.palmSmooth,
    posX:         hand.state.posX,
    posY:         hand.state.posY,
    handVisible:  hand.state.handVisible,
    gracePeriod:  hand.state.gracePeriod,
    lastSeenMs:   hand.state.lastSeenMs,
    graceDuration:settings.graceMs,
    mpReady:      hand.state.ready,
    calibration,
    activeZone:   zoneTracker.activeZone,
    depthGating:  settings.depthGating,
    dwellProgress:zoneTracker.dwellProgress,
  })

  // 6. Zone list (signature-guarded inside DataPanel)
  panel.renderZoneList(
    zones,
    zoneTracker.activeZone?.id ?? null,
    zoneDepthUI.currentZoneId,
    zoneDepthUI.sampling,
  )

  // 7. Zone depth modal live tick (cursor position)
  zoneDepthUI.tick()

  requestAnimationFrame(loop)
}

// ─── Global UI button handlers (called by inline onclick in HTML) ─────────────
window.openCalibration = () => calUI.open()

window.toggleDrawMode  = () => drawUI.toggle()

window.clearAllZones   = () => {
  if (!zones.length) return
  zones.length = 0
  zoneTracker.resetDwell()
  saveZones(zones)
  panel.log('All zones cleared', 'a')
}

// Settings
window.onDwellChange     = v => { settings.dwellMs     = +v; document.getElementById('lbl-dwell').textContent  = (v / 1000).toFixed(1) + 's' }
window.onGraceChange     = v => { settings.graceMs     = +v; document.getElementById('lbl-grace').textContent  = v + 'ms' }
window.onDepthGateChange = v => { settings.depthGating = v  }

// Zone depth modal
window.zdmCapture   = () => zoneDepthUI.capture()
window.zdmTolChange = v => zoneDepthUI.toleranceChanged(v)
window.zdmClose     = () => zoneDepthUI.close()

// ─── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Load persisted calibration and zones
  calibration = loadCalibration()
  if (calibration) panel.log('Loaded saved calibration', 'g')

  const saved = loadZones()
  if (saved?.length) {
    saved.forEach(z => zones.push(z))
    panel.log(`Loaded ${zones.length} zones`)
  } else {
    // Default demo zones — remove for production
    zones.push({ id: makeId(), name: 'Shelf A', x_min: .04, y_min: .04, x_max: .46, y_max: .48, depthTarget: null, depthTolerance: 20 })
    zones.push({ id: makeId(), name: 'Shelf B', x_min: .54, y_min: .04, x_max: .96, y_max: .48, depthTarget: null, depthTolerance: 20 })
    zones.push({ id: makeId(), name: 'Bin 1',   x_min: .28, y_min: .58, x_max: .72, y_max: .96, depthTarget: null, depthTolerance: 20 })
  }

  initCamera()
  requestAnimationFrame(loop)

  if (!calibration) {
    setTimeout(() => notify('💡 Start with "⊕ Calibrate Depth" to enable per-zone depth', 'amber'), 2200)
  } else {
    setTimeout(() => notify('📐 Click "Set Depth" on each zone to assign its depth', 'amber'), 1200)
  }
})
