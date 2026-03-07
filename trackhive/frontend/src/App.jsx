import { CameraProvider } from './context/CameraContext';
import { CameraFeed } from './components/camera';
import './index.css';

export default function App() {
  return (
    <CameraProvider>
      <CameraFeed />
    </CameraProvider>
  );
}
