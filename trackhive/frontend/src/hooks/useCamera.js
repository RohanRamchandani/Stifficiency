import { useCameraContext } from '../context/CameraContext';

/**
 * Convenience hook – re-exports everything from CameraContext.
 * Components import `useCamera` instead of reaching for the context directly.
 */
export default function useCamera() {
  return useCameraContext();
}
