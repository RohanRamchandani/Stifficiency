import { useEffect, useState } from 'react';
import useCamera from '../../hooks/useCamera';
import './EventToast.css';

/**
 * Shows a brief animated toast whenever `lastEvent` is set on the context.
 * Useful for "Snapshot captured", "Blue car placed in Shelf 1", etc.
 */
export default function EventToast() {
  const { lastEvent } = useCamera();
  const [visible, setVisible] = useState(false);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!lastEvent) return;
    setText(lastEvent.text);
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 3000);
    return () => clearTimeout(timer);
  }, [lastEvent]);

  return (
    <div className={`event-toast ${visible ? 'toast-show' : 'toast-hide'}`}>
      {text}
    </div>
  );
}
