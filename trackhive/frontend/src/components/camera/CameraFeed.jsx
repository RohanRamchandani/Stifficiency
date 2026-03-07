import Webcam from 'react-webcam';
import useCamera from '../../hooks/useCamera';
import ZoneOverlay from './ZoneOverlay';
import ModeIndicator from './ModeIndicator';
import CameraControls from './CameraControls';
import EventToast from './EventToast';
import './CameraFeed.css';

const VIDEO_CONSTRAINTS = {
  facingMode: 'environment',
  width: { ideal: 1280 },
  height: { ideal: 720 },
};

export default function CameraFeed() {
  const { webcamRef, mode } = useCamera();

  return (
    <div className="camera-feed-wrapper" id="camera-feed" data-mode={mode}>
      {/* ── Header bar ── */}
      <header className="camera-header">
        <div className="camera-header-left">
          <span className="logo-icon">📦</span>
          <h1 className="logo-text">TrackHive</h1>
        </div>
        <ModeIndicator />
      </header>

      {/* ── Live feed + overlay ── */}
      <div className="camera-viewport">
        <Webcam
          ref={webcamRef}
          audio={false}
          screenshotFormat="image/jpeg"
          videoConstraints={VIDEO_CONSTRAINTS}
          className="camera-video"
          mirrored={false}
        />
        <ZoneOverlay />

        {/* Scan-line animation in scanning mode */}
        <div className="scan-line" />
      </div>

      {/* ── Event toast ── */}
      <EventToast />

      {/* ── Bottom controls ── */}
      <div className="camera-controls-dock">
        <CameraControls />
      </div>
    </div>
  );
}
