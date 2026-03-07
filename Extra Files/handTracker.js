/**
 * handTracker.js
 * Wraps MediaPipe Hands. Exposes a live state object updated every frame.
 * Includes grace-period logic so brief hand-loss doesn't reset tracking.
 *
 * Requires MediaPipe CDN scripts in index.html:
 *   <script src="https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js"></script>
 *   <script src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js"></script>
 */

import {
  computePalmSize,
  computePalmCentroid,
  rollingAvg,
} from './depthCalibration.js'

// How many frames to smooth palm size over
const PALM_SMOOTH_WINDOW = 14
// How many frames to smooth position over
const POS_SMOOTH_WINDOW  = 12

export class HandTracker {
  /**
   * @param {HTMLVideoElement} videoElement  The shared camera video element
   * @param {object}          [opts]
   * @param {number}          [opts.minDetectionConfidence=0.65]
   * @param {number}          [opts.minTrackingConfidence=0.55]
   */
  constructor(videoElement, opts = {}) {
    this.video = videoElement

    // Live state — read from outside every frame
    this.state = {
      // Raw and smoothed palm size
      palmRaw:     0,
      palmSmooth:  0,
      // Smoothed palm centroid (0–1 normalised)
      posX:        0.5,
      posY:        0.5,
      // Landmark array (live or grace-frozen)
      landmarks:   null,
      // True only while MediaPipe actually sees a hand
      handVisible: false,
      // True while stale landmarks are held within grace window
      gracePeriod: false,
      // Timestamp of last real detection (performance.now)
      lastSeenMs:  0,
      // MediaPipe ready flag
      ready:       false,
    }

    // Internal smoothing buffers
    this._palmBuf = []
    this._posXBuf = []
    this._posYBuf = []
    // Last real landmarks (for grace period)
    this._liveLm = null

    this._mpHands  = null
    this._mpCamera = null

    this._opts = {
      minDetectionConfidence: opts.minDetectionConfidence ?? 0.65,
      minTrackingConfidence:  opts.minTrackingConfidence  ?? 0.55,
    }
  }

  // ─── Init ──────────────────────────────────────────────────────────────────
  /**
   * Load MediaPipe Hands and start processing.
   * Resolves when the model is ready.
   * @returns {Promise<void>}
   */
  init() {
    return new Promise((resolve, reject) => {
      if (typeof Hands === 'undefined') {
        console.warn('[HandTracker] MediaPipe Hands not found on window.')
        reject(new Error('MediaPipe Hands not loaded'))
        return
      }

      this._mpHands = new Hands({
        locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
      })
      this._mpHands.setOptions({
        maxNumHands:             1,
        modelComplexity:         0,    // 0 = lite (fast enough for real-time)
        minDetectionConfidence:  this._opts.minDetectionConfidence,
        minTrackingConfidence:   this._opts.minTrackingConfidence,
      })
      this._mpHands.onResults(r => this._onResults(r))

      this._mpHands.initialize()
        .then(() => {
          this.state.ready = true
          this._startCamera()
          resolve()
        })
        .catch(reject)
    })
  }

  _startCamera() {
    if (typeof Camera === 'undefined' || !this._mpHands) return
    if (this._mpCamera) this._mpCamera.stop()
    this._mpCamera = new Camera(this.video, {
      onFrame: async () => {
        if (this._mpHands && this.state.ready) {
          await this._mpHands.send({ image: this.video })
        }
      },
      width:  640,
      height: 480,
    })
    this._mpCamera.start()
  }

  // ─── MediaPipe callback ────────────────────────────────────────────────────
  _onResults(results) {
    const W = this.video.videoWidth  || 640
    const H = this.video.videoHeight || 480

    if (!results.multiHandLandmarks?.length) {
      this.state.handVisible = false
      return
    }

    const lm = results.multiHandLandmarks[0]
    this._liveLm          = lm
    this.state.handVisible = true
    this.state.lastSeenMs  = performance.now()
    this.state.landmarks   = lm

    // Palm size (depth proxy)
    this.state.palmRaw    = computePalmSize(lm, W, H)
    this.state.palmSmooth = rollingAvg(this._palmBuf, this.state.palmRaw, PALM_SMOOTH_WINDOW)

    // Centroid position — 5 landmarks averaged, far more stable than wrist alone
    const c = computePalmCentroid(lm)
    this.state.posX = rollingAvg(this._posXBuf, c.x, POS_SMOOTH_WINDOW)
    this.state.posY = rollingAvg(this._posYBuf, c.y, POS_SMOOTH_WINDOW)
  }

  // ─── Grace period ──────────────────────────────────────────────────────────
  /**
   * Call once per animation frame BEFORE reading state.
   * Holds last known position/depth for `graceDurationMs` after hand loss.
   *
   * @param {number} graceDurationMs
   */
  tick(graceDurationMs) {
    if (this.state.handVisible) {
      this.state.gracePeriod = false
      return
    }

    const elapsed = performance.now() - this.state.lastSeenMs

    if (this._liveLm && elapsed < graceDurationMs) {
      // Within window — freeze last known landmarks
      this.state.landmarks   = this._liveLm
      this.state.gracePeriod = true
    } else {
      // Grace expired — clear
      this.state.landmarks   = null
      this.state.gracePeriod = false
      // Gently decay palm smooth buffer rather than hard-zeroing
      if (this._palmBuf.length) this._palmBuf.shift()
    }
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────
  destroy() {
    if (this._mpCamera) this._mpCamera.stop()
    if (this._mpHands)  this._mpHands.close()
  }
}
