/**
 * calibrationUI.js
 * Drives the two-step global depth calibration modal.
 *
 * Expects these elements in the DOM (see index.html):
 *   #cal-modal         — the modal container (.modal-bg)
 *   #cal-body          — inner content area (rebuilt per step)
 *   #dot-1 #dot-2 #dot-3  — step indicator dots
 *   #line-1 #line-2       — step indicator lines
 */

import {
  buildCalibration,
  validateCalibration,
  saveCalibration,
  median,
} from './depthCalibration.js'

const SAMPLE_DURATION_MS = 1200
const SAMPLE_INTERVAL_MS = 80

export class CalibrationUI {
  /**
   * @param {object} opts
   * @param {() => number} opts.getPalmRaw     Callback returning current raw palm size
   * @param {() => boolean} opts.getHandVisible  Callback returning current hand visibility
   * @param {() => boolean} opts.getGracePeriod
   * @param {(cal: Calibration) => void} opts.onCalibrated  Called with result on success
   */
  constructor(opts) {
    this._getPalmRaw     = opts.getPalmRaw
    this._getHandVisible = opts.getHandVisible
    this._getGracePeriod = opts.getGracePeriod
    this._onCalibrated   = opts.onCalibrated

    this._phase   = 'idle'  // 'near' | 'far' | 'error' | 'done'
    this._nearVal = null
    this._farVal  = null
    this._interval = null
  }

  // ─── Public API ─────────────────────────────────────────────────────────────
  open() {
    this._phase   = 'near'
    this._nearVal = null
    this._farVal  = null
    this._render()
    document.getElementById('cal-modal').classList.add('show')
  }

  close() {
    clearInterval(this._interval)
    document.getElementById('cal-modal').classList.remove('show')
  }

  // ─── Rendering ──────────────────────────────────────────────────────────────
  _render() {
    const body = document.getElementById('cal-body')

    // Step dots
    const phase = this._phase
    this._setDot('dot-1',  phase === 'near' ? 'active' : this._nearVal ? 'done' : '')
    this._setDot('dot-2',  phase === 'far'  ? 'active' : this._farVal  ? 'done' : '')
    this._setDot('dot-3',  phase === 'done' ? 'done'   : '')
    this._setLine('line-1', this._nearVal ? 'done' : '')
    this._setLine('line-2', this._farVal  ? 'done' : '')

    if (phase === 'near') {
      body.innerHTML = `
        <div class="instr-box">
          <div class="instr-icon">🤚</div>
          <div class="instr-title">Step 1 — Scanning Distance</div>
          <div class="instr-body">Hold your hand <strong>close to the camera</strong> — exactly where you hold an item to scan it. Keep it steady, then press Capture.</div>
        </div>
        <div id="cal-warn" class="mwarn" style="display:none">✋ No hand detected — make sure your hand is visible.</div>
        <div id="cal-prog" style="display:none">
          <div class="prog-wrap"><div class="prog-fill" id="cal-pf" style="width:0%"></div><span class="prog-label" id="cal-pl">Sampling…</span></div>
        </div>
        <button class="mbtn amber" id="cal-capture-btn" onclick="window.__calUI.capture()">📸 Capture Close Position</button>
        <button class="mskip" onclick="window.__calUI.skip()">Skip (2D mode only)</button>`

    } else if (phase === 'far') {
      body.innerHTML = `
        <div class="instr-box">
          <div class="instr-icon">🙌</div>
          <div class="instr-title">Step 2 — Furthest Placement Distance</div>
          <div class="instr-body">Reach your hand to your <strong>furthest shelf or zone</strong>. Keep it steady, then press Capture.</div>
        </div>
        <div id="cal-warn" class="mwarn" style="display:none">✋ No hand detected — make sure your hand is visible.</div>
        <div id="cal-prog" style="display:none">
          <div class="prog-wrap"><div class="prog-fill" id="cal-pf" style="width:0%"></div><span class="prog-label" id="cal-pl">Sampling…</span></div>
        </div>
        <button class="mbtn amber" id="cal-capture-btn" onclick="window.__calUI.capture()">📸 Capture Far Position</button>`

    } else if (phase === 'error') {
      body.innerHTML = `
        <div class="merror" id="cal-err-msg"></div>
        <button class="mbtn amber" onclick="window.__calUI.open()">↺ Try Again</button>
        <button class="mskip" onclick="window.__calUI.skip()">Skip</button>`

    } else if (phase === 'done') {
      body.innerHTML = `
        <div class="msuccess">
          <span class="sico">✅</span>
          <p>Depth calibrated!</p>
          <small id="cal-summary"></small>
        </div>
        <button class="mbtn green" onclick="window.__calUI.close()">Continue →</button>`
    }
  }

  // ─── Capture step ──────────────────────────────────────────────────────────
  capture() {
    const handOk = this._getHandVisible() || this._getGracePeriod()
    if (!handOk) {
      const w = document.getElementById('cal-warn')
      if (w) w.style.display = 'block'
      return
    }

    const warn    = document.getElementById('cal-warn')
    const prog    = document.getElementById('cal-prog')
    const captBtn = document.getElementById('cal-capture-btn')
    const pf      = document.getElementById('cal-pf')
    const pl      = document.getElementById('cal-pl')

    if (warn)    warn.style.display    = 'none'
    if (prog)    prog.style.display    = 'block'
    if (captBtn) captBtn.style.display = 'none'

    const samples = []
    const start   = Date.now()

    this._interval = setInterval(() => {
      const elapsed = Date.now() - start
      const pct     = Math.min((elapsed / SAMPLE_DURATION_MS) * 100, 100)

      if (pf) pf.style.width  = pct + '%'
      if (pl) pl.textContent  = `Sampling… ${Math.round(pct)}%`

      const raw = this._getPalmRaw()
      if (raw > 5) samples.push(raw)

      if (elapsed >= SAMPLE_DURATION_MS) {
        clearInterval(this._interval)

        if (samples.length < 3) {
          if (warn)    warn.style.display    = 'block'
          if (captBtn) captBtn.style.display = 'block'
          if (prog)    prog.style.display    = 'none'
          if (pf)      pf.style.width        = '0%'
          return
        }

        const result = median(samples)
        if (this._phase === 'near') {
          this._nearVal = result
          this._phase   = 'far'
          this._render()
        } else {
          this._farVal = result
          this._validate()
        }
      }
    }, SAMPLE_INTERVAL_MS)
  }

  skip() {
    this.close()
    // Caller can listen for this via onCalibrated returning null
    this._onCalibrated(null)
  }

  // ─── Validation ────────────────────────────────────────────────────────────
  _validate() {
    const cal = buildCalibration(this._nearVal, this._farVal)
    const { valid, reason } = validateCalibration(cal)

    if (!valid) {
      this._phase = 'error'
      this._render()
      const errEl = document.getElementById('cal-err-msg')
      if (errEl) errEl.textContent = reason
      return
    }

    saveCalibration(cal)
    this._phase = 'done'
    this._render()

    const sumEl = document.getElementById('cal-summary')
    if (sumEl) {
      sumEl.textContent = `Near: ${this._nearVal.toFixed(0)}px · Far: ${this._farVal.toFixed(0)}px`
    }

    this._onCalibrated(cal)
  }

  // ─── DOM helpers ────────────────────────────────────────────────────────────
  _setDot(id, state) {
    const el = document.getElementById(id)
    if (!el) return
    el.className = 'step-dot' + (state ? ' ' + state : '')
  }

  _setLine(id, state) {
    const el = document.getElementById(id)
    if (!el) return
    el.className = 'step-line' + (state ? ' ' + state : '')
  }
}
