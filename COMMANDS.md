# Stifficiency — Voice & Keyboard Commands

All voice commands are recognized continuously while the mic is active (green 🎙 indicator).
Text commands can be typed in the **Find item…** search bar and submitted with Enter or 🔍.

---

## 📸 Scanning

| Say / Type | What happens |
|---|---|
| `"scan"` | Captures the current frame and sends to Gemini for identification |
| `"scan this"` | Same as above |
| `"scan item"` | Same as above |
| `"scan now"` | Same as above |
| `"take a picture"` | Same as above |
| `"capture"` | Same as above |

After scanning, hold the item near a **zone** until the dwell ring fills — this places the item.

---

## 🔍 Finding Items

| Say / Type | What happens |
|---|---|
| `"find [item name]"` | Highlights the zone on camera + scrolls to item in inventory |
| `"locate [item name]"` | Same as above |
| `"where is [item name]"` | Same as above |
| `"where's my [item name]"` | Same as above |
| `"what's in [zone name]"` | Lists all items in that zone and filters inventory to it |
| `"what is in [zone name]"` | Same as above |

**Examples:**
- `"find screwdriver"` → highlights shelf 1, scrolls to the screwdriver card
- `"what's in shelf 2"` → filters inventory to Shelf 2's contents

---

## 🗑️ Removing Items

| Say / Type | What happens |
|---|---|
| `"remove [item name]"` | Finds the best match and asks for confirmation |
| `"removing [item name]"` | Same as above |
| `"take out [item name]"` | Same as above |

After a match is found the system speaks *"Found [item]. Say confirm or cancel."*

### Confirmation responses
| Say | What happens |
|---|---|
| `"yes"` / `"confirm"` / `"yeah"` / `"yep"` / `"do it"` | Confirms removal — item marked as removed |
| `"no"` / `"cancel"` / `"nope"` / `"stop"` / `"nevermind"` | Cancels — item stays in inventory |

You can also click **Confirm ✓** or **Cancel ✕** on the overlay directly.

---

## 🎛️ UI Interactions

| Action | What happens |
|---|---|
| Click a **zone** on camera overlay | Filters inventory to that zone |
| Click **🗑 Removed (N)** tab | Toggles display of removed items (shown with strikethrough) |
| Click **✕** on an item card | Permanently deletes item from local storage |
| Click **⊕ Calibrate Depth** | Opens depth calibration modal |

---

## 📋 Notes

- Voice recognition is **Chrome only** (Web Speech API)
- The mic restarts automatically if it stops — check the 🎙 pill in the footer
- Zone names must match exactly (case-insensitive) when using voice zone queries
- Removed items appear in the **🗑 Removed** tab and are hidden from all counts
