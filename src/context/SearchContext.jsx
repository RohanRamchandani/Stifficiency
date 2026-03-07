/**
 * SearchContext.jsx
 * Cross-panel state for the "Find Item" feature.
 *
 * highlightedZoneId  — ID of zone to pulse/glow on camera overlay
 * highlightedItemId  — ID of item card to scroll to + highlight in inventory
 * zoneFilter         — zone ID to filter inventory by (set by zone-click on camera)
 */
import { createContext, useContext, useState, useCallback, useRef } from 'react'

const SearchContext = createContext(null)

export function SearchProvider({ children }) {
    const [highlightedZoneId, setHighlightedZoneId] = useState(null)
    const [highlightedItemId, setHighlightedItemId] = useState(null)
    const [zoneFilter,        setZoneFilterState]   = useState(null)
    const clearTimerRef = useRef(null)

    /** After a find query, highlight the matched zone + item for `durationMs` then clear. */
    const setFindResult = useCallback((zoneId, itemId, durationMs = 5000) => {
        clearTimeout(clearTimerRef.current)
        setHighlightedZoneId(zoneId ?? null)
        setHighlightedItemId(itemId ?? null)
        if (durationMs > 0) {
            clearTimerRef.current = setTimeout(() => {
                setHighlightedZoneId(null)
                setHighlightedItemId(null)
            }, durationMs)
        }
    }, [])

    /** Set a persistent zone filter (inventory shows only that zone's items). */
    const setZoneFilter = useCallback((id) => {
        setZoneFilterState(id ?? null)
    }, [])

    const clearZoneFilter = useCallback(() => {
        setZoneFilterState(null)
    }, [])

    const clearSearch = useCallback(() => {
        clearTimeout(clearTimerRef.current)
        setHighlightedZoneId(null)
        setHighlightedItemId(null)
        setZoneFilterState(null)
    }, [])

    return (
        <SearchContext.Provider value={{
            highlightedZoneId,
            highlightedItemId,
            zoneFilter,
            setFindResult,
            setZoneFilter,
            clearZoneFilter,
            clearSearch,
        }}>
            {children}
        </SearchContext.Provider>
    )
}

export function useSearch() {
    const ctx = useContext(SearchContext)
    if (!ctx) throw new Error('useSearch must be used inside <SearchProvider>')
    return ctx
}
