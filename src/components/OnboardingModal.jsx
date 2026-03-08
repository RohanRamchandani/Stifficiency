import { useState, useEffect, useRef } from 'react'
import { useDepth } from '../context/DepthContext'
import { useZones } from '../context/ZonesContext'
import CalibrationModal from './CalibrationModal'
import './OnboardingModal.css'

const ONBOARDING_KEY = 'storganize_onboarding_done'

const VOICE_COMMANDS = [
    { trigger: '"scan" / "scan this"', result: 'Captures a frame and identifies the item you\'re holding' },
    { trigger: '"find [item name]"', result: 'Highlights the zone on camera + scrolls to the item in inventory' },
    { trigger: '"where is my [item]"', result: 'Same as find — works with natural phrasing' },
    { trigger: '"what\'s in [zone name]"', result: 'Lists all items in that zone and filters inventory to it' },
    { trigger: '"remove [item name]"', result: 'Finds the item and asks you to confirm or cancel' },
    { trigger: '"confirm" / "cancel"', result: 'Confirms or cancels a pending removal' },
]

export function shouldShowOnboarding() {
    try { return !localStorage.getItem(ONBOARDING_KEY) } catch { return false }
}

export function markOnboardingDone() {
    try { localStorage.setItem(ONBOARDING_KEY, '1') } catch { }
}

export default function OnboardingModal({ onClose }) {
    const { calibration } = useDepth()
    const { zones } = useZones()
    const [step, setStep] = useState(1)  // 1 | 2 | 3
    const [showCal, setShowCal] = useState(false)

    const totalSteps = 3

    const next = () => {
        if (step < totalSteps) setStep(s => s + 1)
        else finish()
    }
    const finish = () => { markOnboardingDone(); onClose() }

    return (
        <>
            <div className="ob-backdrop">
                <div className="ob-card">
                    {/* Step dots */}
                    <div className="ob-dots">
                        {[1, 2, 3].map(n => (
                            <div key={n} className={`ob-dot ${step === n ? 'ob-dot-active' : step > n ? 'ob-dot-done' : ''}`} />
                        ))}
                    </div>

                    {/* ── Step 1: Calibrate ───────────────────────── */}
                    {step === 1 && (
                        <div className="ob-step">
                            <div className="ob-icon">📐</div>
                            <h2 className="ob-title">Calibrate your hand</h2>
                            <p className="ob-body">
                                Storganize uses your palm size on screen to measure depth. A quick two-step calibration lets it know what "close to the camera" and "arm's length" look like for your setup.
                            </p>
                            <p className="ob-body secondary">
                                You can skip this if you only want 2D zone matching (no depth checking).
                            </p>
                            {calibration && (
                                <div className="ob-done-badge">
                                    Calibration saved ✓
                                </div>
                            )}
                            <div className="ob-actions">
                                <button className="ob-btn-primary" onClick={() => setShowCal(true)}>
                                    {calibration ? 'Recalibrate' : 'Start Calibration'}
                                </button>
                                <button className="ob-btn-ghost" onClick={next}>
                                    {calibration ? 'Continue' : 'Skip for now'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── Step 2: Zones ───────────────────────────── */}
                    {step === 2 && (
                        <div className="ob-step">
                            <div className="ob-icon">🗂️</div>
                            <h2 className="ob-title">Define your storage zones</h2>
                            <p className="ob-body">
                                Go to the <strong>Define Boundaries</strong> tab and draw rectangles directly on the camera feed around each shelf, bin, or drawer. Give each one a name.
                            </p>
                            <div className="ob-steps-list">
                                <div className="ob-step-row"><span className="ob-step-num">1</span>Click the <strong>Define Boundaries</strong> tab in the navbar</div>
                                <div className="ob-step-row"><span className="ob-step-num">2</span>Click and drag to draw a box around a storage area</div>
                                <div className="ob-step-row"><span className="ob-step-num">3</span>Type a name — <em>"Shelf 1"</em>, <em>"Bin A"</em>, etc.</div>
                                <div className="ob-step-row"><span className="ob-step-num">4</span>Repeat for each zone, then come back here</div>
                            </div>
                            {zones.length > 0 && (
                                <div className="ob-done-badge">
                                    {zones.length} zone{zones.length > 1 ? 's' : ''} defined ✓
                                </div>
                            )}
                            <div className="ob-actions">
                                <button className="ob-btn-primary" onClick={next}>
                                    {zones.length > 0 ? 'Continue' : 'I\'ll do this now →'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── Step 3: Voice commands ──────────────────── */}
                    {step === 3 && (
                        <div className="ob-step">
                            <div className="ob-icon">🎙</div>
                            <h2 className="ob-title">Voice commands</h2>
                            <p className="ob-body">
                                The mic is always listening while the system is active. Speak naturally — these phrases are recognised:
                            </p>
                            <div className="ob-commands">
                                {VOICE_COMMANDS.map(cmd => (
                                    <div key={cmd.trigger} className="ob-cmd-row">
                                        <code className="ob-cmd-trigger">{cmd.trigger}</code>
                                        <span className="ob-cmd-result">{cmd.result}</span>
                                    </div>
                                ))}
                            </div>
                            <p className="ob-note">Chrome only — Web Speech API is not supported in Firefox or Safari.</p>
                            <div className="ob-actions">
                                <button className="ob-btn-primary" onClick={finish}>Get Started</button>
                            </div>
                        </div>
                    )}

                    {step > 1 && (
                        <button className="ob-back" onClick={() => setStep(s => s - 1)}>← Back</button>
                    )}
                </div>
            </div>

            <CalibrationModal
                open={showCal}
                onClose={() => { setShowCal(false); next() }}
            />
        </>
    )
}
