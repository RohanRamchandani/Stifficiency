/**
 * depthCalibration.js
 * Pure math utilities for palm-size-based depth inference.
 * No DOM. No side effects. Import and call as needed.
 */

const CAL_STORAGE_KEY = 'trackhive_cal_v3'
const ZONES_STORAGE_KEY = 'trackhive_zones_v3'

// Landmark indices used to compute palm centroid (MediaPipe Hands)
// Wrist + all four MCP knuckles — stable regardless of finger pose
export const PALM_CENTROID_LM = [0, 5, 9, 13, 17]

// ─── Palm size ───────────────────────────────────────────────────────────────
/**
 * Compute palm "height" in pixels: wrist (lm[0]) → middle-MCP (lm[9]).
 * Used as the depth proxy — larger = closer to camera.
 *
 * @param {Array<{x,y}>} landmarks   Normalised MediaPipe landmarks (0–1)
 * @param {number} videoWidth
 * @param {number} videoHeight
 * @returns {number} pixel distance
 */
export function computePalmSize(landmarks, videoWidth, videoHeight) {
  const dx = (landmarks[9].x - landmarks[0].x) * videoWidth
  const dy = (landmarks[9].y - landmarks[0].y) * videoHeight
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Compute the palm centroid from PALM_CENTROID_LM indices.
 * Returns normalised 0–1 coordinates — far more stable than raw wrist.
 *
 * @param {Array<{x,y}>} landmarks
 * @returns {{ x: number, y: number }}
 */
export function computePalmCentroid(landmarks) {
  let sx = 0, sy = 0
  PALM_CENTROID_LM.forEach(i => { sx += landmarks[i].x; sy += landmarks[i].y })
  return { x: sx / PALM_CENTROID_LM.length, y: sy / PALM_CENTROID_LM.length }
}

// ─── Calibration build / validate ───────────────────────────────────────────
/**
 * Build a calibration object from two sampled palm sizes.
 *
 * @param {number} nearPalmSize   Palm size when hand is CLOSE (scanning)
 * @param {number} farPalmSize    Palm size when hand is FAR (placement)
 * @returns {Calibration}
 */
export function buildCalibration(nearPalmSize, farPalmSize) {
  return {
    nearPalmSize,
    farPalmSize,
    threshold: (nearPalmSize + farPalmSize) / 2,
    depthRatio: farPalmSize / nearPalmSize,
    calibratedAt: Date.now(),
  }
}

/**
 * Validate that near/far are sufficiently different.
 * @param {Calibration} cal
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateCalibration(cal) {
  if (!cal) return { valid: false, reason: 'No calibration data.' }
  if (cal.depthRatio > 0.92) {
    return {
      valid: false,
      reason: `Near and far positions are too similar (ratio ${cal.depthRatio.toFixed(2)}). ` +
              'Hold much closer for Step 1 and reach much further for Step 2.',
    }
  }
  return { valid: true }
}

// ─── Depth position (0 = far, 1 = near) ─────────────────────────────────────
/**
 * Map a live palm size to a 0–1 position on the far→near scale.
 * Used to drive progress bars and per-zone depth matching.
 *
 * @param {number} palmSize
 * @param {Calibration} cal
 * @returns {number} 0.0 (far) … 1.0 (near), clamped
 */
export function palmToDepthPosition(palmSize, cal) {
  if (!cal || cal.nearPalmSize === cal.farPalmSize) return 0.5
  return Math.max(0, Math.min(1,
    (palmSize - cal.farPalmSize) / (cal.nearPalmSize - cal.farPalmSize)
  ))
}

/**
 * Check whether a palm size falls within a zone's depth target + tolerance.
 *
 * @param {number}      palmSize
 * @param {StorageZone} zone
 * @param {boolean}     depthGatingEnabled
 * @returns {boolean}
 */
export function palmMatchesZoneDepth(palmSize, zone, depthGatingEnabled) {
  if (!zone.depthTarget || !depthGatingEnabled) return true   // 2D-only fallback
  return Math.abs(palmSize - zone.depthTarget) <= zone.depthTolerance
}

// ─── Smoothing ───────────────────────────────────────────────────────────────
/**
 * Push a value into a rolling buffer and return the average.
 * Mutates `buf` in place.
 *
 * @param {number[]} buf
 * @param {number}   value
 * @param {number}   [windowSize=10]
 * @returns {number} smoothed value
 */
export function rollingAvg(buf, value, windowSize = 10) {
  buf.push(value)
  if (buf.length > windowSize) buf.shift()
  return buf.reduce((a, b) => a + b, 0) / buf.length
}

/**
 * Median of an array — used when sampling multiple frames for calibration.
 * @param {number[]} arr
 * @returns {number}
 */
export function median(arr) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// ─── Persistence ─────────────────────────────────────────────────────────────
export function saveCalibration(cal) {
  try { localStorage.setItem(CAL_STORAGE_KEY, JSON.stringify(cal)) } catch (_) {}
}
export function loadCalibration() {
  try {
    const r = localStorage.getItem(CAL_STORAGE_KEY)
    return r ? JSON.parse(r) : null
  } catch (_) { return null }
}
export function clearCalibration() {
  try { localStorage.removeItem(CAL_STORAGE_KEY) } catch (_) {}
}

export function saveZones(zones) {
  try { localStorage.setItem(ZONES_STORAGE_KEY, JSON.stringify(zones)) } catch (_) {}
}
export function loadZones() {
  try {
    const r = localStorage.getItem(ZONES_STORAGE_KEY)
    return r ? JSON.parse(r) : null
  } catch (_) { return null }
}

/**
 * @typedef {Object} Calibration
 * @property {number} nearPalmSize
 * @property {number} farPalmSize
 * @property {number} threshold
 * @property {number} depthRatio
 * @property {number} calibratedAt
 *
 * @typedef {Object} StorageZone
 * @property {string}      id
 * @property {string}      name
 * @property {number}      x_min        0–1 normalised
 * @property {number}      y_min
 * @property {number}      x_max
 * @property {number}      y_max
 * @property {number|null} depthTarget  null = 2D only
 * @property {number}      depthTolerance
 */
