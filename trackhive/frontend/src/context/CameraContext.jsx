import { createContext, useContext, useRef, useState, useCallback } from 'react';

const CameraContext = createContext(null);

// Default shelf zones for demo — user can adjust in Setup mode
const DEFAULT_ZONES = [
  { id: 'shelf-1-top', label: 'Shelf 1 — Top', x: 0.05, y: 0.05, w: 0.42, h: 0.22, color: '#6366f1' },
  { id: 'shelf-1-bottom', label: 'Shelf 1 — Bottom', x: 0.05, y: 0.30, w: 0.42, h: 0.22, color: '#8b5cf6' },
  { id: 'shelf-2-top', label: 'Shelf 2 — Top', x: 0.53, y: 0.05, w: 0.42, h: 0.22, color: '#06b6d4' },
  { id: 'shelf-2-bottom', label: 'Shelf 2 — Bottom', x: 0.53, y: 0.30, w: 0.42, h: 0.22, color: '#14b8a6' },
];

export function CameraProvider({ children }) {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const [mode, setMode] = useState('idle');            // idle | setup | scanning
  const [zones, setZones] = useState(DEFAULT_ZONES);
  const [activeZone, setActiveZone] = useState(null);
  const [isMicOn, setIsMicOn] = useState(false);
  const [lastEvent, setLastEvent] = useState(null);     // { text, timestamp }

  const captureFrame = useCallback(() => {
    if (!webcamRef.current) return null;
    return webcamRef.current.getScreenshot();
  }, []);

  const value = {
    webcamRef,
    canvasRef,
    mode,
    setMode,
    zones,
    setZones,
    activeZone,
    setActiveZone,
    isMicOn,
    setIsMicOn,
    lastEvent,
    setLastEvent,
    captureFrame,
  };

  return <CameraContext.Provider value={value}>{children}</CameraContext.Provider>;
}

export function useCameraContext() {
  const ctx = useContext(CameraContext);
  if (!ctx) throw new Error('useCameraContext must be used within <CameraProvider>');
  return ctx;
}

export default CameraContext;
