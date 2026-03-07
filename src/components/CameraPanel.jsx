import { useRef, useEffect, useState, useCallback } from 'react'
import { useItems } from '../context/ItemsContext'
import { useZones } from '../context/ZonesContext'
import './CameraPanel.css'

// ── Motion detection constants ─────────────────────────────────
const IDLE_INTERVAL_MS = 1000
const ACTIVE_INTERVAL_MS = 120
const MOTION_THRESHOLD = 20
const IDLE_TIMEOUT_MS = 3 * 60 * 1000
const SAMPLE_W = 64, SAMPLE_H = 48
const PIXEL_W = 96, PIXEL_H = 72

// ── Tracking config ────────────────────────────────────────────
const ZONE_HIT_CONFIRM = 2   // consecutive frames hand/object must stay in zone
const TRACKING_TIMEOUT_MS = 30_000

// ── ElevenLabs config ─────────────────────────────────────────
const ELEVENLABS_API_KEY = 'sk_60a1e27c2284579def10d8f95dae5697a50219a318b1fd34'
const ELEVENLABS_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'
const ELEVENLABS_URL = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`

// ── Gemini config ──────────────────────────────────────────────
const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
const SCAN_PROMPT = `Analyze this image. A person is holding an item in their hand(s). Identify ONLY the object being held — ignore the person, their hands, the background, furniture, shelves, and anything not being held.
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

// ── Audio context (shared, unlocked on first user gesture) ────
let sharedAudioCtx = null
function getAudioCtx() {
    if (!sharedAudioCtx) {
        sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)()
    }
    return sharedAudioCtx
}
export async function unlockAudio() {
    const ctx = getAudioCtx()
    if (ctx.state === 'suspended') await ctx.resume()
}

// Prevents mic from picking up TTS output
let isSpeaking = false

// ── Browser speech synthesis fallback ────────────────────────
function speakBrowser(text) {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.0
    u.pitch = 1.1
    u.volume = 1.0

    // Prefer an English female voice to approximate Rachel
    const voices = window.speechSynthesis.getVoices()
    const female = voices.find(v =>
        v.lang.startsWith('en') && /zira|samantha|karen|female|woman/i.test(v.name)
    ) || voices.find(v => v.lang.startsWith('en'))
    if (female) u.voice = female

    isSpeaking = true
    u.onend = () => { setTimeout(() => { isSpeaking = false }, 600) }
    u.onerror = () => { isSpeaking = false }
    window.speechSynthesis.speak(u)
}

