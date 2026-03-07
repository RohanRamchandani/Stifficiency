import { useState, useEffect, useRef, useCallback } from 'react'
import { useItems } from '../context/ItemsContext'
import { useZones } from '../context/ZonesContext'
import { useSearch } from '../context/SearchContext'
import './InventoryPanel.css'

function timeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso)) / 1000)
    if (s < 60) return 'just now'
    if (s < 3600) return `${Math.floor(s / 60)}m ago`
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`
    return `${Math.floor(s / 86400)}d ago`
}

const UNASSIGNED_KEY = '__unassigned__'

function groupBy(arr, key, fallback = UNASSIGNED_KEY) {
    return arr.reduce((acc, item) => {
        const k = item[key] != null ? item[key] : fallback
        if (!acc[k]) acc[k] = []
        acc[k].push(item)
        return acc
    }, {})
}

function FeaturePills({ features }) {
    if (!features) return null
    return (
        <div className="feature-pills">
            {Object.entries(features).map(([k, v]) => v && (
                <span key={k} className="feature-pill">
                    <span className="pill-key">{k}:</span> {v}
                </span>
            ))}
        </div>
    )
}

function ItemCard({ item, onRemove, highlighted, zones }) {
    const [expanded, setExpanded] = useState(false)
    const ref = useRef(null)
    const zone = zones?.find(z => z.id === item.zone)

    // Auto-expand and scroll into view when highlighted
    useEffect(() => {
        if (highlighted) {
            setExpanded(true)
            ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
    }, [highlighted])

    return (
        <div
            ref={ref}
            className={`item-card ${highlighted ? 'item-card-highlighted' : ''} ${item.status === 'out' ? 'item-card-removed' : ''}`}
            onClick={() => setExpanded(e => !e)}
        >
            <div className="item-card-header">
                <div className="item-card-left">
                    <span className="item-name">{item.name}</span>
                    <span className="item-type">{item.item_type}</span>
                </div>
                <div className="item-card-right">
                    <span className="item-time">{timeAgo(item.timestamp)}</span>
                    <button className="item-remove" onClick={e => { e.stopPropagation(); onRemove(item.id) }}>✕</button>
                </div>
            </div>
            {expanded && (
                <div className="item-card-body">
                    {zone
                        ? <div className="item-loc" style={{ '--zone-color': zone.color }}>
                            <span className="loc-dot-sm" style={{ background: zone.color }} />
                            {zone.label}
                          </div>
                        : <div className="item-loc unassigned">📍 Location not set</div>
                    }
                    <FeaturePills features={item.distinguishing_features} />
                </div>
            )}
        </div>
    )
}

function CategoryGroup({ name, items, onRemove, highlightedItemId, zones }) {
    const [open, setOpen] = useState(true)
    return (
        <div className="cat-group">
            <button className="cat-group-header" onClick={() => setOpen(o => !o)}>
                <span className="cat-chevron">{open ? '▾' : '▸'}</span>
                <span className="cat-name">{name}</span>
                <span className="cat-count">{items.length}</span>
            </button>
            {open && (
                <div className="cat-group-body">
                    {items.map(item => (
                        <ItemCard
                            key={item.id}
                            item={item}
                            onRemove={onRemove}
                            highlighted={item.id === highlightedItemId}
                            zones={zones}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

export default function InventoryPanel() {
    const { items, removeItem } = useItems()
    const { zones } = useZones()
    const { highlightedItemId, highlightedZoneId, zoneFilter, clearZoneFilter } = useSearch()
    const [tab, setTab] = useState('category')
    const [showRemoved, setShowRemoved] = useState(false)

    // Auto-switch to location tab when a zone filter activates
    useEffect(() => {
        if (zoneFilter) setTab('location')
    }, [zoneFilter])

    // If a find result comes in with a zone, auto-switch to location tab
    useEffect(() => {
        if (highlightedZoneId) setTab('location')
    }, [highlightedZoneId])

    const activeItems = showRemoved ? items : items.filter(i => i.status !== 'out')
    const removedCount = items.filter(i => i.status === 'out').length

    const filteredItems = zoneFilter
        ? activeItems.filter(i => i.zone === zoneFilter)
        : activeItems

    const byCategory = groupBy(filteredItems, 'category', 'Uncategorized')
    const byZone     = groupBy(filteredItems, 'zone')
    const unassigned = byZone[UNASSIGNED_KEY] || []
    const assigned   = zones.map(z => ({ zone: z, items: byZone[z.id] || [] }))

    const activeZone = zoneFilter ? zones.find(z => z.id === zoneFilter) : null

    return (
        <div className="inventory-root">
            {/* Header */}
            <div className="inventory-header">
                <div className="inv-title">
                    <span>📦</span> Inventory
                    <span className="inv-total">{filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="inv-tab-bar">
                    <button
                        className={`inv-tab ${tab === 'category' ? 'inv-tab-active' : ''}`}
                        onClick={() => setTab('category')}
                    >
                        By Category
                    </button>
                    <button
                        className={`inv-tab ${tab === 'location' ? 'inv-tab-active' : ''}`}
                        onClick={() => setTab('location')}
                    >
                        By Location
                    </button>
                    {removedCount > 0 && (
                        <button
                            className={`inv-tab inv-tab-removed ${showRemoved ? 'inv-tab-active' : ''}`}
                            onClick={() => setShowRemoved(s => !s)}
                            title={showRemoved ? 'Hide removed items' : 'Show removed items'}
                        >
                            {showRemoved ? '🗑 Hide removed' : `🗑 Removed (${removedCount})`}
                        </button>
                    )}
                </div>
            </div>

            {/* Zone filter banner */}
            {activeZone && (
                <div className="zone-filter-banner" style={{ '--zone-color': activeZone.color }}>
                    <span className="zfb-dot" style={{ background: activeZone.color }} />
                    <span className="zfb-label">Filtering: <strong>{activeZone.label}</strong></span>
                    <button className="zfb-clear" onClick={clearZoneFilter} title="Clear filter">✕ Show all</button>
                </div>
            )}

            {/* Body */}
            <div className="inventory-body">
                {filteredItems.length === 0 && !zoneFilter ? (
                    <div className="inv-empty">
                        <span style={{ fontSize: 40, opacity: 0.3 }}>📦</span>
                        <p className="inv-empty-title">No items scanned yet</p>
                        <p className="inv-empty-sub">Go to the <strong>Camera</strong> tab and scan your first item.</p>
                    </div>
                ) : filteredItems.length === 0 && zoneFilter ? (
                    <div className="inv-empty">
                        <span style={{ fontSize: 40, opacity: 0.3 }}>🗂️</span>
                        <p className="inv-empty-title">Nothing in {activeZone?.label}</p>
                        <p className="inv-empty-sub">Scan and place items into this zone first.</p>
                    </div>
                ) : tab === 'category' ? (
                    <div className="group-list">
                        {Object.entries(byCategory).map(([cat, catItems]) => (
                            <CategoryGroup
                                key={cat}
                                name={cat}
                                items={catItems}
                                onRemove={removeItem}
                                highlightedItemId={highlightedItemId}
                                zones={zones}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="group-list">
                        {assigned.map(({ zone, items: zItems }) => (
                            <div
                                key={zone.id}
                                className={`cat-group ${zone.id === highlightedZoneId ? 'zone-group-highlighted' : ''}`}
                            >
                                <div className="cat-group-header loc-header">
                                    <div className="loc-dot" style={{ background: zone.color }} />
                                    <span className="cat-name">{zone.label}</span>
                                    <span className="cat-count">{zItems.length}</span>
                                </div>
                                <div className="cat-group-body">
                                    {zItems.length === 0
                                        ? <p className="loc-empty">No items stored here yet</p>
                                        : zItems.map(item => (
                                            <ItemCard
                                                key={item.id}
                                                item={item}
                                                onRemove={removeItem}
                                                highlighted={item.id === highlightedItemId}
                                                zones={zones}
                                            />
                                        ))
                                    }
                                </div>
                            </div>
                        ))}
                        {/* Unassigned */}
                        {unassigned.length > 0 && !zoneFilter && (
                            <div className="cat-group">
                                <div className="cat-group-header loc-header">
                                    <div className="loc-dot" style={{ background: '#4a5568' }} />
                                    <span className="cat-name">Unassigned</span>
                                    <span className="cat-count">{unassigned.length}</span>
                                </div>
                                <div className="cat-group-body">
                                    {unassigned.map(item => (
                                        <ItemCard
                                            key={item.id}
                                            item={item}
                                            onRemove={removeItem}
                                            highlighted={item.id === highlightedItemId}
                                            zones={zones}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                        {zones.length === 0 && (
                            <div className="inv-empty">
                                <span style={{ fontSize: 32, opacity: 0.3 }}>🗂️</span>
                                <p className="inv-empty-title">No zones defined</p>
                                <p className="inv-empty-sub">Define boundaries first to enable location grouping.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
