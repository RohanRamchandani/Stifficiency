# TrackHive — Full Project Brief (v2)
> This document is intended to give a Claude instance (or any developer) everything needed to start building immediately. Read this fully before writing any code.

---

## What Is TrackHive?

TrackHive is an AI-powered, voice-and-gesture-driven inventory management system for Canadian warehouses and SMBs. A fixed camera watches a storage area. The user walks up, holds an item to the camera, places it in a storage zone, and the system automatically identifies, logs, and confirms the item. When someone needs to find an item later, they ask and the UI highlights the correct zone on screen.

The system is designed to be **hands-free, modular, and token-efficient** — it only calls AI APIs when it has a clean frame to work with, not continuously.

---

## Hackathon Context

This is built for a 48-hour hackathon. The prizes being targeted are:

| Prize | Requirement |
|---|---|
| MLH Best Use of Gemini API | Gemini Vision must be a core feature |
| MLH Best Hack with Google Antigravity | Build using Antigravity IDE, document it |
| MLH Best Use of Presage | Presage SDK for wake gesture (wave to activate) |
| Stan — Build in Public | 3+ LinkedIn posts documenting the journey via Stanley |

**Keep this in mind when making decisions.** Judges will be looking for clear, demonstrable use of each tool. Don't abstract them away — make them visible in the demo.

---

## Frontend Layout (Two Sections — Always Visible)

The app has two permanent side-by-side panels. There is no routing between them — they are always visible simultaneously.

### Panel 1 — Live Camera Feed
Everything interaction-based happens here:
- Live webcam feed with zone overlays drawn on top
- Active state indicator (sleeping / listening / identifying / confirming)
- Token efficiency counter (frames evaluated, frames sent, tokens used)
- Confirmation dialog overlay (appears on top of the feed when needed)
- Voice/gesture wake indicator

### Panel 2 — Inventory
Everything data-based happens here:
- Searchable item list — search by item name, item type, or distinguishing feature
- Location browser — select a zone and see all items currently stored there
- Item detail view — name, type, distinguishing features, zone, confidence, timestamp
- Recent activity feed — last N events (added, removed, corrected)

The two panels are independent but reactive — when an item is logged via the camera panel, the inventory panel updates in real time via Supabase subscriptions.

---

## Core User Flow (Build This First)

### Setup (one-time, runs before anything else)

1. User opens the app for the first time and is taken to the Setup screen
2. The live camera feed is displayed full-width
3. User **draws bounding boxes** directly on the camera feed to define storage zones:
   - Click and drag to draw a rectangle around a physical shelf, drawer, cabinet, bin, etc.
   - After drawing, a popup asks:
     - **Type** (dropdown): `shelf`, `drawer`, `cabinet`, `bin`, `rack`, `other`
     - **Name** (text input): e.g. "Shelf 1", "Top Drawer", "Bin A"
   - The drawn box is saved as a zone with its pixel bounds normalized to 0–1 of the frame dimensions
4. User repeats for as many zones as needed
5. User clicks "Done" — zones are saved to Supabase and overlaid on the camera feed permanently

**Zone drawing implementation notes:**
- Use a canvas overlay on top of the video element
- On mousedown → start rect, on mousemove → draw preview, on mouseup → finalize
- Store as `{ x_min, y_min, x_max, y_max }` normalized (divide by video width/height)
- Render saved zones as labeled semi-transparent overlays on the live feed at all times

---

### Adding an Item

1. User **waves at the camera** → Presage detects the wake gesture → system activates (subtle UI indicator changes, optional chime)
2. User **holds the item up close to the camera**
3. The system **watches the video feed and evaluates frame quality continuously** — it is looking for:
   - Low motion blur (frame diff score is LOW — the item is held still)
   - Item is clearly in frame (not cut off at edges)
   - Good contrast / lighting (heuristic: average brightness within acceptable range)
   - Once a frame passes all quality checks → **that frame is captured and sent to Gemini**
   - This is the token efficiency story: we don't send every frame, we wait for a good one
