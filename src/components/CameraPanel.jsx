import { useRef, useEffect, useState, useCallback } from 'react'
import { useItems } from '../context/ItemsContext'
import { useZones } from '../context/ZonesContext'
import { useDepth } from '../context/DepthContext'
import { useSearch } from '../context/SearchContext'
import { ZoneTracker } from '../lib/zoneTracker'
import { palmToDepthPosition } from '../lib/depthCalibration'
import CalibrationModal from './CalibrationModal'
import './CameraPanel.css'

// ── Motion detection constants ─────────────────────────────────
const IDLE_INTERVAL_MS   = 500    // poll twice per second when idle
const ACTIVE_INTERVAL_MS = 120
const MOTION_THRESHOLD   = 15    // more sensitive — triggers on light movement
const IDLE_TIMEOUT_MS   = 60 * 1000
const SAMPLE_W = 64, SAMPLE_H = 48
const PIXEL_W  = 96, PIXEL_H  = 72

// ── ElevenLabs config ─────────────────────────────────────────
const ELEVENLABS_API_KEY  = import.meta.env.VITE_ELEVENLABS_API_KEY || ''
const ELEVENLABS_VOICE_ID = '9BWtsMINqrJLrRacOk9x'   // Aria — warm, natural assistant voice
const ELEVENLABS_URL      = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`
console.log('[ElevenLabs] key present:', !!ELEVENLABS_API_KEY, '| voice:', ELEVENLABS_VOICE_ID)

// ── Gemini config ──────────────────────────────────────────────
const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
const SCAN_PROMPT  = `Analyze this image. A person is holding an item in their hand(s). Identify ONLY the object being held — ignore the person, their hands, the background, furniture, shelves, and anything not being held.
Return ONLY a valid JSON object with exactly these fields:
{
  "name": "specific item name",
  "category": "general category (e.g. Tools, Electronics, Clothing, Food, Documents, Sports, Cleaning, Office, Other)",
  "item_type": "specific type within category",
  "distinguishing_features": {
    "color": "...",
    "brand": "...",
    "size": "...",
    "condition": "...",
    "material": "..."
  }
}
Focus solely on the hand-held object. Include only features you can visually confirm. Remove keys you cannot determine. Return ONLY the JSON, no markdown, no explanation.`

// ── Audio context ─────────────────────────────────────────────
let sharedAudioCtx = null
function getAudioCtx() {
    if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)()
    return sharedAudioCtx
}
export async function unlockAudio() {
    const ctx = getAudioCtx()
    if (ctx.state === 'suspended') await ctx.resume()
}

let isSpeaking = false

function speakBrowser(text) {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.0; u.pitch = 1.1; u.volume = 1.0
    const voices = window.speechSynthesis.getVoices()
    const female = voices.find(v => v.lang.startsWith('en') && /zira|samantha|karen|female|woman/i.test(v.name))
                || voices.find(v => v.lang.startsWith('en'))
    if (female) u.voice = female
    isSpeaking = true
    u.onend  = () => { setTimeout(() => { isSpeaking = false }, 600) }
    u.onerror = () => { isSpeaking = false }
    window.speechSynthesis.speak(u)
}

async function speakText(text) {
    if (!ELEVENLABS_API_KEY) { speakBrowser(text); return }
    isSpeaking = true
    try {
        await unlockAudio()
        const response = await fetch(ELEVENLABS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'xi-api-key': ELEVENLABS_API_KEY },
            body: JSON.stringify({
                text,
                model_id: 'eleven_turbo_v2_5',   // faster + higher quality for English
                voice_settings: {
                    stability:        0.75,
                    similarity_boost: 0.85,
                    style:            0.20,
                    use_speaker_boost: true,
                },
            }),
        })
        if (!response.ok) throw new Error(`ElevenLabs API error: ${response.statusText}`)
        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audio.onended = () => { URL.revokeObjectURL(url); setTimeout(() => { isSpeaking = false }, 600) }
        audio.onerror = () => { URL.revokeObjectURL(url); isSpeaking = false }
        await audio.play()
    } catch (err) {
        console.error('TTS error:', err)
        speakBrowser(text)
    }
}

// ── Startup chime (Web Audio — no API call, instant) ──────────
function playChime() {
    try {
        const ctx = getAudioCtx()
        const now = ctx.currentTime
        const notes = [523.25, 659.25, 783.99]   // C5 E5 G5 — pleasant major chord
        notes.forEach((freq, i) => {
            const osc  = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.connect(gain); gain.connect(ctx.destination)
            osc.type = 'sine'
            osc.frequency.setValueAtTime(freq, now + i * 0.12)
            gain.gain.setValueAtTime(0, now + i * 0.12)
            gain.gain.linearRampToValueAtTime(0.18, now + i * 0.12 + 0.04)
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.55)
            osc.start(now + i * 0.12)
            osc.stop(now + i * 0.12 + 0.6)
        })
    } catch { /* audio not unlocked yet — safe to ignore */ }
}

function frameDiffWithCentroid(a, b) {
    let sum = 0, cx = 0, cy = 0, count = 0
    const len = a.data.length
    for (let i = 0; i < len; i += 4) {
        const d = (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])) / 3
        sum += d
        if (d > 15) { const px = (i / 4) % SAMPLE_W; const py = Math.floor((i / 4) / SAMPLE_W); cx += px; cy += py; count++ }
    }
    return { score: sum / (len / 4), centroid: count > 8 ? { x: cx / count / SAMPLE_W, y: cy / count / SAMPLE_H } : null }
}

function fmtMs(ms) {
    const s = Math.ceil(ms / 1000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const STATUS_IDLE = { state: 'idle', message: 'Ready to scan' }

// ── Depth badge helper ─────────────────────────────────────────
function getDepthBadge(palmSmooth, calibration) {
    if (!calibration || palmSmooth < 1) return null
    const p = palmToDepthPosition(palmSmooth, calibration)
    if (p > 0.65) return { label: '▲ NEAR', cls: 'depth-badge-near' }
    if (p < 0.35) return { label: '▼ FAR',  cls: 'depth-badge-far'  }
    return { label: '◆ MID', cls: 'depth-badge-mid' }
}

export default function CameraPanel() {
    const videoRef    = useRef(null)
    const samplerRef  = useRef(null)
    const captureRef  = useRef(null)
    const pixelRef    = useRef(null)
    const overlayRef  = useRef(null)   // depth/dwell canvas overlay
    const prevFrame   = useRef(null)
    const intervalRef = useRef(null)
    const lastMotion  = useRef(null)
    const tickRef     = useRef(null)
    const idleRafRef  = useRef(null)
    const depthRafRef = useRef(null)   // RAF for depth overlay

    const [mode, setMode]           = useState('idle')
    const [camError, setCamError]   = useState(null)
    const [camReady, setCamReady]   = useState(false)
    const [diffScore, setDiffScore] = useState(0)
    const [countdown, setCountdown] = useState(null)
    const [scanStatus, setScanStatus] = useState(STATUS_IDLE)
    const [apiKey, setApiKey]         = useState(() => localStorage.getItem('stifficiency_gemini_key') || import.meta.env.VITE_GEMINI_API_KEY || '')
    const [keyInput, setKeyInput]     = useState('')
    const [showKeyInput, setShowKeyInput] = useState(false)
    const [showCalModal, setShowCalModal] = useState(false)

    const { items, addItem, setItemZone, softRemoveItem } = useItems()
    const { zones } = useZones()
    const {
        calibration, dwellMs, graceMs, depthGating, setDepthGating,
        handStateRef, handTrackerRef, mpReady, initHandTracker,
    } = useDepth()

    // ── Voice state ───────────────────────────────────────────────
    const [voiceStatus, setVoiceStatus]       = useState('loading')
    const [voiceTranscript, setVoiceTranscript] = useState('')
    const [audioUnlocked, setAudioUnlocked]   = useState(false)
    const [audioTestStatus, setAudioTestStatus] = useState(null)

    // ── Depth + dwell display state (react state for badges) ─────
    const [depthBadge, setDepthBadge]   = useState(null)
    const [dwellProgress, setDwellProgress] = useState(0)

    // ── Zone placement (MediaPipe dwell-based) ────────────────────
    const zoneTrackerRef = useRef(new ZoneTracker({ depthGating }))
    const [trackingItemId, setTrackingItemId] = useState(null)
    const [activeZoneId, setActiveZoneId]     = useState(null)
    const [placedZone, setPlacedZone]         = useState(null)

    // Keep ZoneTracker depthGating in sync
    useEffect(() => { zoneTrackerRef.current.depthGating = depthGating }, [depthGating])

    // Stable refs
    const trackingRef    = useRef({ itemId: null, zones: [] })
    const setItemZoneRef = useRef(setItemZone)
    trackingRef.current.itemId = trackingItemId
    trackingRef.current.zones  = zones
    setItemZoneRef.current     = setItemZone

    const itemsRef       = useRef(items)
    itemsRef.current     = items
    const handleScanRef  = useRef(null)
    const findItemRef    = useRef(null)
    const removeRef      = useRef(null)

    // ── Remove candidate (confirmation overlay) ───────────────────
    const [removeCandidate, setRemoveCandidate] = useState(null)
    const removeCandidateRef = useRef(null)       // kept in sync — readable from closures
    removeCandidateRef.current = removeCandidate
    const softRemoveRef = useRef(softRemoveItem)
    softRemoveRef.current = softRemoveItem

    // ── MediaPipe interval (tab-switch safe) ──────────────────────
    // requestAnimationFrame is throttled by Chrome when display:none.
    // A setInterval keeps processFrame() ticking regardless of visibility.
    const mpIntervalRef = useRef(null)

    // ── Pixel draw (idle) ─────────────────────────────────────────
    const startPixelDraw = useCallback(() => {
        const draw = () => {
            const v = videoRef.current, c = pixelRef.current
            if (v && c && v.readyState >= 2) c.getContext('2d').drawImage(v, 0, 0, PIXEL_W, PIXEL_H)
            idleRafRef.current = requestAnimationFrame(draw)
        }
        cancelAnimationFrame(idleRafRef.current)
        idleRafRef.current = requestAnimationFrame(draw)
    }, [])
    const stopPixelDraw = useCallback(() => cancelAnimationFrame(idleRafRef.current), [])

    // ── Depth overlay RAF ─────────────────────────────────────────
    const startDepthOverlay = useCallback(() => {
        const canvas = overlayRef.current
        if (!canvas) return

        const drawLoop = () => {
            const hs  = handStateRef.current
            const cal = calibration
            const W   = canvas.offsetWidth
            const H   = canvas.offsetHeight
            if (canvas.width !== W)  canvas.width  = W
            if (canvas.height !== H) canvas.height = H
            const ctx = canvas.getContext('2d')
            ctx.clearRect(0, 0, W, H)

            // ── Send video frame to MediaPipe (non-blocking) ───
            handTrackerRef.current?.processFrame()

            // ── Hand tracker grace period tick ─────────────────
            handTrackerRef.current?.tick(graceMs)

            // ── Zone tracker (dwell) ───────────────────────────
            const zt = zoneTrackerRef.current
            if (hs.landmarks && trackingRef.current.itemId) {
                zt.matchZones(hs, trackingRef.current.zones)
            } else {
                zt.activeZone = null
            }

            const confirmed = zt.tickDwell(dwellMs)
            setDwellProgress(zt.dwellProgress)
            setActiveZoneId(zt.activeZone?.id ?? null)

            if (confirmed && trackingRef.current.itemId) {
                const zone = confirmed
                setItemZoneRef.current(trackingRef.current.itemId, zone.id)
                trackingRef.current.itemId = null
                setTrackingItemId(null)
                setActiveZoneId(null)
                setPlacedZone({ label: zone.label, color: zone.color })
                zt.resetDwell()
                setTimeout(() => setPlacedZone(null), 3500)
            }

            // ── Update depth badge state ───────────────────────
            setDepthBadge(getDepthBadge(hs.palmSmooth, cal))

            // ── Draw dwell ring on active zone ─────────────────
            if (zt.activeZone && zt.dwellProgress > 0) {
                const az  = zt.activeZone
                const zx  = az.x * W, zy = az.y * H
                const zw  = az.w * W, zh = az.h * H
                const cx  = zx + zw / 2, cy = zy + zh / 2
                const r   = Math.min(zw, zh) / 2 + 11
                const col = zt.dwellProgress >= 1 ? '#34d399' : '#22c55e'

                ctx.save()
                // Background track
                ctx.strokeStyle = 'rgba(34,197,94,.18)'; ctx.lineWidth = 4
                ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
                // Progress arc
                ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.lineCap = 'round'
                ctx.shadowBlur = 10; ctx.shadowColor = col
                ctx.beginPath()
                ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + zt.dwellProgress * Math.PI * 2)
                ctx.stroke()
                // Label
                ctx.font = '600 11px Inter,sans-serif'
                ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.shadowBlur = 4
                ctx.fillStyle = col
                const label = zt.dwellProgress >= 1 ? '✓ Confirmed' : `Hold ${Math.round(zt.dwellProgress * 100)}%`
                ctx.fillText(label, cx, zy + zh + r + 4)
                ctx.restore()
            }

            // ── Draw hand dot ──────────────────────────────────
            if (hs.landmarks && hs.palmSmooth > 1) {
                const px  = hs.posX * W, py  = hs.posY * H
                const col = hs.gracePeriod ? '#f59e0b' : '#22c55e'
                ctx.save()
                ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2)
                ctx.strokeStyle = col + '55'; ctx.lineWidth = 1.5; ctx.stroke()
                ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2)
                ctx.fillStyle = col; ctx.shadowBlur = 10; ctx.shadowColor = col; ctx.fill()
                ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.shadowBlur = 0
                ctx.beginPath(); ctx.moveTo(px - 14, py); ctx.lineTo(px - 7, py); ctx.stroke()
                ctx.beginPath(); ctx.moveTo(px + 7, py); ctx.lineTo(px + 14, py); ctx.stroke()
                ctx.beginPath(); ctx.moveTo(px, py - 14); ctx.lineTo(px, py - 7); ctx.stroke()
                ctx.beginPath(); ctx.moveTo(px, py + 7); ctx.lineTo(px, py + 14); ctx.stroke()
                ctx.restore()
            }

            depthRafRef.current = requestAnimationFrame(drawLoop)
        }
        cancelAnimationFrame(depthRafRef.current)
        depthRafRef.current = requestAnimationFrame(drawLoop)
    }, [calibration, handStateRef, handTrackerRef, graceMs, dwellMs])

    // ── Frame sampling (pixel-diff) ───────────────────────────────
    const captureFrame = useCallback(() => {
        const v = videoRef.current, c = samplerRef.current
        if (!v || !c || v.readyState < 2) return null
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(v, 0, 0, SAMPLE_W, SAMPLE_H)
        return ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H)
    }, [])

    const { setFindResult, setZoneFilter, highlightedZoneId, zoneFilter } = useSearch()
    const [searchText, setSearchText] = useState('')

    // ── Find / Remove helpers ─────────────────────────────────────
    /** Score an item against a query string — used by both findItem and remove. */
    const scoreItem = useCallback((item, q) => {
        const words = q.split(/\s+/).filter(w => w.length > 1 && !['a','an','the','my','some','this','item'].includes(w))
        const haystack = [item.name, item.category, item.item_type,
            item.distinguishing_features?.brand, item.distinguishing_features?.color]
            .filter(Boolean).join(' ').toLowerCase()
        if (haystack.includes(q)) return words.length + 2
        return words.filter(w => haystack.includes(w)).length
    }, [])

    /** Find best-matching active (status:'in') item for removal. */
    const findRemoveCandidate = useCallback((query) => {
        const q = query.toLowerCase().trim()
        const activeItems = itemsRef.current.filter(i => i.status !== 'out')
        const scored = activeItems
            .map(item => ({ item, s: scoreItem(item, q) }))
            .filter(({ s }) => s >= 1)
            .sort((a, b) => b.s - a.s)
        return scored[0]?.item ?? null
    }, [scoreItem])

    // ── Find item by voice or text ────────────────────────────────
    const findItem = useCallback(async (query) => {
        const q     = query.toLowerCase().trim()
        const words = q.split(/\s+/).filter(w => w.length > 1 && !['a','an','the','my','some'].includes(w))
        const allItems = itemsRef.current
        const allZones = trackingRef.current.zones

        const scoreItem = (item) => {
            const haystack = [item.name, item.category, item.item_type,
                item.distinguishing_features?.brand, item.distinguishing_features?.color]
                .filter(Boolean).join(' ').toLowerCase()
            if (haystack.includes(q)) return words.length + 2
            return words.filter(w => haystack.includes(w)).length
        }

        const scored = allItems.map(item => ({ item, s: scoreItem(item) })).filter(({ s }) => s >= 1).sort((a, b) => b.s - a.s)
        const found  = scored.map(({ item }) => item)

        // ── Location query: "what's in Shelf 1" ── matches a zone label
        const zoneMatch = allZones.find(z => q.includes(z.label.toLowerCase()))
        if (zoneMatch) {
            const zoneItems = allItems.filter(i => i.zone === zoneMatch.id)
            setFindResult(zoneMatch.id, zoneItems[0]?.id ?? null)
            setZoneFilter(zoneMatch.id)
            const text = zoneItems.length === 0
                ? `${zoneMatch.label} is empty.`
                : `${zoneMatch.label} has ${zoneItems.length} item${zoneItems.length > 1 ? 's' : ''}: ${zoneItems.map(i => i.name).join(', ')}.`
            await speakText(text)
            return
        }

        let text
        if (found.length === 0) {
            text = `I couldn't find ${query} in the inventory.`
        } else if (found.length === 1) {
            const zone = allZones.find(z => z.id === found[0].zone)
            setFindResult(zone?.id ?? null, found[0].id)
            text = zone ? `${found[0].name} is in ${zone.label}.`
                        : `${found[0].name} is in the inventory but hasn't been placed in a zone yet.`
        } else {
            const placed   = found.filter(i => i.zone)
            const unplaced = found.filter(i => !i.zone)
            const parts    = []
            placed.forEach(item => { const z = allZones.find(z => z.id === item.zone); if (z) parts.push(`${item.name} in ${z.label}`) })
            if (unplaced.length > 0) parts.push(`${unplaced.length} not yet placed`)
            text = parts.length > 0
                ? `Found ${found.length} items: ${parts.join(', ')}.`
                : `Found ${found.length} matches for ${query}, none assigned to a zone yet.`
            // Highlight the top match
            const topZone = allZones.find(z => z.id === found[0].zone)
            setFindResult(topZone?.id ?? null, found[0].id)
        }
        await speakText(text)
    }, [setFindResult, setZoneFilter])

    // ── Remove item by voice (name-based, no scan) ────────────────
    const removeByName = useCallback(async (query) => {
        const match = findRemoveCandidate(query)
        if (!match) {
            await speakText(`I couldn't find ${query} in the inventory.`)
            return
        }
        const allZones = trackingRef.current.zones
        const zone = allZones.find(z => z.id === match.zone)
        setRemoveCandidate({ item: match, zone: zone ?? null })
        await speakText(`Found ${match.name}${zone ? ` in ${zone.label}` : ''}. Say confirm or cancel.`)
    }, [findRemoveCandidate])

    removeRef.current = removeByName
    const checkMotion = useCallback(() => {
        const cur = captureFrame()
        if (!cur) return
        if (prevFrame.current) {
            const { score } = frameDiffWithCentroid(prevFrame.current, cur)
            setDiffScore(Math.round(score))

            if (score > MOTION_THRESHOLD) {
                lastMotion.current = Date.now()   // stamp NOW so countdown is always accurate
                setMode(prev => {
                    if (prev === 'idle') {
                        stopPixelDraw()
                        clearInterval(intervalRef.current)
                        intervalRef.current = setInterval(checkMotion, ACTIVE_INTERVAL_MS)
                        playChime()
                    }
                    return 'active'
                })
            }
        }
        prevFrame.current = cur
    }, [captureFrame, stopPixelDraw])

    // ── Idle countdown ────────────────────────────────────────────
    useEffect(() => {
        if (mode !== 'active') {
            setCountdown(null); clearInterval(tickRef.current); startPixelDraw(); return
        }
        // Stamp the enter-active time so the first tick is immediately correct
        if (!lastMotion.current) lastMotion.current = Date.now()
        tickRef.current = setInterval(() => {
            const elapsed   = Date.now() - lastMotion.current
            const remaining = IDLE_TIMEOUT_MS - elapsed
            if (remaining <= 0) {
                setMode('idle')
                clearInterval(intervalRef.current)
                intervalRef.current = setInterval(checkMotion, IDLE_INTERVAL_MS)
                setCountdown(null); clearInterval(tickRef.current)
            } else {
                setCountdown(remaining)
            }
        }, 500)   // tick twice per second for smoother countdown display
        return () => clearInterval(tickRef.current)
    }, [mode, checkMotion, startPixelDraw])

    // ── Voice recognition ──────────────────────────────────────────
    const recognitionRef    = useRef(null)
    const suppressVoiceRef  = useRef(false)
    const voiceReadyRef     = useRef(false)
    const modeRef           = useRef(mode)
    modeRef.current = mode

    useEffect(() => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition
        if (!SR) { setVoiceStatus('unavailable'); return }

        // Reset flags — critical for React strict-mode double-invoke and HMR
        suppressVoiceRef.current = false
        voiceReadyRef.current    = false

        const r = new SR()
        r.continuous     = true
        r.interimResults = false
        r.lang           = 'en-US'
        recognitionRef.current = r

        // Mark ready + show idle immediately (no async wait needed)
        voiceReadyRef.current = true
        setVoiceStatus('idle')

        r.onstart  = () => setVoiceStatus('listening')
        r.onresult = (event) => {
            const result = event.results[event.results.length - 1]
            if (!result.isFinal) return
            const transcript = result[0].transcript.trim().toLowerCase()
            if (isSpeaking) return
            setVoiceTranscript(transcript)
            setTimeout(() => setVoiceTranscript(''), 2500)

            if (removeCandidateRef.current) {
                if (/\b(yes|confirm|yeah|yep|do it|remove it)\b/.test(transcript)) {
                    const { item, zone } = removeCandidateRef.current
                    setRemoveCandidate(null)
                    softRemoveRef.current(item.id)
                    speakText(`${item.name} removed${zone ? ` from ${zone.label}` : ''}.`)
                } else if (/\b(no|cancel|nope|stop|nevermind|never mind)\b/.test(transcript)) {
                    setRemoveCandidate(null)
                    speakText('Cancelled.')
                }
                return
            }

            if (/\b(?:scan(?:\s+(?:this|it|item|now))?|take\s+a?\s*(?:picture|photo)|capture)\b/.test(transcript)) {
                handleScanRef.current?.()
            } else {
                const removeMatch = transcript.match(/\b(?:remove|removing|take out|taken out)\s+(?:the\s+|my\s+)?(.+)/)
                if (removeMatch) { removeRef.current?.(removeMatch[1].trim()); return }
                const findMatch = transcript.match(/(?:find|locate|where(?:'s| is)(?: (?:my|the))?)\s+(.+)/)
                if (findMatch) findItemRef.current?.(findMatch[1].trim())
            }
        }
        r.onerror = (e) => {
            console.warn('[Voice] error:', e.error)
            if (e.error === 'not-allowed') {
                setVoiceStatus('unavailable')
                suppressVoiceRef.current = true
            }
        }
        r.onend = () => {
            if (suppressVoiceRef.current || recognitionRef.current !== r) return
            if (modeRef.current === 'active') {
                setTimeout(() => {
                    if (suppressVoiceRef.current || modeRef.current !== 'active') return
                    try { r.start() } catch {}
                }, 150)
            } else {
                setVoiceStatus('idle')
            }
        }

        // If already active when this effect runs, start right away
        if (modeRef.current === 'active') {
            try { r.start() } catch {}
        }

        return () => {
            // Only stop — do NOT set unavailable or suppress.
            // The next init() run resets those flags itself.
            try { r.abort() } catch {}
            recognitionRef.current = null
            voiceReadyRef.current  = false
        }
    }, [])

    // ── Tie voice lifecycle to active / idle mode ──────────────────
    useEffect(() => {
        // voiceReadyRef may be false during async init — that case is handled
        // by init() itself once it completes (see above).
        if (!voiceReadyRef.current || suppressVoiceRef.current) return
        const r = recognitionRef.current
        if (!r) return

        if (mode === 'active') {
            try { r.start() } catch {} // throws if already started — harmless
        } else {
            try { r.stop() } catch {}
            setVoiceStatus('idle')
        }
    }, [mode])

    // ── Tracking timeout ───────────────────────────────────────────
    useEffect(() => {
        if (!trackingItemId) return
        const t = setTimeout(() => { setTrackingItemId(null); setActiveZoneId(null) }, 30_000)
        return () => clearTimeout(t)
    }, [trackingItemId])

    // ── MediaPipe keep-alive interval ─────────────────────────────
    // Runs processFrame + tick independently of the RAF so MediaPipe
    // never stalls when the camera panel is hidden (display:none).
    useEffect(() => {
        mpIntervalRef.current = setInterval(() => {
            const ht = handTrackerRef.current
            if (!ht) return
            ht.processFrame()
            ht.tick(graceMs)
        }, 100)
        return () => clearInterval(mpIntervalRef.current)
    }, [handTrackerRef, graceMs])

    // ── Camera start ───────────────────────────────────────────────
    const startCamera = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'user' }, audio: false,
            })
            if (videoRef.current) {
                videoRef.current.srcObject = stream
                await videoRef.current.play()
                setCamReady(true); setCamError(null)
                prevFrame.current = null; lastMotion.current = null
                startPixelDraw()
                clearInterval(intervalRef.current)
                intervalRef.current = setInterval(checkMotion, IDLE_INTERVAL_MS)

                // Init MediaPipe HandTracker
                initHandTracker(videoRef.current)

                // Start depth overlay RAF
                startDepthOverlay()
            }
        } catch { setCamError('Camera access denied or unavailable.') }
    }, [checkMotion, startPixelDraw, initHandTracker, startDepthOverlay])

    useEffect(() => {
        startCamera()
        return () => {
            clearInterval(intervalRef.current); clearInterval(tickRef.current)
            cancelAnimationFrame(idleRafRef.current); cancelAnimationFrame(depthRafRef.current)
            videoRef.current?.srcObject?.getTracks().forEach(t => t.stop())
        }
    }, [startCamera])

    // Restart depth overlay when calibration changes (re-reads the latest cal value)
    useEffect(() => {
        cancelAnimationFrame(depthRafRef.current)
        if (camReady) startDepthOverlay()
    }, [calibration, camReady, startDepthOverlay])

    // ── Gemini scan ────────────────────────────────────────────────
    const handleScan = useCallback(async () => {
        const key = apiKey.trim()
        if (!key) { setShowKeyInput(true); return }
        if (scanStatus.state === 'scanning' || scanStatus.state === 'capturing') return
        const video = videoRef.current
        if (!video || video.readyState < 2) return

        try {
            setScanStatus({ state: 'capturing', message: 'Capturing frame…' })
            speakText('Scanning')
            await new Promise(r => setTimeout(r, 80))

            const canvas = captureRef.current
            canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480
            canvas.getContext('2d').drawImage(video, 0, 0)
            const base64 = canvas.toDataURL('image/jpeg', 0.85).replace(/^data:image\/jpeg;base64,/, '')

            setScanStatus({ state: 'scanning', message: 'Identifying item…' })
            const res = await fetch(`${GEMINI_URL}?key=${key}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: base64 } }, { text: SCAN_PROMPT }] }] })
            })

            if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err?.error?.message || `API error ${res.status}`) }

            const json     = await res.json()
            const rawText  = json?.candidates?.[0]?.content?.parts?.[0]?.text || ''
            const jsonMatch = rawText.match(/\{[\s\S]*\}/)
            if (!jsonMatch) throw new Error('Could not parse item data from response')
            const itemData = JSON.parse(jsonMatch[0])

            const newId = addItem(itemData)
            if (zones.length > 0) {
                setTrackingItemId(newId)
                zoneTrackerRef.current.resetDwell()
            }
            setScanStatus({ state: 'success', message: `✓ ${itemData.name} scanned${zones.length > 0 ? ' — place it in a zone' : ''}` })
            speakText(`${itemData.name} scanned`)
        } catch (e) {
            setScanStatus({ state: 'error', message: `✗ ${e.message}` })
        } finally {
            setTimeout(() => setScanStatus(STATUS_IDLE), 4000)
        }
    }, [apiKey, scanStatus.state, addItem, zones.length])

    handleScanRef.current = handleScan
    findItemRef.current   = findItem

    const saveApiKey = () => {
        const k = keyInput.trim(); if (!k) return
        localStorage.setItem('stifficiency_gemini_key', k)
        setApiKey(k); setKeyInput(''); setShowKeyInput(false)
    }

    const isActive   = mode === 'active'
    const isScanning = scanStatus.state === 'scanning' || scanStatus.state === 'capturing'

    const handleRootClick = useCallback(() => { unlockAudio().then(() => setAudioUnlocked(true)) }, [])

    // Manual wake-up: lets user click to go active immediately instead of waiting for motion poll
    const wakeUp = useCallback(() => {
        unlockAudio().then(() => setAudioUnlocked(true))
        if (mode === 'idle') {
            lastMotion.current = Date.now()
            stopPixelDraw()
            clearInterval(intervalRef.current)
            intervalRef.current = setInterval(checkMotion, ACTIVE_INTERVAL_MS)
            setMode('active')
        }
    }, [mode, stopPixelDraw, checkMotion])

    return (
        <div className="camera-root" onClick={handleRootClick}>
            {/* Hidden canvases — video is rendered directly in viewport below */}
            <canvas ref={samplerRef} width={SAMPLE_W} height={SAMPLE_H} style={{ display: 'none' }} />
            <canvas ref={captureRef} style={{ display: 'none' }} />

            {/* Viewport */}
            <div className={`camera-viewport ${isActive ? 'vp-active' : 'vp-idle'}`}>

                {camError ? (
                    <div className="cam-overlay center-col">
                        <span style={{ fontSize: 36 }}>🚫</span>
                        <p className="overlay-text">{camError}</p>
                        <button className="retry-btn" onClick={startCamera}>Retry</button>
                    </div>
                ) : !camReady ? (
                    <div className="cam-overlay center-col">
                        <div className="spinner" />
                        <p className="overlay-text" style={{ marginTop: 12 }}>Starting camera…</p>
                    </div>
                ) : null}

                {isScanning && (
                    <div style={{
                        position: 'absolute', inset: 0, zIndex: 15,
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: 14,
                        background: 'rgba(0,0,0,0.45)',
                        backdropFilter: 'blur(4px)',
                    }}>
                        <div className="scan-pulse-ring" />
                        <div className="spinner" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.2)' }} />
                        <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: 500, letterSpacing: '-0.1px' }}>
                            {scanStatus.message}
                        </p>
                    </div>
                )}

                {/* Single video element — always in DOM so stream persists across tab switches */}
                <video
                    ref={videoRef}
                    id="camera-video"
                    className="camera-video"
                    autoPlay muted playsInline
                    style={{ display: isActive && camReady ? 'block' : 'none' }}
                />

                <canvas
                    ref={pixelRef} className="pixelated-canvas"
                    width={PIXEL_W} height={PIXEL_H}
                    style={{ display: isActive ? 'none' : 'block' }}
                    onClick={wakeUp}
                    title="Click to wake up"
                />
                {!isActive && camReady && (
                    <div className="idle-wake-hint" onClick={wakeUp}>
                        <span>👁 Click anywhere to wake up</span>
                    </div>
                )}

                {/* Depth + dwell canvas overlay */}
                <canvas ref={overlayRef} className="depth-overlay-canvas" />

                {/* Grace pill */}
                {handStateRef.current?.gracePeriod && (
                    <div className="grace-pill">◌ GRACE PERIOD</div>
                )}

                {/* Depth badge */}
                {depthBadge && camReady && (
                    <div className={`depth-badge ${depthBadge.cls}`}>{depthBadge.label}</div>
                )}

                {/* Mode badge */}
                {camReady && (
                    <div className={`mode-badge ${isActive ? 'badge-active' : 'badge-idle'}`}>
                        <span className="badge-dot" />
                        {isActive ? 'Motion Detected' : 'Idle'}
                    </div>
                )}

                {/* Countdown */}
                {isActive && countdown !== null && (
                    <div className="countdown-badge">Idle in {fmtMs(countdown)}</div>
                )}

                {/* Zone overlay — visible while placing, finding, or filtering */}
                {(trackingItemId || highlightedZoneId || zoneFilter) && zones.length > 0 && (
                    <div className="zone-overlay-layer">
                        {zones.map(zone => {
                            const isHighlighted = zone.id === highlightedZoneId
                            const isFiltered    = zone.id === zoneFilter
                            const isActive      = activeZoneId === zone.id
                            return (
                                <div
                                    key={zone.id}
                                    className={[
                                        'zone-hit-rect',
                                        isActive      ? 'zone-hit-active'  : '',
                                        isHighlighted ? 'zone-hit-found'   : '',
                                        isFiltered    ? 'zone-hit-filtered' : '',
                                    ].join(' ').trim()}
                                    style={{
                                        left: `${zone.x * 100}%`, top: `${zone.y * 100}%`,
                                        width: `${zone.w * 100}%`, height: `${zone.h * 100}%`,
                                        borderColor: zone.color, '--zone-color': zone.color,
                                    }}
                                    onClick={() => setZoneFilter(isFiltered ? null : zone.id)}
                                    title={`Filter inventory by "${zone.label}"`}
                                >
                                    <span className="zone-hit-label" style={{ background: zone.color }}>
                                        {zone.label}
                                        {zone.depthTarget ? ' ◉' : ' ○'}
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                )}

                {/* Tracking badge */}
                {trackingItemId && (
                    <div className="tracking-badge">
                        <span className="mini-spinner" style={{ marginRight: 6 }} />
                        Place item in a zone…
                        {dwellProgress > 0 && <span className="dwell-pct"> {Math.round(dwellProgress * 100)}%</span>}
                    </div>
                )}

                {/* Audio unlock nudge */}
                {!audioUnlocked && camReady && <div className="audio-unlock-nudge">Click anywhere to enable audio</div>}

                {/* Voice transcript */}
                {voiceTranscript && (
                    <div className="voice-transcript-badge">
                        <span className="voice-transcript-icon">🎙</span>
                        {voiceTranscript}
                    </div>
                )}

                {/* Placement confirmed */}
                {placedZone && (
                    <div className="placed-badge" style={{ '--zone-color': placedZone.color }}>
                        <span className="placed-check">✓</span>
                        Placed in <strong>{placedZone.label}</strong>
                    </div>
                )}

                {/* Remove confirmation overlay */}
                {removeCandidate && (
                    <div className="remove-confirm-overlay">
                        <div className="remove-confirm-card">
                            <div className="remove-confirm-header">
                                <span className="remove-confirm-icon">🗑️</span>
                                <span className="remove-confirm-title">Remove item?</span>
                            </div>
                            <div className="remove-confirm-item">
                                <span className="remove-item-name">{removeCandidate.item.name}</span>
                                {removeCandidate.item.item_type && (
                                    <span className="remove-item-type">{removeCandidate.item.item_type}</span>
                                )}
                            </div>
                            {removeCandidate.zone && (
                                <div className="remove-item-zone" style={{ '--zone-color': removeCandidate.zone.color }}>
                                    <span className="remove-zone-dot" style={{ background: removeCandidate.zone.color }} />
                                    {removeCandidate.zone.label}
                                </div>
                            )}
                            <div className="remove-confirm-actions">
                                <button
                                    className="remove-btn-confirm"
                                    onClick={() => {
                                        softRemoveItem(removeCandidate.item.id)
                                        speakText(`${removeCandidate.item.name} removed${removeCandidate.zone ? ` from ${removeCandidate.zone.label}` : ''}.`)
                                        setRemoveCandidate(null)
                                    }}
                                >✓ Confirm</button>
                                <button
                                    className="remove-btn-cancel"
                                    onClick={() => { setRemoveCandidate(null); speakText('Cancelled.') }}
                                >✕ Cancel</button>
                            </div>
                            <p className="remove-confirm-hint">Say <strong>confirm</strong> or <strong>cancel</strong></p>
                        </div>
                    </div>
                )}
            </div>

            {/* Scan status bar */}
            <div className={`scan-status-bar scan-status-${scanStatus.state}`}>
                <div className="scan-status-indicator">
                    {scanStatus.state === 'idle'     && <span className="status-dot-sm idle-dot" />}
                    {scanStatus.state === 'capturing' && <span className="mini-spinner" />}
                    {scanStatus.state === 'scanning'  && <span className="mini-spinner" />}
                    {scanStatus.state === 'success'   && <span className="status-icon">✓</span>}
                    {scanStatus.state === 'error'     && <span className="status-icon err">✗</span>}
                </div>
                <span className="scan-status-text">{scanStatus.message}</span>
            </div>

            {/* API key input */}
            {showKeyInput && (
                <div className="api-key-bar">
                    <span className="api-key-label">🔑 Gemini API Key</span>
                    <input className="api-key-input" type="password" placeholder="AIza…" value={keyInput}
                        onChange={e => setKeyInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveApiKey()} autoFocus />
                    <button className="api-key-save" onClick={saveApiKey}>Save</button>
                    <button className="api-key-cancel" onClick={() => setShowKeyInput(false)}>✕</button>
                </div>
            )}

            {/* Footer */}
            <div className="camera-footer">
                <div className="footer-stat">
                    <span className="stat-label">Mode</span>
                    <span className={`stat-val ${isActive ? 'val-active' : 'val-idle'}`}>{isActive ? 'Active' : 'Idle'}</span>
                </div>
                <div className="footer-divider" />

                {/* Mic status */}
                <div className={`mic-pill mic-pill-${voiceStatus}`}>
                    {voiceStatus === 'listening' ? '🎙' : '🎙'}
                    <span className="mic-pill-label">
                        {voiceStatus === 'listening' ? 'Listening' : voiceStatus === 'unavailable' ? 'No mic' : 'Mic idle'}
                    </span>
                </div>
                <div className="footer-divider" />

                {/* Buttons */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 4 }}>
                    {/* Inline text search */}
                    <form
                        style={{ display: 'flex', gap: 4 }}
                        onSubmit={e => {
                            e.preventDefault()
                            const q = searchText.trim()
                            if (!q) return
                            if (q.toUpperCase() === 'TESTONBOARDING') {
                                localStorage.removeItem('storganize_onboarding_done')
                                window.dispatchEvent(new CustomEvent('storganize:admin', { detail: 'TESTONBOARDING' }))
                                setSearchText('')
                                return
                            }
                            findItemRef.current?.(q)
                            setSearchText('')
                        }}
                    >
                        <input
                            className="search-input"
                            type="text"
                            placeholder="Find item…"
                            value={searchText}
                            onChange={e => setSearchText(e.target.value)}
                        />
                        <button className="search-submit" type="submit" disabled={!searchText.trim()}>→</button>
                    </form>
                    <button
                        className="cal-open-btn"
                        onClick={() => setShowCalModal(true)}
                        title={calibration ? `Calibrated ✓ (${calibration.farPalmSize.toFixed(0)}–${calibration.nearPalmSize.toFixed(0)}px)` : 'Calibrate depth'}
                    >
                        {calibration ? 'Recalibrate' : 'Calibrate Depth'}
                    </button>
                    <button
                        id="scan-btn"
                        className={`scan-btn ${isScanning ? 'scan-btn-busy' : ''}`}
                        onClick={handleScan} disabled={!camReady || isScanning}
                    >
                        {isScanning ? <><span className="mini-spinner" /> Scanning…</> : 'Scan'}
                    </button>
                    <button
                        className={`key-btn audio-test-btn-${audioTestStatus ?? 'idle'}`}
                        onClick={async () => {
                            setAudioTestStatus('testing')
                            try { await speakText('hey'); setAudioTestStatus('ok') }
                            catch { setAudioTestStatus('fail') }
                            setTimeout(() => setAudioTestStatus(null), 3000)
                        }}
                        title="Test ElevenLabs audio" disabled={audioTestStatus === 'testing'}
                    >
                        {audioTestStatus === 'testing' ? <span className="mini-spinner" /> : audioTestStatus === 'ok' ? 'Sound ✓' : audioTestStatus === 'fail' ? 'Sound ✗' : 'Sound'}
                    </button>
                    <button id="api-key-btn" className="key-btn" onClick={() => setShowKeyInput(s => !s)} title={apiKey ? 'API key set ✓' : 'Set Gemini API key'}>
                        {apiKey ? 'Key ✓' : 'Key'}
                    </button>
                </div>
            </div>

            {/* Calibration modal */}
            <CalibrationModal open={showCalModal} onClose={() => setShowCalModal(false)} />
        </div>
    )
}
