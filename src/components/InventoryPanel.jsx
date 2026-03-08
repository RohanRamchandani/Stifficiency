import { useState, useEffect, useRef } from 'react'
import { useItems } from '../context/ItemsContext'
import { useZones } from '../context/ZonesContext'
import { useSearch } from '../context/SearchContext'
import './InventoryPanel.css'

// ── Helpers ────────────────────────────────────────────────────
function timeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso)) / 1000)
    if (s < 60)    return 'just now'
    if (s < 3600)  return `${Math.floor(s / 60)}m ago`
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
            onClick={e => { e.stopPropagation(); setExpanded(ex => !ex) }}
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
                        : <div className="item-loc unassigned">Location not set</div>
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
            <button className="cat-group-header" onClick={e => { e.stopPropagation(); setOpen(o => !o) }}>
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

// ── Bubble content panels ──────────────────────────────────────

function CategoryContent({ items, zones, removeItem, highlightedItemId }) {
    const byCategory = groupBy(items, 'category', 'Uncategorized')
    if (items.length === 0) return (
        <div className="bubble-empty">
            <p className="bubble-empty-title">No items yet</p>
            <p className="bubble-empty-sub">Scan items from the Camera tab.</p>
        </div>
    )
    return (
        <div className="bubble-scroll" onClick={e => e.stopPropagation()}>
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
    )
}

function LocationContent({ items, zones, removeItem, highlightedItemId, highlightedZoneId, zoneFilter, clearZoneFilter }) {
    const byZone     = groupBy(items, 'zone')
    const unassigned = byZone[UNASSIGNED_KEY] || []
    const assigned   = zones.map(z => ({ zone: z, items: byZone[z.id] || [] }))
    const activeZone = zoneFilter ? zones.find(z => z.id === zoneFilter) : null

    if (zones.length === 0) return (
        <div className="bubble-empty">
            <p className="bubble-empty-title">No zones defined</p>
            <p className="bubble-empty-sub">Define boundaries to enable location grouping.</p>
        </div>
    )
    return (
        <div className="bubble-scroll" onClick={e => e.stopPropagation()}>
            {activeZone && (
                <div className="bubble-filter-banner" style={{ borderColor: activeZone.color }}>
                    <span className="bubble-filter-dot" style={{ background: activeZone.color }} />
                    <span>Filtering: <strong>{activeZone.label}</strong></span>
                    <button className="bubble-filter-clear" onClick={e => { e.stopPropagation(); clearZoneFilter() }}>✕</button>
                </div>
            )}
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
                            ? <p className="loc-empty">Nothing stored here yet</p>
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
            {unassigned.length > 0 && !zoneFilter && (
                <div className="cat-group">
                    <div className="cat-group-header loc-header">
                        <div className="loc-dot" style={{ background: '#9CA3AF' }} />
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
        </div>
    )
}

// ── Main ─────────────────────────────────────────────────────────
export default function InventoryPanel() {
    const { items, removeItem } = useItems()
    const { zones } = useZones()
    const { highlightedItemId, highlightedZoneId, zoneFilter, clearZoneFilter } = useSearch()

    // null = both showing equally, 'category' or 'location' = one expanded
    const [active, setActive] = useState(null)
    const [showRemoved, setShowRemoved] = useState(false)

    const prevZoneFilter      = useRef(zoneFilter)
    const prevHighlightedZone = useRef(highlightedZoneId)

    useEffect(() => {
        if (zoneFilter && zoneFilter !== prevZoneFilter.current) setActive('location')
        prevZoneFilter.current = zoneFilter
    }, [zoneFilter])

    useEffect(() => {
        if (highlightedZoneId && highlightedZoneId !== prevHighlightedZone.current) setActive('location')
        prevHighlightedZone.current = highlightedZoneId
    }, [highlightedZoneId])

    const activeItems   = showRemoved ? items : items.filter(i => i.status !== 'out')
    const removedCount  = items.filter(i => i.status === 'out').length
    const filteredItems = zoneFilter ? activeItems.filter(i => i.zone === zoneFilter) : activeItems
    const totalCount    = filteredItems.length

    // Derive bubble state class for each side
    const getCatClass  = () => active === null ? 'bubble-both' : active === 'category' ? 'bubble-expanded' : 'bubble-peeking'
    const getLocClass  = () => active === null ? 'bubble-both' : active === 'location' ? 'bubble-expanded' : 'bubble-peeking'

    return (
        <div className="inv-bubble-root">
            {/* Top bar */}
            <div className="inv-bubble-topbar">
                <span className="inv-bubble-total">{totalCount} item{totalCount !== 1 ? 's' : ''}</span>
                {removedCount > 0 && (
                    <button
                        className={`inv-bubble-removed-btn ${showRemoved ? 'active' : ''}`}
                        onClick={() => setShowRemoved(s => !s)}
                    >
                        {showRemoved ? 'Hide removed' : `Removed (${removedCount})`}
                    </button>
                )}
            </div>

            {/* Stage: flex row, both bubbles live here */}
            <div className="inv-bubble-stage">

                {/* Category bubble */}
                <div
                    className={`inv-bubble ${getCatClass()}`}
                    onClick={() => setActive('category')}
                >
                    {/* Shimmer */}
                    <div className="inv-bubble-shimmer" />

                    {/* Inner — stops propagation when expanded so scroll/clicks don't re-trigger */}
                    <div
                        className="inv-bubble-inner"
                        onClick={active === 'category' ? e => e.stopPropagation() : undefined}
                    >
                        <div className="inv-bubble-header">
                            <span className="inv-bubble-label">
                                {active === 'category' || active === null ? 'By Category' : 'Cat'}
                            </span>
                        </div>
                        {(active === 'category' || active === null) && (
                            <CategoryContent
                                items={filteredItems}
                                zones={zones}
                                removeItem={removeItem}
                                highlightedItemId={highlightedItemId}
                            />
                        )}
                    </div>
                </div>

                {/* Location bubble */}
                <div
                    className={`inv-bubble ${getLocClass()}`}
                    onClick={() => setActive('location')}
                >
                    <div className="inv-bubble-shimmer" />
                    <div
                        className="inv-bubble-inner"
                        onClick={active === 'location' ? e => e.stopPropagation() : undefined}
                    >
                        <div className="inv-bubble-header">
                            <span className="inv-bubble-label">
                                {active === 'location' || active === null ? 'By Location' : 'Loc'}
                            </span>
                        </div>
                        {(active === 'location' || active === null) && (
                            <LocationContent
                                items={filteredItems}
                                zones={zones}
                                removeItem={removeItem}
                                highlightedItemId={highlightedItemId}
                                highlightedZoneId={highlightedZoneId}
                                zoneFilter={zoneFilter}
                                clearZoneFilter={clearZoneFilter}
                            />
                        )}
                    </div>
                </div>

            </div>
        </div>
    )
}