// ── ElevenLabs TTS → browser fallback ─────────────────────────
async function speakText(text) {
    if (!ELEVENLABS_API_KEY) { speakBrowser(text); return }
    isSpeaking = true
    console.log('TTS Speaking:', text)
    try {
        await unlockAudio()
        const response = await fetch(ELEVENLABS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': ELEVENLABS_API_KEY,
            },
            body: JSON.stringify({
                text,
                model_id: 'eleven_multilingual_v2',
                voice_settings: { stability: 0.5, similarity_boost: 0.5 },
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
        speakBrowser(text)  // speakBrowser sets isSpeaking = false via onend
    }
}

// Returns { score, centroid: {x,y} normalised 0-1, or null if no significant motion pixels }
function frameDiffWithCentroid(a, b) {
    let sum = 0, cx = 0, cy = 0, count = 0
    const len = a.data.length
    for (let i = 0; i < len; i += 4) {
        const d = (Math.abs(a.data[i] - b.data[i]) +
            Math.abs(a.data[i + 1] - b.data[i + 1]) +
            Math.abs(a.data[i + 2] - b.data[i + 2])) / 3
        sum += d
        if (d > 15) {
            const px = (i / 4) % SAMPLE_W
            const py = Math.floor((i / 4) / SAMPLE_W)
            cx += px; cy += py; count++
        }
    }
    return {
        score: sum / (len / 4),
        centroid: count > 8 ? { x: cx / count / SAMPLE_W, y: cy / count / SAMPLE_H } : null,
    }
}

function fmtMs(ms) {
    const s = Math.ceil(ms / 1000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Scan statuses
// { state: 'idle' | 'capturing' | 'scanning' | 'success' | 'error', message }
const STATUS_IDLE = { state: 'idle', message: 'Ready to scan' }

export default function CameraPanel() {
    const videoRef = useRef(null)
    const samplerRef = useRef(null)
    const captureRef = useRef(null)   // full-res capture canvas
    const pixelRef = useRef(null)
    const prevFrame = useRef(null)
    const intervalRef = useRef(null)
    const lastMotion = useRef(null)
    const tickRef = useRef(null)
    const idleRafRef = useRef(null)

    const [mode, setMode] = useState('idle')
    const [camError, setCamError] = useState(null)
    const [camReady, setCamReady] = useState(false)
    const [diffScore, setDiffScore] = useState(0)
    const [countdown, setCountdown] = useState(null)
    const [scanStatus, setScanStatus] = useState(STATUS_IDLE)
    const [apiKey, setApiKey] = useState(() => localStorage.getItem('stifficiency_gemini_key') || import.meta.env.VITE_GEMINI_API_KEY || 'AIzaSyD-GJXGcl9TIfvegUk4eVVq2-dBsa-UJOQ')
    const [keyInput, setKeyInput] = useState('')
    const [showKeyInput, setShowKeyInput] = useState(false)

    const { items, addItem, setItemZone } = useItems()
    const { zones } = useZones()

    // ── Voice state ───────────────────────────────────────────────
    const [voiceStatus, setVoiceStatus] = useState('loading') // 'loading'|'listening'|'unavailable'
    const [voiceTranscript, setVoiceTranscript] = useState('')
    const [audioUnlocked, setAudioUnlocked] = useState(false)
    const [audioTestStatus, setAudioTestStatus] = useState(null) // null | 'testing' | 'ok' | 'fail'

    // ── Tracking state ────────────────────────────────────────────
    const [trackingItemId, setTrackingItemId] = useState(null)
    const [activeZoneId, setActiveZoneId] = useState(null)
    const [placedZone, setPlacedZone] = useState(null)

    // Stable refs so checkMotion always reads the latest values without deps changing
    const trackingRef = useRef({ itemId: null, zones: [] })
    const setItemZoneRef = useRef(setItemZone)
    const zoneHitCountRef = useRef(0)
    const zoneHitIdRef = useRef(null)

    // Keep refs in sync every render
    trackingRef.current.itemId = trackingItemId
    trackingRef.current.zones = zones
    setItemZoneRef.current = setItemZone

    // Stable refs for items and callbacks (used inside voice recognition)
    const itemsRef = useRef(items)
    itemsRef.current = items
    const handleScanRef = useRef(null)
    const findItemRef = useRef(null)

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

    // ── Frame sampling ────────────────────────────────────────────
    const captureFrame = useCallback(() => {
        const v = videoRef.current, c = samplerRef.current
        if (!v || !c || v.readyState < 2) return null
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(v, 0, 0, SAMPLE_W, SAMPLE_H)
        return ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H)
    }, [])

    // ── Find item by voice query ──────────────────────────────────
    const findItem = useCallback(async (query) => {
        const q = query.toLowerCase().trim()
        // Split into meaningful words (skip tiny filler words)
        const words = q.split(/\s+/).filter(w => w.length > 1 && !['a','an','the','my','some'].includes(w))
        const allItems = itemsRef.current
        const allZones = trackingRef.current.zones

        const scoreItem = (item) => {
            const haystack = [
                item.name, item.category, item.item_type,
                item.distinguishing_features?.brand,
                item.distinguishing_features?.color,
            ].filter(Boolean).join(' ').toLowerCase()
            if (haystack.includes(q)) return words.length + 2   // exact phrase — top score
            return words.filter(w => haystack.includes(w)).length // word-level partial
        }

        // Require at least 1 word to match (very permissive — handles plurals, extra words, etc.)
        const scored = allItems
            .map(item => ({ item, s: scoreItem(item) }))
            .filter(({ s }) => s >= 1)
            .sort((a, b) => b.s - a.s)

        const found = scored.map(({ item }) => item)

        let text
        if (found.length === 0) {
            text = `I couldn't find ${query} in the inventory.`
        } else if (found.length === 1) {
            const zone = allZones.find(z => z.id === found[0].zone)
            text = zone
                ? `${found[0].name} is in ${zone.label}.`
                : `${found[0].name} is in the inventory but hasn't been placed in a zone yet.`
        } else {
            const placed = found.filter(i => i.zone)
            const unplaced = found.filter(i => !i.zone)
            const parts = []
            placed.forEach(item => {
                const zone = allZones.find(z => z.id === item.zone)
                if (zone) parts.push(`${item.name} in ${zone.label}`)
            })
            if (unplaced.length > 0) parts.push(`${unplaced.length} not yet placed`)
            text = parts.length > 0
                ? `Found ${found.length} items: ${parts.join(', ')}.`
                : `Found ${found.length} matches for ${query}, none assigned to a zone yet.`
        }

        await speakText(text)
    }, [])

    // ── Motion check ──────────────────────────────────────────────
    // (keep handleScanRef/findItemRef current — assigned after handleScan is defined below)

    const checkMotion = useCallback(() => {
        const cur = captureFrame()
        if (!cur) return
        if (prevFrame.current) {
            const { score, centroid } = frameDiffWithCentroid(prevFrame.current, cur)
            setDiffScore(Math.round(score))

            if (score > MOTION_THRESHOLD) {
                lastMotion.current = Date.now()
                setMode(prev => {
                    if (prev === 'idle') {
                        stopPixelDraw()
                        clearInterval(intervalRef.current)
                        intervalRef.current = setInterval(checkMotion, ACTIVE_INTERVAL_MS)
                        speakText('hey')
                    }
                    return 'active'
                })
            }

            // ── Zone placement tracking ───────────────────────────
            const { itemId, zones: currentZones } = trackingRef.current
            if (itemId && centroid && currentZones.length > 0) {
                const hit = currentZones.find(z =>
                    centroid.x >= z.x && centroid.x <= z.x + z.w &&
                    centroid.y >= z.y && centroid.y <= z.y + z.h
                ) ?? null

                setActiveZoneId(hit?.id ?? null)

                if (hit) {
                    if (zoneHitIdRef.current === hit.id) {
                        zoneHitCountRef.current++
                        if (zoneHitCountRef.current >= ZONE_HIT_CONFIRM) {
                            // Confirmed — assign item to zone
                            setItemZoneRef.current(itemId, hit.id)
                            trackingRef.current.itemId = null
                            setTrackingItemId(null)
                            setActiveZoneId(null)
                            setPlacedZone({ label: hit.label, color: hit.color })
                            zoneHitCountRef.current = 0
                            zoneHitIdRef.current = null
                            setTimeout(() => setPlacedZone(null), 3500)
                        }
                    } else {
                        zoneHitIdRef.current = hit.id
                        zoneHitCountRef.current = 1
                    }
                } else {
                    zoneHitCountRef.current = 0
                    zoneHitIdRef.current = null
                }
            }
        }
        prevFrame.current = cur
    }, [captureFrame, stopPixelDraw])

    // ── Idle countdown ────────────────────────────────────────────
    useEffect(() => {
        if (mode !== 'active') {
            setCountdown(null); clearInterval(tickRef.current); startPixelDraw(); return
        }
        tickRef.current = setInterval(() => {
            const remaining = IDLE_TIMEOUT_MS - (Date.now() - (lastMotion.current ?? Date.now()))
            if (remaining <= 0) {
                setMode('idle')
                clearInterval(intervalRef.current)
                intervalRef.current = setInterval(checkMotion, IDLE_INTERVAL_MS)
                setCountdown(null); clearInterval(tickRef.current)
            } else setCountdown(remaining)
        }, 1000)
        return () => clearInterval(tickRef.current)
    }, [mode, checkMotion, startPixelDraw])

    // ── Voice recognition ─────────────────────────────────────────
    useEffect(() => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition
        if (!SR) {
            console.warn('[Voice] SpeechRecognition not supported in this browser (use Chrome/Edge)')
            setVoiceStatus('unavailable')
            return
        }

        let recognition = null
        let suppressRestart = false

        async function startRecognition() {
            // Explicitly request microphone permission first
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
                stream.getTracks().forEach(t => t.stop()) // we only needed the permission grant
                console.log('[Voice] Microphone permission granted')
            } catch (err) {
                console.error('[Voice] Microphone permission denied:', err)
                setVoiceStatus('unavailable')
                return
            }

            recognition = new SR()
            recognition.continuous = true
            recognition.interimResults = false
            recognition.lang = 'en-US'

            recognition.onstart = () => {
                console.log('[Voice] Recognition started, listening…')
                setVoiceStatus('listening')
            }

            recognition.onresult = (event) => {
                const result = event.results[event.results.length - 1]
                if (!result.isFinal) return
                const transcript = result[0].transcript.trim().toLowerCase()
                console.log('[Voice] Heard:', transcript, isSpeaking ? '(ignored — TTS playing)' : '')

                // Ignore anything heard while TTS is playing (prevents feedback loops)
                if (isSpeaking) return

                setVoiceTranscript(transcript)
                setTimeout(() => setVoiceTranscript(''), 2500)

                if (/\bscan\s+this\b/.test(transcript)) {
                    console.log('[Voice] Triggering scan')
                    handleScanRef.current?.()
                } else {
                    const findMatch = transcript.match(/(?:find|locate|where(?:'s| is)(?: (?:my|the))?)\s+(.+)/)
                    if (findMatch) {
                        console.log('[Voice] Find query:', findMatch[1])
                        findItemRef.current?.(findMatch[1].trim())
                    }
                }
            }

            recognition.onerror = (e) => {
                console.warn('[Voice] Recognition error:', e.error)
                if (e.error === 'not-allowed') {
                    setVoiceStatus('unavailable')
                    suppressRestart = true
                }
            }

            recognition.onend = () => {
                console.log('[Voice] Recognition ended, restarting…')
                if (!suppressRestart) {
                    setTimeout(() => {
                        try { recognition.start() } catch (err) { console.warn('[Voice] Restart failed:', err) }
                    }, 300)
                }
            }

            recognition.start()
        }

        startRecognition()

        return () => {
            suppressRestart = true
            try { recognition?.stop() } catch { }
            setVoiceStatus('unavailable')
        }
    }, []) // stable via refs

    // ── Tracking timeout ──────────────────────────────────────────
    useEffect(() => {
        if (!trackingItemId) return
        const t = setTimeout(() => {
            setTrackingItemId(null)
            setActiveZoneId(null)
        }, TRACKING_TIMEOUT_MS)
        return () => clearTimeout(t)
    }, [trackingItemId])

    // ── Camera start ──────────────────────────────────────────────
    const startCamera = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'user' },
                audio: false,
            })
            if (videoRef.current) {
                videoRef.current.srcObject = stream
                await videoRef.current.play()
                setCamReady(true); setCamError(null)
                prevFrame.current = null; lastMotion.current = null
                startPixelDraw()
                clearInterval(intervalRef.current)
                intervalRef.current = setInterval(checkMotion, IDLE_INTERVAL_MS)
            }
        } catch { setCamError('Camera access denied or unavailable.') }
    }, [checkMotion, startPixelDraw])

    useEffect(() => {
        startCamera()
        return () => {
            clearInterval(intervalRef.current); clearInterval(tickRef.current)
            cancelAnimationFrame(idleRafRef.current)
            videoRef.current?.srcObject?.getTracks().forEach(t => t.stop())
        }
    }, [startCamera])

    // ── Gemini scan ───────────────────────────────────────────────
    const handleScan = useCallback(async () => {
        const key = apiKey.trim()
        if (!key) { setShowKeyInput(true); return }
        if (scanStatus.state === 'scanning' || scanStatus.state === 'capturing') return

        const video = videoRef.current
        if (!video || video.readyState < 2) return

        try {
            // 1. Capture full-res frame
            setScanStatus({ state: 'capturing', message: 'Capturing frame…' })
            speakText('Scanning')
            await new Promise(r => setTimeout(r, 80))  // let UI update

            const canvas = captureRef.current
            canvas.width = video.videoWidth || 640
            canvas.height = video.videoHeight || 480
            canvas.getContext('2d').drawImage(video, 0, 0)
            const base64 = canvas.toDataURL('image/jpeg', 0.85).replace(/^data:image\/jpeg;base64,/, '')

            // 2. Send to Gemini
            setScanStatus({ state: 'scanning', message: 'Identifying item…' })
            const res = await fetch(`${GEMINI_URL}?key=${key}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { inline_data: { mime_type: 'image/jpeg', data: base64 } },
                            { text: SCAN_PROMPT },
                        ]
                    }]
                })
            })

            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err?.error?.message || `API error ${res.status}`)
            }

            const json = await res.json()
            const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text || ''

            // 3. Parse JSON from response (strip markdown fences if present)
            const jsonMatch = rawText.match(/\{[\s\S]*\}/)
            if (!jsonMatch) throw new Error('Could not parse item data from response')
            const itemData = JSON.parse(jsonMatch[0])

            // 4. Save item + start zone placement tracking
            const newId = addItem(itemData)
            if (zones.length > 0) {
                setTrackingItemId(newId)
                zoneHitCountRef.current = 0
                zoneHitIdRef.current = null
            }
            setScanStatus({ state: 'success', message: `✓ ${itemData.name} scanned${zones.length > 0 ? ' — place it in a zone' : ''}` })
            speakText(`${itemData.name} scanned`)

        } catch (e) {
            console.error('Scan error:', e)
            setScanStatus({ state: 'error', message: `✗ ${e.message}` })
        } finally {
            // Auto-reset status after 4 seconds
            setTimeout(() => setScanStatus(STATUS_IDLE), 4000)
        }
    }, [apiKey, scanStatus.state, addItem])

    // Keep voice-recognition refs current every render
    handleScanRef.current = handleScan
    findItemRef.current = findItem

    // Save API key
    const saveApiKey = () => {
        const k = keyInput.trim()
        if (!k) return
        localStorage.setItem('stifficiency_gemini_key', k)
        setApiKey(k)
        setKeyInput('')
        setShowKeyInput(false)
    }

    const isActive = mode === 'active'
    const isScanning = scanStatus.state === 'scanning' || scanStatus.state === 'capturing'

    const handleRootClick = useCallback(() => {
        unlockAudio().then(() => setAudioUnlocked(true))
    }, [])

    return (
        <div className="camera-root" onClick={handleRootClick}>
            {/* Hidden canvases */}
            <canvas ref={samplerRef} width={SAMPLE_W} height={SAMPLE_H} style={{ display: 'none' }} />
            <canvas ref={captureRef} style={{ display: 'none' }} />
            <video ref={videoRef} autoPlay muted playsInline style={{ display: 'none' }} />

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

                {/* Scanning overlay */}
                {isScanning && (
                    <div className="cam-overlay center-col scanning-overlay">
                        <div className="scan-pulse-ring" />
                        <div className="spinner" />
                        <p className="overlay-text" style={{ marginTop: 14, fontSize: 14, color: '#c4b8ff' }}>
                            {scanStatus.message}
                        </p>
                    </div>
                )}

                {isActive && camReady && <ActiveVideo srcVideo={videoRef} />}

                <canvas
                    ref={pixelRef} className="pixelated-canvas"
                    width={PIXEL_W} height={PIXEL_H}
                    style={{ display: isActive ? 'none' : 'block' }}
                />

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

                {/* Zone hitbox overlays — visible only while tracking */}
                {trackingItemId && zones.length > 0 && (
                    <div className="zone-overlay-layer">
                        {zones.map(zone => (
                            <div
                                key={zone.id}
                                className={`zone-hit-rect ${activeZoneId === zone.id ? 'zone-hit-active' : ''}`}
                                style={{
                                    left: `${zone.x * 100}%`,
                                    top: `${zone.y * 100}%`,
                                    width: `${zone.w * 100}%`,
                                    height: `${zone.h * 100}%`,
                                    borderColor: zone.color,
                                    '--zone-color': zone.color,
                                }}
                            >
                                <span className="zone-hit-label" style={{ background: zone.color }}>
                                    {zone.label}
                                </span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Tracking badge */}
                {trackingItemId && (
                    <div className="tracking-badge">
                        <span className="mini-spinner" style={{ marginRight: 6 }} />
                        Place item in a zone…
                    </div>
                )}

                {/* Audio unlock nudge — shows until first click */}
                {!audioUnlocked && camReady && (
                    <div className="audio-unlock-nudge">
                        Click anywhere to enable audio
                    </div>
                )}

                {/* Voice transcript flash */}
                {voiceTranscript && (
                    <div className="voice-transcript-badge">
                        <span className="voice-transcript-icon">🎙</span>
                        {voiceTranscript}
                    </div>
                )}

                {/* Placement confirmed badge */}
                {placedZone && (
                    <div className="placed-badge" style={{ '--zone-color': placedZone.color }}>
                        <span className="placed-check">✓</span>
                        Placed in <strong>{placedZone.label}</strong>
                    </div>
                )}
            </div>

            {/* Scan status bar */}
            <div className={`scan-status-bar scan-status-${scanStatus.state}`}>
                <div className="scan-status-indicator">
                    {scanStatus.state === 'idle' && <span className="status-dot-sm idle-dot" />}
                    {scanStatus.state === 'capturing' && <span className="mini-spinner" />}
                    {scanStatus.state === 'scanning' && <span className="mini-spinner" />}
                    {scanStatus.state === 'success' && <span className="status-icon">✓</span>}
                    {scanStatus.state === 'error' && <span className="status-icon err">✗</span>}
                </div>
                <span className="scan-status-text">{scanStatus.message}</span>
            </div>

            {/* API key input (inline, shown on demand) */}
            {showKeyInput && (
                <div className="api-key-bar">
                    <span className="api-key-label">🔑 Gemini API Key</span>
                    <input
                        className="api-key-input"
                        type="password"
                        placeholder="AIza…"
                        value={keyInput}
                        onChange={e => setKeyInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && saveApiKey()}
                        autoFocus
                    />
                    <button className="api-key-save" onClick={saveApiKey}>Save</button>
                    <button className="api-key-cancel" onClick={() => setShowKeyInput(false)}>✕</button>
                </div>
            )}

            {/* Scan button + footer stats */}
            <div className="camera-footer">
                <div className="footer-stat">
                    <span className="stat-label">Mode</span>
                    <span className={`stat-val ${isActive ? 'val-active' : 'val-idle'}`}>{isActive ? 'Active' : 'Idle'}</span>
                </div>
                <div className="footer-divider" />
                <div className="footer-stat">
                    <span className="stat-label">Sample rate</span>
                    <span className="stat-val">{isActive ? `${ACTIVE_INTERVAL_MS}ms` : `${IDLE_INTERVAL_MS}ms`}</span>
                </div>
                <div className="footer-divider" />
                <div className="footer-stat">
                    <span className="stat-label">Motion score</span>
                    <span className={`stat-val ${diffScore > MOTION_THRESHOLD ? 'val-active' : ''}`}>
                        {diffScore}<span className="stat-unit"> / {MOTION_THRESHOLD}</span>
                    </span>
                </div>
                <div className="footer-divider" />

                {/* Mic status */}
                <div className={`mic-pill mic-pill-${voiceStatus}`}>
                    {voiceStatus === 'listening' ? '🎙' : '🎙✕'}
                    <span className="mic-pill-label">
                        {voiceStatus === 'listening' ? 'Listening' : voiceStatus === 'unavailable' ? 'No mic' : '…'}
                    </span>
                </div>
                <div className="footer-divider" />

                {/* Scan + key buttons */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 4 }}>
                    <button
                        id="scan-btn"
                        className={`scan-btn ${isScanning ? 'scan-btn-busy' : ''}`}
                        onClick={handleScan}
                        disabled={!camReady || isScanning}
                    >
                        {isScanning ? <><span className="mini-spinner" /> Scanning…</> : '📸 Scan Item'}
                    </button>
                    <button
                        className={`key-btn audio-test-btn-${audioTestStatus ?? 'idle'}`}
                        onClick={async () => {
                            setAudioTestStatus('testing')
                            try {
                                await speakText('hey')
                                setAudioTestStatus('ok')
                            } catch {
                                setAudioTestStatus('fail')
                            }
                            setTimeout(() => setAudioTestStatus(null), 3000)
                        }}
                        title="Test ElevenLabs audio"
                        disabled={audioTestStatus === 'testing'}
                    >
                        {audioTestStatus === 'testing' ? <span className="mini-spinner" /> : audioTestStatus === 'ok' ? '🔊✓' : audioTestStatus === 'fail' ? '🔊✗' : '🔊'}
                    </button>
                    <button
                        id="api-key-btn"
                        className="key-btn"
                        onClick={() => setShowKeyInput(s => !s)}
                        title={apiKey ? 'API key set ✓' : 'Set Gemini API key'}
                    >
                        {apiKey ? '🔑✓' : '🔑'}
                    </button>
                </div>
            </div>
        </div>
    )
}

function ActiveVideo({ srcVideo }) {
    const ref = useRef(null)
    useEffect(() => {
        const src = srcVideo.current
        if (ref.current && src?.srcObject) {
            ref.current.srcObject = src.srcObject
            ref.current.play().catch(() => { })
        }
    }, [srcVideo])
    return <video ref={ref} id="camera-video" className="camera-video" autoPlay muted playsInline />
}
