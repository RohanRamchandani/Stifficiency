/**
 * dataPanel.js
 * Updates all the read-out elements in the right data panel.
 * The zone list uses a signature guard so it only rebuilds the DOM
 * when something actually changes — prevents buttons being destroyed
 * mid-click by the 60fps animation loop.
 */

import { palmToDepthPosition, saveZones } from './depthCalibration.js'

export class DataPanel {
  /**
   * @param {object} opts
   * @param {(zoneId: string) => void} opts.onSetDepth      Opens zone depth modal
   * @param {(zoneId: string) => void} opts.onClearDepth    Clears zone depth
   * @param {(zoneId: string) => void} opts.onDeleteZone    Deletes a zone
   */
  constructor(opts) {
    this._onSetDepth   = opts.onSetDepth
    this._onClearDepth = opts.onClearDepth
    this._onDeleteZone = opts.onDeleteZone

    // Expose to inline onclick handlers set in the zone list HTML
    window.__dp = this

    // Zone list signature — only rebuild HTML when content actually changes
    this._zoneSig = ''
  }

  /**
   * Call once per animation frame.
   * @param {PanelState} ps
   */
  update(ps) {
    this._updateDepthDisplay(ps)
    this._updatePalmBar(ps)
    this._updateReadouts(ps)
    this._updateCalibrationBlock(ps)
    this._updateZoneBlock(ps)
    this._updateDwellBar(ps)
    this._updateGracePill(ps)
  }

  // ─── Log helper (called from app.js) ──────────────────────────────────────
  log(msg, cls = '') {
    const log = document.getElementById('event-log')
    if (!log) return
    const ph = log.querySelector('div[style]'); if (ph) ph.remove()
    const t  = new Date().toTimeString().slice(0, 8)
    const el = document.createElement('div'); el.className = 'ei'
    el.innerHTML = `<span class="et">${t}</span><span class="${cls ? 'e' + cls : ''}">${msg}</span>`
    log.prepend(el)
    while (log.children.length > 40) log.removeChild(log.lastChild)
  }

  // ─── Individual sections ──────────────────────────────────────────────────
  _updateDepthDisplay(ps) {
    const dd = document.getElementById('depth-display')
    if (!dd) return
    if (!ps.landmarks) {
      dd.style.cssText = 'background:rgba(255,255,255,.02);color:#444'
      dd.textContent   = '— NO HAND —'
    } else if (!ps.calibration) {
      dd.style.cssText = 'background:rgba(255,255,255,.02);color:#555'
      dd.textContent   = '— UNCALIBRATED —'
    } else {
      const p = palmToDepthPosition(ps.palmSmooth, ps.calibration)
      if (p > 0.65) {
        dd.style.cssText = 'background:rgba(245,158,11,.08);color:#f59e0b'
        dd.textContent   = '▲ NEAR — Scanning'
      } else if (p < 0.35) {
        dd.style.cssText = 'background:rgba(34,197,94,.06);color:#22c55e'
        dd.textContent   = '▼ FAR — Placement'
      } else {
        dd.style.cssText = 'background:rgba(14,165,233,.06);color:#0ea5e9'
        dd.textContent   = '◆ MID RANGE'
      }
    }
  }

  _updatePalmBar(ps) {
    const cur = document.getElementById('pb-cur')
    const rng = document.getElementById('pb-range')
    if (!cur || !rng) return

    if (ps.calibration && ps.palmSmooth > 0) {
      cur.style.left    = palmToDepthPosition(ps.palmSmooth, ps.calibration) * 100 + '%'
      cur.style.display = 'block'

      if (ps.activeZone?.depthTarget) {
        const lo = palmToDepthPosition(ps.activeZone.depthTarget - ps.activeZone.depthTolerance, ps.calibration) * 100
        const hi = palmToDepthPosition(ps.activeZone.depthTarget + ps.activeZone.depthTolerance, ps.calibration) * 100
        rng.style.cssText = `left:${lo}%;width:${hi - lo}%;display:block`
      } else {
        rng.style.display = 'none'
      }
    } else {
      cur.style.display = 'none'
      rng.style.display = 'none'
    }
  }

  _updateReadouts(ps) {
    this._setText('d-palm',   ps.palmRaw    ? ps.palmRaw.toFixed(1)    + 'px' : '—')
    this._setText('d-smooth', ps.palmSmooth ? ps.palmSmooth.toFixed(1) + 'px' : '—')

    const hEl = document.getElementById('d-hand')
    if (hEl) {
      hEl.textContent = ps.handVisible ? 'Yes ●' : ps.gracePeriod ? 'Grace ◌' : 'No —'
      hEl.className   = 'dv ' + (ps.handVisible ? 'g' : ps.gracePeriod ? 'a' : 'm')
    }

    const gEl = document.getElementById('d-grace')
    if (gEl) {
      if (ps.gracePeriod) {
        const rem = Math.max(0, Math.round(ps.graceDuration - (performance.now() - ps.lastSeenMs)))
        gEl.textContent = rem + 'ms left'; gEl.className = 'dv a'
      } else {
        gEl.textContent = '—'; gEl.className = 'dv m'
      }
    }

    const mpEl = document.getElementById('d-mp')
    if (mpEl) {
      mpEl.textContent = ps.mpReady ? 'Ready ✓' : 'Loading…'
      mpEl.className   = 'dv ' + (ps.mpReady ? 'g' : 'm')
    }
  }

