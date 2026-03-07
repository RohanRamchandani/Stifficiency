import useCamera from '../../hooks/useCamera';
import './ModeIndicator.css';

const MODE_META = {
  idle:     { label: 'Idle',     className: 'mode-idle' },
  setup:    { label: 'Setup',    className: 'mode-setup' },
  scanning: { label: 'Scanning', className: 'mode-scanning' },
};

export default function ModeIndicator() {
  const { mode, isMicOn } = useCamera();
  const meta = MODE_META[mode] || MODE_META.idle;

  return (
    <div className={`mode-indicator ${meta.className}`}>
      <span className="mode-dot" />
      <span className="mode-label">{meta.label}</span>
      {isMicOn && <span className="mic-badge">🎙️ Listening</span>}
    </div>
  );
}