4. Frame is sent to **Gemini Vision** → returns:
   - `name`: general item name (e.g. "toolbox")
   - `item_type`: category/subset (e.g. "toolbox", "jacket", "bottle")
   - `distinguishing_features`: specific visual attributes as key-value pairs (e.g. `{ color: "blue", size: "large", brand: "DeWalt", condition: "worn" }`)
   - `confidence`: 0–100 self-reported certainty
5. User **walks to a storage zone and places the item**
6. Camera tracks which **drawn zone** the user is standing in front of (match user's x/y position in frame to the zone bounding boxes defined in setup)
7. System infers zone from position. Then:

**If confidence ≥ threshold (default 80%):**
- Behavior controlled by the `highConfirmationMode` setting:
  - `'ui-only'` (default): A subtle confirmation card appears on the UI: *"Blue toolbox → Shelf 1 ✓"* — no voice, no action required, auto-dismisses after 3s and logs automatically
  - `'voice'`: ElevenLabs speaks the confirmation and waits for user to say "yes" or "no"

**If confidence < threshold:**
- Behavior controlled by the `lowConfirmationMode` setting:
  - `'ui-only'`: A prominent confirmation dialog appears on screen with Confirm / Correct buttons — no voice
  - `'voice'`: ElevenLabs asks for confirmation verbally, Web Speech API listens for response

8. User corrects if needed — speaks or types: *"No, that's a red toolbox on Bottom Drawer"*
   - Gemini parses the correction via `parseCorrection` prompt
   - Item is logged with corrected values; original detection stored in event log

---

### Finding an Item

1. User activates system (wave or voice wake)
2. User says or types: *"Where is the blue toolbox?"* or *"What's in Shelf 1?"*
3. Two query types supported:
   - **By item:** Web Speech / text input → backend queries items by name + distinguishing features → returns zone
   - **By location:** User clicks a zone on the camera overlay → inventory panel filters to show all items in that zone
4. UI **highlights the matching zone** on the camera feed (glow/pulse animation on the drawn bounding box)
5. Inventory panel scrolls to and highlights the matching item card
6. If `voiceEnabled` in settings: ElevenLabs speaks the location

---

### Removing an Item

1. User activates system
2. User holds item to camera → system waits for a quality frame → Gemini identifies it
3. System matches against DB by name + distinguishing features
4. Confirmation shown (per `highConfirmationMode` or `lowConfirmationMode` setting)
5. On confirm → item `status` set to `'out'`, zone `held_items` decremented, event logged

---

## Token Efficiency (Important — Showcase This)

**Do not send frames to Gemini continuously or on raw motion.** Wait for a quality frame.

### Frame Quality Gate (runs before every Gemini call)
```
Every frame in the video loop is evaluated:
  1. Motion blur check: frame diff score < low threshold (item held still)
  2. Edge check: no significant content touching frame border (item fully in frame)
  3. Brightness check: mean pixel brightness between 40-220 (not too dark/bright)

If all 3 pass → capture this frame → send to Gemini → impose cooldown
If any fail → continue watching → try again next frame
```

### Why This Matters for the Demo
Display a live counter on the camera panel: *"Frames evaluated: 847 | Frames sent to AI: 4 | Tokens used: 312"*
Judges will love this — "we built a system that waits for the right moment, not one that blindly streams."

---

## Settings System

Settings are **global, persistent (localStorage), and surfaced in a dedicated Settings panel** accessible from both sections. The panel is **config-driven** — new settings can be added by adding one object to `settingsConfig.js`, with no new UI code needed.

### Settings Schema

```js
const defaultSettings = {
  // Wake trigger
  wakeTrigger: 'gesture',          // 'gesture' | 'voice'
  wakeWord: 'hey trackhive',       // used if wakeTrigger = 'voice'

  // Confirmation behaviour
  confidenceThreshold: 80,          // 0-100
  highConfirmationMode: 'ui-only',  // 'ui-only' | 'voice'
  lowConfirmationMode: 'voice',     // 'ui-only' | 'voice'

  // Voice output
  voiceEnabled: true,               // master toggle for ElevenLabs
  voiceId: 'default',              // ElevenLabs voice selector

  // Frame capture
  motionThreshold: 15,              // % diff to consider "motion present"
  qualityBlurThreshold: 8,          // max frame diff to consider "still enough"
  cooldownMs: 3000,                 // min ms between Gemini calls

  // Agent mode (swaps prompt config)
  agentMode: 'warehouse',           // 'warehouse' | 'school' | 'office'
}
```

### Settings Panel Implementation
- Each setting declared in `settingsConfig.js` as: `{ key, label, description, type, options?, min?, max? }`
- Types: `toggle`, `slider`, `select`, `text`
- Panel renders from this array — fully data-driven, no hardcoded setting UI
- Grouped into sections: Wake, Confirmation, Voice, Capture, Agent

---

## Tech Stack

| Layer | Tool | Notes |
|---|---|---|
| Frontend | React + Vite | Fast HMR, excellent for canvas/camera work |
| Backend | Node.js + Express | Same language as frontend, thin API layer only |
| Database | Supabase | PostgreSQL, instant REST API, real-time subscriptions, free tier |
| Item Identification | Gemini Vision API (JS SDK) | Multimodal, quality-gated frame capture |
| Voice Output | ElevenLabs REST API | POST text → receive audio → play in browser |
| Voice Input | Web Speech API | Browser-native, zero setup, no API key |
| Wake Gesture | Presage SDK (JS) | Wave detection via webcam |
| Zone Tracking | Frame zone heuristic | Map user's position in frame to drawn zone bounds |
| Frame Quality | Canvas API (vanilla JS) | Blur, brightness, edge checks — no library needed |

---

## Folder Structure

```
trackhive/
├── frontend/
│   ├── public/
│   └── src/
│       ├── components/
│       │   ├── camera/        # Webcam feed, zone overlays, quality indicator, token counter
│       │   ├── setup/         # Zone drawing tool, zone type/name form, setup flow
│       │   ├── inventory/     # Item list, location browser, item detail, activity feed
│       │   ├── settings/      # Settings panel (rendered from settingsConfig.js)
│       │   └── shared/        # ConfirmationDialog, ZoneHighlight, StatusBadge
│       ├── hooks/             # useCamera, useSpeech, useInventory, usePresage, useSettings
│       ├── context/           # SettingsContext, InventoryContext, SessionContext
│       └── utils/             # frameDiff.js, frameQuality.js, zoneMapper.js, audioPlayer.js
├── backend/
│   ├── routes/                # items.js, zones.js, events.js
│   ├── controllers/           # itemController.js, zoneController.js, eventController.js
│   ├── services/              # inventoryService.js, queryService.js
│   ├── middleware/            # errorHandler.js, logger.js
│   └── db/
│       ├── schema/            # SQL table definitions
│       └── migrations/        # Supabase migration files
├── ai/
│   ├── vision/                # geminiVision.js — identify item from quality frame
│   ├── voice/                 # elevenLabs.js, webSpeech.js
│   ├── gesture/               # presage.js — wake gesture detection
│   └── prompts/               # identifyItem.js, parseCorrection.js, parseQuery.js, promptConfig.js
└── docs/
    ├── api-contract.md        # Agreed endpoints for parallel development
    ├── db-schema.md           # Full table definitions
    ├── demo-script.md         # Step-by-step demo for judges
    └── stan-posts.md          # LinkedIn post outlines for 3 required posts
```

---

## Database Schema

### `storage_zones`
Replaces the old `shelves` + `shelf_zones` tables. A zone IS the drawn bounding box.

```sql
id            uuid primary key default gen_random_uuid()
name          text not null             -- e.g. "Shelf 1", "Top Drawer"
type          text not null             -- 'shelf' | 'drawer' | 'cabinet' | 'bin' | 'rack' | 'other'
x_min         float not null            -- normalized 0-1 frame bounds (from setup drawing)
y_min         float not null
x_max         float not null
y_max         float not null
held_items    int default 0             -- count of items with status = 'in' in this zone
created_at    timestamp default now()
```

> `held_items` is updated in the service layer on every status change. Keep it denormalized for fast reads — do not calculate on the fly.

---

### `items`

```sql
id                      uuid primary key default gen_random_uuid()
name                    text not null               -- e.g. "toolbox"
item_type               text not null               -- category/subset e.g. "toolbox", "jacket", "bottle"
distinguishing_features jsonb not null              -- e.g. { "color": "blue", "size": "large", "brand": "DeWalt" }
zone_id                 uuid references storage_zones(id)
confidence              int                         -- 0-100, Gemini self-reported
status                  text default 'in'           -- 'in' | 'out'
added_at                timestamp default now()
updated_at              timestamp default now()
```

**On `distinguishing_features`:**
- Gemini is explicitly prompted to return specific, concrete key-value pairs — not vague descriptions
- Good: `{ "color": "blue", "size": "large", "condition": "worn", "brand": "DeWalt" }`
- Bad: `{ "description": "a blue toolbox that looks used" }`
- The prompt must enforce this structure — see AI prompts section
- These features are fully searchable in the inventory panel

**On `item_type`:**
- This is the category the item belongs to, independent of its specific traits
- e.g. a blue jacket has `item_type: "jacket"` and `distinguishing_features: { color: "blue" }`
- Used for filtering in the inventory panel (show all "jacket" items, etc.)

---

### `events`

```sql
id          uuid primary key default gen_random_uuid()
item_id     uuid references items(id)
action      text not null               -- 'added' | 'removed' | 'corrected'
before      jsonb                       -- full item snapshot before change
after       jsonb                       -- full item snapshot after change
timestamp   timestamp default now()
```

---

## API Contract

All routes prefixed `/api`

### Items
```
POST   /api/items
  body: { name, item_type, distinguishing_features, zone_id, confidence }
  → logs item, increments zone held_items

PATCH  /api/items/:id
  body: { name?, item_type?, distinguishing_features?, zone_id?, confidence? }
  → updates item, adjusts zone held_items if zone changed, logs correction event

DELETE /api/items/:id
  → sets status = 'out', decrements zone held_items, logs removal event

GET    /api/items
  query params: ?zone_id=, ?name=, ?item_type=, ?feature_key=, ?feature_value=, ?status=
  → filterable inventory list

GET    /api/items/find?query=:naturalLanguageQuery
  → backend uses Gemini to parse query, returns matching items with zone info
```

### Zones
```
POST   /api/zones
  body: { name, type, x_min, y_min, x_max, y_max }

GET    /api/zones
  → all zones including held_items count

GET    /api/zones/:id/items
  → all items in this zone with status = 'in'

PATCH  /api/zones/:id
  body: { name?, type? }
  → rename or retype a zone (cannot change bounds after creation)

DELETE /api/zones/:id
  → only allowed if held_items = 0
```

### Events
```
GET    /api/events              last 50 events across all items
GET    /api/events?item_id=:id  event history for one item
```

---

## AI Module Contracts

Each file in `/ai/` exports pure functions only. No Express, no React, no side effects.

### `ai/vision/geminiVision.js`
```js
identifyItem(base64Frame)
  → {
      name: string,
      item_type: string,
      distinguishing_features: {
        color?: string,
        size?: string,
        brand?: string,
        condition?: string,
        material?: string,
        // any other visually distinguishable attribute
      },
      confidence: number    // 0-100
    }
```

### `ai/prompts/identifyItem.js`
```js
buildIdentifyPrompt(config)
  → string

// The prompt MUST:
// 1. Return ONLY valid JSON — no markdown, no preamble
// 2. Match schema exactly: { name, item_type, distinguishing_features, confidence }
// 3. Instruct distinguishing_features to be SPECIFIC key-value pairs, never prose
// 4. Ask Gemini to self-report confidence as an integer 0-100
// 5. Include a good/bad example in the prompt for distinguishing_features
```

### `ai/prompts/parseCorrection.js`
```js
buildCorrectionPrompt(rawSpeech, availableZones, config)
  → string
// Gemini returns JSON: { name: string, item_type: string, distinguishing_features: object, zone_name: string }
// Pass availableZones so Gemini can match spoken zone name to an existing zone
```

### `ai/prompts/parseQuery.js`
```js
buildQueryPrompt(rawSpeech, availableZones, config)
  → string
// Handles both "where is X" and "what's in Y" queries
// Gemini returns JSON: { queryType: 'by_item' | 'by_zone', value: string }
```

### `ai/prompts/promptConfig.js`
```js
// Maps agentMode to prompt tone/behaviour variations
const promptConfig = {
  warehouse: { tone: 'technical', terminology: 'warehouse' },
  school:    { tone: 'friendly',  terminology: 'school'    },
  office:    { tone: 'formal',    terminology: 'office'    },
}
export const getConfig = (agentMode) => promptConfig[agentMode]
```

### `ai/voice/elevenLabs.js`
```js
speak(text, voiceId) → Promise<audioUrl: string>
```

### `ai/gesture/presage.js`
```js
initWakeGesture(videoElement, onWake: () => void) → void
stopWakeGesture() → void
```

---

## Frontend Key Components

### `useCamera` hook
- Initialises `getUserMedia`, shares one `videoRef` with both Presage and frame quality loop
- Runs frame quality evaluation on every animation frame
- Exposes: `videoRef`, `canvasRef`, `frameScore { motionDiff, brightness, edgeClear }`, `captureFrame() → base64`
- Fires `onQualityFrame(base64)` when all quality checks pass AND cooldown has elapsed

### `useZoneTracker` hook
- Tracks user's x/y position in the frame (motion centroid or MediaPipe wrist landmark)
- Compares to stored zone bounding boxes
- Returns: `activeZone: StorageZone | null`

### `ZoneDrawingCanvas` component (Setup only)
- Canvas overlay on top of the live video
- Mouse events: draw rect, show preview, finalize on mouseup
- On finalize → opens `ZoneForm` popup (type dropdown + name input)
- Renders all saved zones as labeled colored overlays

### `ZoneOverlay` component (Camera panel — always visible)
- Renders saved zones as semi-transparent labeled boxes over the live feed
- Accepts `highlightedZoneId` — pulses that zone with a glow animation
- Clicking a zone filters the inventory panel to that zone

### `ConfirmationDialog` component
- Rendered inside the camera panel as an overlay
- Props: `mode: 'ui-only' | 'voice'`, `item`, `zone`, `confidence`
- Shows: item name, item_type, distinguishing_feature chips, zone name, confidence bar
- Buttons: Confirm / Correct
- If voice mode: auto-listens via Web Speech API; if ui-only: shows buttons only
- If Correct: inline text + voice correction input

### `InventoryPanel` component
- Search bar: searches `name`, `item_type`, and all values in `distinguishing_features`
- Filter row: by zone (dropdown), by item_type (dropdown), by status
- Item cards: name badge, type tag, feature chips, zone badge, timestamp
- Clicking a card → triggers zone highlight in the camera panel
- Real-time updates via Supabase subscription on the `items` table

### `Settings` component
- Fully rendered from `settingsConfig.js` — no hardcoded setting UI
- Grouped sections: Wake, Confirmation, Voice, Capture, Agent
- Changes save to localStorage instantly and update SettingsContext

### `TokenCounter` component
- Session-only, resets on page refresh
- Displays: frames evaluated, frames sent to AI, API calls, tokens used
- Prominent placement in the camera panel — this is a demo showpiece

---

## Shared `types.js` — Define This at Hour 1

Do not skip. All four teammates build against this before writing any other code.

```js
export const ItemStatus   = { IN: 'in', OUT: 'out' }
export const EventAction  = { ADDED: 'added', REMOVED: 'removed', CORRECTED: 'corrected' }
export const WakeTrigger  = { GESTURE: 'gesture', VOICE: 'voice' }
export const ConfirmMode  = { UI_ONLY: 'ui-only', VOICE: 'voice' }
export const ZoneType     = { SHELF: 'shelf', DRAWER: 'drawer', CABINET: 'cabinet', BIN: 'bin', RACK: 'rack', OTHER: 'other' }

// StorageZone — matches storage_zones table
export const StorageZone = {
  id: String,
  name: String,
  type: String,           // ZoneType
  x_min: Number,          // 0.0-1.0 normalized
  y_min: Number,
  x_max: Number,
  y_max: Number,
  held_items: Number,
}

// Item — matches items table
export const Item = {
  id: String,
  name: String,
  item_type: String,
  distinguishing_features: Object,   // { color: "blue", size: "large", ... }
  zone_id: String,
  confidence: Number,                // 0-100
  status: String,                    // ItemStatus
  added_at: String,
  updated_at: String,
}

// Event — matches events table
export const Event = {
  id: String,
  item_id: String,
  action: String,    // EventAction
  before: Object,
  after: Object,
  timestamp: String,
}
```

---

## Team Responsibilities

| Person | Owns | Key Deliverables |
|---|---|---|
| Person 1 | `ai/vision/` + `frontend/src/components/camera/` + `utils/frameQuality.js` | Frame quality gate, Gemini Vision integration, ZoneOverlay, zone tracking, TokenCounter |
| Person 2 | `ai/voice/` + `ai/gesture/` + `ai/prompts/` | ElevenLabs, Web Speech API, Presage, all prompt templates, promptConfig.js, dialogue flow |
| Person 3 | `backend/` | Supabase schema + migrations, all routes + controllers + services, held_items logic, filterable queries |
| Person 4 | `frontend/src/components/` (setup, inventory, settings, shared) | ZoneDrawingCanvas, InventoryPanel, config-driven Settings panel, ConfirmationDialog, Stan posts |

### Critical Sync Points
- **Hour 1:** Define `types.js` + DB schema together — everyone blocks on this
- **Hour 6:** Person 1 + 2: quality frame captured → Gemini identifies → result shown in UI
- **Hour 12:** Person 2 + 3: confirmation → DB write → inventory panel updates live
- **Hour 24:** Full first run — draw zones, add item, confirm, log, find, highlight
- **Hour 36:** Polish, edge cases, settings panel complete, demo rehearsal
- **Hour 48:** Demo rehearsal ×2, final Stan post live

---

## Demo Script (For Judges)

1. Open app → zones already drawn on camera feed (pre-configure before demo)
2. Show inventory panel — currently empty
3. Wave at camera → status indicator activates
4. Hold up a blue toolbox — hold it still → quality indicator goes green → frame auto-captured
5. Walk to a shelf zone → place item → confirmation card appears: *"Blue toolbox → Shelf 1 ✓"*
6. Inventory panel updates live — item card appears with type + feature chips
7. Pick up a second item, trigger low confidence → dialog appears → speak a correction → logs with corrected data
8. Click Shelf 1 in the zone overlay → inventory filters to that zone only
9. Ask "where is the blue toolbox?" → zone glows, inventory highlights the card
10. Point at token counter: *"The entire demo — 6 frames sent to the AI"*
11. Open Settings → show confirmation mode toggles, confidence slider, agent mode selector

---

## Things to Avoid / Known Pitfalls

- **Do not send every frame to Gemini** — the quality gate is the entire architecture; bypassing it will burn credits in minutes
- **Do not put API keys in the frontend** — all Gemini and ElevenLabs calls go through the backend
- **Do not hardcode zones** — always read from Supabase; zones are user-defined
- **Two items with the same name in different zones** — `GET /api/items/find` may return multiple matches; the UI must highlight all matching zones and show a picker
- **`held_items` drift** — update it atomically in the service layer on every status change; never recalculate it at read time
- **Presage + frame quality loop both need the video element** — share one `videoRef`, never open two separate streams
- **Web Speech API** — Chrome only; use Chrome exclusively for the demo
- **Zone coordinate system** — always normalize to 0–1 at draw time and re-scale to pixels at render time; never store raw pixel values (window may resize)
