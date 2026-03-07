/**
 * zoneDepthUI.js
 * Per-zone depth assignment modal.
 * The user positions their hand at the depth of a specific zone, captures,
 * and that zone's depthTarget is stored.
 *
 * Requires in DOM:
 *   #zdm-modal, #zdm-zone-tag, #zdm-warn, #zdm-prog, #zdm-pf, #zdm-pl
 *   #zdm-btn, #zdm-tol, #zdm-tol-val
 *   #dv-track, #dv-range, #dv-target, #dv-cursor
 *   #dv-far-lbl, #dv-near-lbl
 */

import { palmToDepthPosition, median, saveZones } from './depthCalibration.js'

const SAMPLE_DURATION_MS = 1200
const SAMPLE_INTERVAL_MS = 80

export class ZoneDepthUI {
  /**
   * @param {object} opts
   * @param {() => number}    opts.getPalmRaw
   * @param {() => boolean}   opts.getHandVisible
   * @param {() => boolean}   opts.getGracePeriod
   * @param {() => number}    opts.getPalmSmooth
   * @param {() => Calibration|null} opts.getCalibration
   * @param {StorageZone[]}   opts.zones            Direct reference to zones array
   * @param {() => void}      opts.onDepthSet       Called after a successful capture
   */
  constructor(opts) {
    this._getPalmRaw     = opts.getPalmRaw
    this._getHandVisible = opts.getHandVisible
    this._getGracePeriod = opts.getGracePeriod
    this._getPalmSmooth  = opts.getPalmSmooth
    this._getCal         = opts.getCalibration
    this._zones          = opts.zones
    this._onDepthSet     = opts.onDepthSet

    this._activeZoneId = null
    this._tolerance    = 20
    this._interval     = null
    this.sampling      = false
    this.currentZoneId = null  // publicly readable: which zone is open
  }

  // ─── Open / close ─────────────────────────────────────────────────────────
  open(zoneId) {
    const zone = this._zones.find(z => z.id === zoneId)
    if (!zone) return

    this._activeZoneId = zoneId
    this.currentZoneId = zoneId
    this._tolerance    = zone.depthTolerance ?? 20
    this.sampling      = false

    // Labels
    document.getElementById('zdm-zone-tag').textContent = zone.name
    document.getElementById('zdm-tol').value            = this._tolerance
    document.getElementById('zdm-tol-val').textContent  = `±${this._tolerance}px`

    // Calibration range labels
    const cal = this._getCal()
    if (cal) {
      document.getElementById('dv-far-lbl').textContent  = cal.farPalmSize.toFixed(0)
      document.getElementById('dv-near-lbl').textContent = cal.nearPalmSize.toFixed(0)
    }

    // Show existing target if already set
    const target = document.getElementById('dv-target')
    if (zone.depthTarget && cal) {
      target.style.left    = palmToDepthPosition(zone.depthTarget, cal) * 100 + '%'
      target.style.display = 'block'
      this._updateRangeBar(zone.depthTarget)
    } else {
      target.style.display = 'none'
      this._clearRangeBar()
    }

    // Reset UI state
    document.getElementById('zdm-warn').style.display = 'none'
    document.getElementById('zdm-prog').style.display = 'none'
    const btn = document.getElementById('zdm-btn')
    btn.style.display = 'block'
    btn.textContent   = '📐 Capture Depth at This Zone'

    document.getElementById('zdm-modal').classList.add('show')
  }

  close() {
    clearInterval(this._interval)
    this.sampling      = false
    this.currentZoneId = null
    this._activeZoneId = null
    document.getElementById('zdm-modal').classList.remove('show')
  }

  // ─── Called every animation frame while modal is open ────────────────────
  tick() {
    if (!document.getElementById('zdm-modal').classList.contains('show')) return

    const cal = this._getCal()
    if (!cal) return

    // Live cursor: shows current hand depth on the bar
    const pos = palmToDepthPosition(this._getPalmSmooth(), cal) * 100
    document.getElementById('dv-cursor').style.left = pos + '%'

    // Keep range bar in sync with current tolerance slider
    const zone = this._zones.find(z => z.id === this._activeZoneId)
    if (zone?.depthTarget) this._updateRangeBar(zone.depthTarget)
  }

  // ─── Tolerance slider ─────────────────────────────────────────────────────
  toleranceChanged(value) {
    this._tolerance = parseInt(value)
    document.getElementById('zdm-tol-val').textContent = `±${value}px`
    const zone = this._zones.find(z => z.id === this._activeZoneId)
    if (zone?.depthTarget) this._updateRangeBar(zone.depthTarget)
  }

  // ─── Capture ──────────────────────────────────────────────────────────────
  capture() {
    const handOk = this._getHandVisible() || this._getGracePeriod()
    if (!handOk) {
      document.getElementById('zdm-warn').style.display = 'block'
      return
    }

    this.sampling = true
    document.getElementById('zdm-warn').style.display = 'none'
    document.getElementById('zdm-btn').style.display  = 'none'
    document.getElementById('zdm-prog').style.display = 'block'

    const pf      = document.getElementById('zdm-pf')
    const pl      = document.getElementById('zdm-pl')
    const samples = []
    const start   = Date.now()

    this._interval = setInterval(() => {
      const elapsed = Date.now() - start
      const pct     = Math.min((elapsed / SAMPLE_DURATION_MS) * 100, 100)

      pf.style.width  = pct + '%'
      pl.textContent  = `Sampling… ${Math.round(pct)}%`

      const raw = this._getPalmRaw()
      if (raw > 5) samples.push(raw)

      if (elapsed >= SAMPLE_DURATION_MS) {
        clearInterval(this._interval)
        this.sampling = false
        document.getElementById('zdm-prog').style.display = 'none'

        if (samples.length < 3) {
          document.getElementById('zdm-warn').style.display = 'block'
          document.getElementById('zdm-btn').style.display  = 'block'
          return
        }

        const target = median(samples)
        const zone   = this._zones.find(z => z.id === this._activeZoneId)
        if (!zone) return

        // Apply captured depth + current tolerance to zone
        zone.depthTarget    = target
        zone.depthTolerance = this._tolerance

        // Update visualiser
        const cal = this._getCal()
        if (cal) {
          const tgtEl = document.getElementById('dv-target')
          tgtEl.style.left    = palmToDepthPosition(target, cal) * 100 + '%'
          tgtEl.style.display = 'block'
          this._updateRangeBar(target)
        }

        // Persist and notify
        saveZones(this._zones)
        this._onDepthSet(zone)

        // Reset button to allow recapture
        const btn = document.getElementById('zdm-btn')
        btn.style.display = 'block'
        btn.textContent   = '↺ Recapture'
      }
    }, SAMPLE_INTERVAL_MS)
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────
  _updateRangeBar(target) {
    const cal = this._getCal()
    if (!cal) return
    const lo = Math.max(0, palmToDepthPosition(target - this._tolerance, cal)) * 100
    const hi = Math.min(100, palmToDepthPosition(target + this._tolerance, cal)) * 100
    const r  = document.getElementById('dv-range')
    r.style.left  = lo + '%'
    r.style.width = (hi - lo) + '%'
  }

  _clearRangeBar() {
    const r = document.getElementById('dv-range')
    r.style.left  = '0%'
    r.style.width = '0%'
  }
}
