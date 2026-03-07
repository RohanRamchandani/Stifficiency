/**
 * zoneDrawUI.js
 * Handles the zone-drawing interaction: click-drag on the video canvas,
 * preview rectangle, name input, and saving the new zone.
 *
 * Requires in DOM:
 *   #draw-overlay       — transparent div over the video, shown in draw mode
 *   #zone-name-wrap     — floating input bar
 *   #zone-name-input
 *   #btn-draw           — the Draw Zone toggle button
 *   #camera-panel       — gets .draw-mode class while active
 */

import { saveZones } from './depthCalibration.js'

export class ZoneDrawUI {
  /**
   * @param {object} opts
   * @param {HTMLVideoElement} opts.video
   * @param {StorageZone[]}   opts.zones          Direct reference (mutated in place)
   * @param {() => string}    opts.generateId     Returns a new unique zone ID
   * @param {(zone: StorageZone) => void} opts.onZoneAdded
   */
  constructor(opts) {
    this._video       = opts.video
    this._zones       = opts.zones
    this._generateId  = opts.generateId
    this._onZoneAdded = opts.onZoneAdded

    this.drawMode    = false
    this.drawPreview = null   // { x1,y1,x2,y2 } normalised — fed to renderer

    this._drawStart      = null
    this._drawEnd        = null
    this._drawConfirming = false

    this._bindEvents()
  }

  // ─── Toggle ────────────────────────────────────────────────────────────────
  toggle() {
    this.drawMode = !this.drawMode
    this._drawStart      = null
    this._drawEnd        = null
    this._drawConfirming = false
    this.drawPreview     = null

    const panel = document.getElementById('camera-panel')
    const btn   = document.getElementById('btn-draw')

    if (this.drawMode) {
      panel.classList.add('draw-mode')
      btn.classList.add('active')
      btn.textContent = '✕ Cancel Draw'
    } else {
      panel.classList.remove('draw-mode')
      btn.classList.remove('active')
      btn.textContent = '✎ Draw Zone'
      document.getElementById('zone-name-wrap').classList.remove('show')
    }
  }

  cancel() {
    this._drawStart      = null
    this._drawEnd        = null
    this._drawConfirming = false
    this.drawPreview     = null
    document.getElementById('zone-name-wrap').classList.remove('show')
    this.drawMode = false
    document.getElementById('camera-panel').classList.remove('draw-mode')
    const btn = document.getElementById('btn-draw')
    btn.classList.remove('active')
    btn.textContent = '✎ Draw Zone'
  }

  save() {
    const name = document.getElementById('zone-name-input').value.trim()
                 || `Zone ${this._zones.length + 1}`
    const s = this._drawStart, e = this._drawEnd
    if (!s || !e) return

    const zone = {
      id:             this._generateId(),
      name,
      x_min:          Math.min(s.x, e.x),
      y_min:          Math.min(s.y, e.y),
      x_max:          Math.max(s.x, e.x),
      y_max:          Math.max(s.y, e.y),
      depthTarget:    null,
      depthTolerance: 20,
    }

    this._zones.push(zone)
    saveZones(this._zones)
    this._onZoneAdded(zone)
    this.cancel()
  }

  // ─── Events ────────────────────────────────────────────────────────────────
  _bindEvents() {
    const overlay = document.getElementById('draw-overlay')

    overlay.addEventListener('mousedown', e => {
      if (!this.drawMode || this._drawConfirming) return
      this._drawStart  = this._toNorm(e)
      this._drawEnd    = null
      this.drawPreview = null
    })

    overlay.addEventListener('mousemove', e => {
      if (!this._drawStart) return
      this._drawEnd    = this._toNorm(e)
      this.drawPreview = {
        x1: this._drawStart.x, y1: this._drawStart.y,
        x2: this._drawEnd.x,   y2: this._drawEnd.y,
      }
    })

    overlay.addEventListener('mouseup', e => {
      if (!this._drawStart) return
      this._drawEnd = this._toNorm(e)

      // Reject tiny drags
      const minW = 30 / (this._video.offsetWidth  || 640)
      const minH = 30 / (this._video.offsetHeight || 480)
      if (Math.abs(this._drawEnd.x - this._drawStart.x) < minW ||
          Math.abs(this._drawEnd.y - this._drawStart.y) < minH) {
        this._drawStart = null; this._drawEnd = null; this.drawPreview = null; return
      }

      this._drawConfirming = true
      const inp = document.getElementById('zone-name-input')
      inp.value = `Zone ${this._zones.length + 1}`
      document.getElementById('zone-name-wrap').classList.add('show')
      inp.focus(); inp.select()
    })

    document.getElementById('zone-name-input').addEventListener('keydown', e => {
      if (e.key === 'Enter')  this.save()
      if (e.key === 'Escape') this.cancel()
    })
  }

  _toNorm(mouseEvent) {
    const r = this._video.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (mouseEvent.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (mouseEvent.clientY - r.top)  / r.height)),
    }
  }
}
