import useCamera from '../../hooks/useCamera';
import './CameraControls.css';

const MODES = ['idle', 'setup', 'scanning'];

export default function CameraControls() {
  const { mode, setMode, isMicOn, setIsMicOn, captureFrame, setLastEvent } = useCamera();

  const cycleMode = () => {
    const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    setMode(next);
  };

  const handleSnapshot = () => {
    const dataUrl = captureFrame();
    if (dataUrl) {
      setLastEvent({ text: 'Snapshot captured', timestamp: Date.now() });
      // In production this would pipe into Gemini Vision — for now just log
      console.log('[TrackHive] Frame captured', dataUrl.slice(0, 60) + '…');
    }
  };

  return (
    <div className="camera-controls">
      {/* Mode toggle */}
      <button
        id="btn-mode-toggle"
        className="ctrl-btn ctrl-mode"
        onClick={cycleMode}
        title="Switch mode"
      >
        <span className="ctrl-icon">⚙️</span>
        <span className="ctrl-text">{mode === 'idle' ? 'Start Setup' : mode === 'setup' ? 'Start Scan' : 'Stop'}</span>
      </button>

      {/* Mic toggle */}
      <button
        id="btn-mic-toggle"
        className={`ctrl-btn ctrl-mic ${isMicOn ? 'mic-active' : ''}`}
        onClick={() => setIsMicOn((prev) => !prev)}
        title="Toggle microphone"
      >
        <span className="ctrl-icon">{isMicOn ? '🎙️' : '🔇'}</span>
        <span className="ctrl-text">{isMicOn ? 'Mic On' : 'Mic Off'}</span>
      </button>

      {/* Snapshot */}
      <button
        id="btn-snapshot"
        className="ctrl-btn ctrl-snap"
        onClick={handleSnapshot}
        title="Capture frame"
      >
        <span className="ctrl-icon">📸</span>
        <span className="ctrl-text">Snapshot</span>
      </button>
    </div>
  );
}
