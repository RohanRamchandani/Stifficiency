/**
 * handTracker.js
 * Wraps MediaPipe Hands. Exposes a live state object updated each time
 * processFrame() is called from the host's animation loop.
 *
 * Does NOT use MediaPipe's Camera util — we call processFrame() directly
 * so it works with an already-running camera stream.
 *
 * Requires MediaPipe CDN scripts in index.html:
 *   <script src="https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js"></script>
 */

import {
    computePalmSize,
    computePalmCentroid,
    rollingAvg,
} from './depthCalibration.js'

const PALM_SMOOTH_WINDOW = 14
const POS_SMOOTH_WINDOW  = 12

export class HandTracker {
    /**
     * @param {HTMLVideoElement} videoElement  The already-running camera video
     * @param {object}          [opts]
     * @param {number}          [opts.minDetectionConfidence=0.65]
     * @param {number}          [opts.minTrackingConfidence=0.55]
     */
    constructor(videoElement, opts = {}) {
        this.video = videoElement

        // Public state — read each frame after calling processFrame()
        this.state = {
            palmRaw:     0,
            palmSmooth:  0,
            posX:        0.5,
            posY:        0.5,
            landmarks:   null,
            handVisible: false,
            gracePeriod: false,
            lastSeenMs:  0,
            ready:       false,
        }

        this._palmBuf   = []
        this._posXBuf   = []
        this._posYBuf   = []
        this._liveLm    = null
        this._mpHands   = null
        this._sending   = false  // prevent overlapping async sends

        this._opts = {
            minDetectionConfidence: opts.minDetectionConfidence ?? 0.65,
            minTrackingConfidence:  opts.minTrackingConfidence  ?? 0.55,
        }
    }

    // ─── Init ──────────────────────────────────────────────────────────────────
    /**
     * Load and initialize MediaPipe Hands.
     * @returns {Promise<void>}
     */
    init() {
        return new Promise((resolve, reject) => {
            if (typeof Hands === 'undefined') {
                const msg = '[HandTracker] MediaPipe Hands not found — check CDN script in index.html'
                console.warn(msg)
                reject(new Error(msg))
                return
            }

            this._mpHands = new Hands({
                locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
            })
            this._mpHands.setOptions({
                maxNumHands:            1,
                modelComplexity:        0,   // 'lite' — fastest
                minDetectionConfidence: this._opts.minDetectionConfidence,
                minTrackingConfidence:  this._opts.minTrackingConfidence,
            })
            this._mpHands.onResults(r => this._onResults(r))

            this._mpHands.initialize()
                .then(() => {
                    this.state.ready = true
                    console.log('[HandTracker] MediaPipe Hands ready')
                    resolve()
                })
                .catch(reject)
        })
    }

    // ─── Frame processing ──────────────────────────────────────────────────────
    /**
     * Send the current video frame to MediaPipe for processing.
     * Call this from your RAF/animation loop. Non-blocking — skips if a
     * previous send is still in flight to avoid queue buildup.
     */
    async processFrame() {
        if (!this._mpHands || !this.state.ready || this._sending) return
        if (!this.video || this.video.readyState < 2) return
        this._sending = true
        try {
            await this._mpHands.send({ image: this.video })
        } catch (_) {
            // ignore individual frame errors
        } finally {
            this._sending = false
        }
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
        this._liveLm           = lm
        this.state.handVisible = true
        this.state.lastSeenMs  = performance.now()
        this.state.landmarks   = lm

        this.state.palmRaw    = computePalmSize(lm, W, H)
        this.state.palmSmooth = rollingAvg(this._palmBuf, this.state.palmRaw, PALM_SMOOTH_WINDOW)

        const c = computePalmCentroid(lm)
        this.state.posX = rollingAvg(this._posXBuf, c.x, POS_SMOOTH_WINDOW)
        this.state.posY = rollingAvg(this._posYBuf, c.y, POS_SMOOTH_WINDOW)
    }

    // ─── Grace period ──────────────────────────────────────────────────────────
    /**
     * Hold last-known position/palm for graceDurationMs after hand loss.
     * Call once per frame BEFORE reading state for zone matching.
     */
    tick(graceDurationMs) {
        if (this.state.handVisible) {
            this.state.gracePeriod = false
            return
        }

        const elapsed = performance.now() - this.state.lastSeenMs

        if (this._liveLm && elapsed < graceDurationMs) {
            this.state.landmarks   = this._liveLm
            this.state.gracePeriod = true
        } else {
            this.state.landmarks   = null
            this.state.gracePeriod = false
            if (this._palmBuf.length) this._palmBuf.shift()
        }
    }

    // ─── Cleanup ───────────────────────────────────────────────────────────────
    destroy() {
        if (this._mpHands) this._mpHands.close()
    }
}
