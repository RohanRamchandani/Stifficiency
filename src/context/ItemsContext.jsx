import { createContext, useContext, useState, useEffect } from 'react'

const ItemsContext = createContext(null)
const STORAGE_KEY = 'stifficiency_items'

export function ItemsProvider({ children }) {
    const [items, setItems] = useState(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY)
            return saved ? JSON.parse(saved) : []
        } catch { return [] }
    })

    useEffect(() => {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)) } catch { }
    }, [items])

    const addItem = (item) => {
        const id = crypto.randomUUID()
        setItems(prev => [{
            ...item,
            id,
            zone: null,
            status: 'in',
            timestamp: new Date().toISOString(),
        }, ...prev])
        return id
    }

    const removeItem = (id) => setItems(prev => prev.filter(i => i.id !== id))

    /** Soft-remove: marks status 'out', clears zone. Item stays in localStorage for history. */
    const softRemoveItem = (id) =>
        setItems(prev => prev.map(i => i.id === id
            ? { ...i, status: 'out', zone: null, removedAt: new Date().toISOString() }
            : i
        ))

    const setItemZone = (id, zoneId) =>
        setItems(prev => prev.map(i => i.id === id ? { ...i, zone: zoneId } : i))

    return (
        <ItemsContext.Provider value={{ items, addItem, removeItem, softRemoveItem, setItemZone }}>
            {children}
        </ItemsContext.Provider>
    )
}

export const useItems = () => useContext(ItemsContext)