  _updateCalibrationBlock(ps) {
    if (!ps.calibration) return
    this._setText('d-near',  ps.calibration.nearPalmSize.toFixed(1) + 'px', 'dv a')
    this._setText('d-far',   ps.calibration.farPalmSize.toFixed(1)  + 'px', 'dv g')
    this._setText('d-ratio', ps.calibration.depthRatio.toFixed(2),          'dv')
  }

  _updateZoneBlock(ps) {
    // Active zone name
    const zEl = document.getElementById('d-zone')
    if (zEl) {
      zEl.textContent = ps.activeZone ? ps.activeZone.name : 'None'
      zEl.className   = 'dv ' + (ps.activeZone ? 'g' : 'm')
    }
    // Match mode
    const mmEl = document.getElementById('d-matchmode')
    if (mmEl) {
      if (!ps.activeZone) {
        mmEl.textContent = '—'; mmEl.className = 'dv m'
      } else if (!ps.activeZone.depthTarget || !ps.depthGating) {
        mmEl.textContent = '2D position only'; mmEl.className = 'dv a'
      } else {
        mmEl.textContent = 'Position + Depth ✓'; mmEl.className = 'dv g'
      }
    }
  }

  _updateDwellBar(ps) {
    const pct = Math.round(ps.dwellProgress * 100)
    this._setText('d-dwell', pct + '%')
    const bar = document.getElementById('dwell-bar')
    if (bar) bar.style.width = pct + '%'
  }

  _updateGracePill(ps) {
    const pill = document.getElementById('grace-pill')
    if (pill) pill.classList.toggle('show', ps.gracePeriod)
  }

  // ─── Zone list ─────────────────────────────────────────────────────────────
  /**
   * Builds a signature of visible zone state.
   * The HTML is only rebuilt when the signature changes —
   * this stops per-frame innerHTML replacement from destroying button elements
   * before mouseup/click events can fire.
   */
  renderZoneList(zones, activeZoneId, zdmCurrentZoneId, zdmSampling) {
    const sig = zones.map(z =>
      `${z.id}:${z.name}:${!!z.depthTarget}:${z.depthTolerance}:${z.id === activeZoneId}:${z.id === zdmCurrentZoneId && zdmSampling}`
    ).join('|') + '|n:' + zones.length

    if (sig === this._zoneSig) return
    this._zoneSig = sig

    const COLS = [
      '#6366f1','#0ea5e9','#f59e0b','#ec4899','#8b5cf6','#22c55e',
    ]

    const el = document.getElementById('zone-list')
    if (!el) return

    if (!zones.length) {
      el.innerHTML = '<div style="padding:10px;font-size:10px;color:var(--muted);text-align:center">No zones. Click "✎ Draw Zone".</div>'
      return
    }

    el.innerHTML = zones.map((z, i) => {
      const col        = COLS[i % COLS.length]
      const isActive   = z.id === activeZoneId
      const hasDepth   = !!z.depthTarget
      const isSampling = z.id === zdmCurrentZoneId && zdmSampling

      return `
        <div class="zi ${isActive ? 'active' : ''}">
          <div class="zi-top">
            <div class="zi-dot" style="background:${col}"></div>
            <div class="zi-name">${z.name}</div>
            ${isActive  ? '<span class="badge badge-active">active</span>' : ''}
            <span class="badge ${hasDepth ? 'badge-depth' : 'badge-nodepth'}">${hasDepth ? '◉ depth' : '○ 2D'}</span>
          </div>
          <div class="zi-actions">
            <button class="za depth${isSampling ? ' sampling' : ''}" onclick="window.__dp._onSetDepth('${z.id}')">
              ${hasDepth ? 'Re-set' : '📐 Set'} Depth
            </button>
            ${hasDepth ? `<button class="za" onclick="window.__dp._onClearDepth('${z.id}')">✕ Depth</button>` : ''}
            <button class="za del" onclick="window.__dp._onDeleteZone('${z.id}')">Delete</button>
          </div>
        </div>`
    }).join('')
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  _setText(id, text, cls) {
    const el = document.getElementById(id)
    if (!el) return
    el.textContent = text
    if (cls) el.className = cls
  }
}

/**
 * @typedef {Object} PanelState
 * @property {Array|null}       landmarks
 * @property {number}           palmRaw
 * @property {number}           palmSmooth
 * @property {number}           posX
 * @property {number}           posY
 * @property {boolean}          handVisible
 * @property {boolean}          gracePeriod
 * @property {number}           lastSeenMs
 * @property {number}           graceDuration
 * @property {boolean}          mpReady
 * @property {Calibration|null} calibration
 * @property {StorageZone|null} activeZone
 * @property {boolean}          depthGating
 * @property {number}           dwellProgress
 */
