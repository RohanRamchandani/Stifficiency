# TrackHive — Depth-Aware Zone Tracker
## Module Reference

Drop these files into any web project. Serve with any static server (no bundler needed — uses native ES modules).

---

## File Structure

```
index.html              ← Shell: all DOM structure, no logic
styles.css              ← All CSS (variables, layout, modals, data panel)
js/
  app.js                ← Entry point. Wires everything. Run loop lives here.
  depthCalibration.js   ← Pure math: palm size, centroid, depth position, storage
  handTracker.js        ← MediaPipe wrapper + grace period
  zoneTracker.js        ← Zone matching (2D + depth) + dwell timer
  renderer.js           ← Canvas drawing: zones, rings, hand dot, depth badge
  calibrationUI.js      ← Global two-step calibration modal
  zoneDepthUI.js        ← Per-zone depth assignment modal
  zoneDrawUI.js         ← Click-drag zone creation
  dataPanel.js          ← Right panel readouts + signature-guarded zone list
```

---

## How To Run

Any static file server works. Examples:

```bash
# Python
python3 -m http.server 8080

# Node
npx serve .

# VS Code
# Use the Live Server extension and open index.html
```

Open `http://localhost:8080` in **Chrome** (required for MediaPipe + Web Speech API).

---

## Module Responsibilities

### `depthCalibration.js`
Pure functions only. No DOM. Handles:
- `computePalmSize(landmarks, W, H)` — wrist→MCP pixel distance
- `computePalmCentroid(landmarks)` — 5-landmark average for stable position
- `palmToDepthPosition(palmSize, cal)` — maps palm size to 0 (far) → 1 (near)
- `palmMatchesZoneDepth(palmSize, zone, enabled)` — true if hand is in zone's depth band
- `buildCalibration(near, far)` / `validateCalibration(cal)` — build + validate
- `saveCalibration / loadCalibration / saveZones / loadZones` — localStorage

### `handTracker.js`
Wraps MediaPipe Hands. Call:
```js
const hand = new HandTracker(videoElement)
await hand.init()           // loads model, starts camera util
hand.tick(graceDurationMs)  // call every frame before reading state
hand.state                  // { palmRaw, palmSmooth, posX, posY, landmarks, handVisible, gracePeriod, ... }
```

**Grace period**: when MediaPipe loses the hand briefly, `tick()` holds the last known position for `graceDurationMs` ms before clearing. Prevents jitter from lighting changes or fast movement.

**Position stability**: uses 5-landmark palm centroid (wrist + 4 MCP knuckles) smoothed over 12 frames — not raw wrist, which jumps with finger movement.

### `zoneTracker.js`
```js
const zt = new ZoneTracker({ depthGating: true })
zt.matchZones(hand.state, zones)       // updates zt.activeZone
const confirmed = zt.tickDwell(1500)   // returns zone object if timer completed
zt.dwellProgress                        // 0–1
zt.resetDwell()                         // call after logging placement
```

Zones without a `depthTarget` match on 2D position only. Zones with `depthTarget` also check `Math.abs(palmSmooth - depthTarget) <= depthTolerance`.

### `renderer.js`
```js
renderFrame(canvas, video, renderState)
```
`renderState` contains: `zones`, `activeZoneId`, `dwellProgress`, `palmSmooth`, `posX`, `posY`, `gracePeriod`, `landmarks`, `calibration`, `drawPreview`.

### `calibrationUI.js`
```js
const calUI = new CalibrationUI({ getPalmRaw, getHandVisible, getGracePeriod, onCalibrated })
window.__calUI = calUI   // required — inline onclick buttons reference this
calUI.open()
```
Two-step modal. Captures ~1.2s of palm size samples at near and far positions. Validates ratio < 0.92.

### `zoneDepthUI.js`
```js
const zdmUI = new ZoneDepthUI({ getPalmRaw, getHandVisible, getGracePeriod, getPalmSmooth, getCalibration, zones, onDepthSet })
window.__zdmUI = zdmUI   // not strictly needed — dataPanel calls open() directly
zdmUI.open(zoneId)
zdmUI.tick()             // call every frame while modal may be open
zdmUI.sampling           // true during capture (for zone list badge)
zdmUI.currentZoneId      // which zone is open
```

### `zoneDrawUI.js`
```js
const drawUI = new ZoneDrawUI({ video, zones, generateId, onZoneAdded })
window.__drawUI = drawUI   // required — HTML save/cancel buttons reference this
drawUI.toggle()            // activate/deactivate draw mode
drawUI.drawPreview         // { x1,y1,x2,y2 } or null — pass to renderFrame
```

### `dataPanel.js`
```js
const panel = new DataPanel({ onSetDepth, onClearDepth, onDeleteZone })
window.__dp = panel        // auto-set in constructor — zone list onclick references this
panel.update(panelState)   // call every frame
panel.renderZoneList(zones, activeZoneId, zdmCurrentZoneId, zdmSampling)
panel.log(msg, cls)        // 'g' = green, 'a' = amber
```

**Zone list signature guard**: `renderZoneList` computes a compact string of all visible state. It only rebuilds `innerHTML` when that string changes. This prevents the 60fps animation loop from destroying button elements before click events can fire.

---

## Per-Zone Depth: How It Works

```
Global calibration (one-time):
  nearPalmSize = median palm size when hand is close (e.g. 115px)
  farPalmSize  = median palm size at furthest reach  (e.g. 60px)
  range = 60px → 115px

Per-zone depth (per zone):
  depthTarget    = median palm size captured while standing at that zone (e.g. 75px)
  depthTolerance = ±px band (e.g. ±20px → accepts 55–95px)

Zone match = position match AND (palmSmooth within depthTarget ± depthTolerance)
```

You can have a close shelf (depthTarget ~100px) and a far shelf (depthTarget ~65px) in overlapping 2D positions — depth separates them.

---

## Integrating Into Your Own Codebase

1. Copy the `js/` folder and `styles.css` into your project.
2. Add the MediaPipe CDN scripts before your module script.
3. Copy the DOM structure from `index.html` into your layout (the IDs are required).
4. Import and instantiate the modules in your own entry point — follow `app.js` as the template.
5. Call `hand.tick()`, `zoneTracker.matchZones()`, `zoneTracker.tickDwell()`, `renderFrame()`, `panel.update()`, and `panel.renderZoneList()` once per `requestAnimationFrame`.

To use only the depth calibration math without the UI (e.g. in a React component), import only `depthCalibration.js` — it has zero DOM dependencies.
