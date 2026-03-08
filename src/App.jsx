import { useState } from 'react'
import { ZonesProvider } from './context/ZonesContext'
import { ItemsProvider } from './context/ItemsContext'
import { DepthProvider } from './context/DepthContext'
import { SearchProvider } from './context/SearchContext'
import CameraPanel from './components/CameraPanel'
import BoundariesPanel from './components/BoundariesPanel'
import InventoryPanel from './components/InventoryPanel'
import OnboardingModal, { shouldShowOnboarding } from './components/OnboardingModal'
import './App.css'

const TABS = [
    { id: 'camera', label: 'Camera' },
    { id: 'boundaries', label: 'Define Boundaries' },
    { id: 'inventory', label: 'Inventory' },
]

export default function App() {
    const [activeTab, setActiveTab] = useState('camera')
    const [showOnboarding, setShowOnboarding] = useState(() => shouldShowOnboarding())

    return (
        <ZonesProvider>
            <ItemsProvider>
                <DepthProvider>
                    <SearchProvider>
                        <div className="app-root">
                            <nav className="navbar">
                                <div className="navbar-brand">
                                    <div className="brand-icon">⬡</div>
                                    <span className="brand-name">Storganize</span>
                                </div>
                                <div className="tab-bar">
                                    {TABS.map(tab => (
                                        <button
                                            key={tab.id}
                                            id={`tab-${tab.id}`}
                                            className={`tab-btn ${activeTab === tab.id ? 'tab-active' : ''}`}
                                            onClick={() => setActiveTab(tab.id)}
                                        >
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>
                                <div className="navbar-right">
                                    <div className="status-pill">
                                        <span className="status-dot" />
                                        Online
                                    </div>
                                </div>
                            </nav>

                            <main className="panel-area">
                                {/* Always mounted — hidden with display:none to preserve camera + MediaPipe state across tab switches */}
                                <div className="panel" style={{ padding: 0, overflow: 'hidden', display: activeTab === 'camera' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
                                    <CameraPanel />
                                </div>
                                <div className="panel" style={{ padding: 0, overflow: 'hidden', display: activeTab === 'boundaries' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
                                    <BoundariesPanel />
                                </div>
                                <div className="panel" style={{ padding: 0, overflow: 'hidden', display: activeTab === 'inventory' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
                                    <InventoryPanel />
                                </div>

                            </main>

                            {showOnboarding && (
                                <OnboardingModal onClose={() => setShowOnboarding(false)} />
                            )}
                        </div>
                    </SearchProvider>
                </DepthProvider>
            </ItemsProvider>
        </ZonesProvider>
    )
}
