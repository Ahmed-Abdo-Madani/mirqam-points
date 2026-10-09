/* Closes overlays on outside pointer-down or Escape — every menu/modal uses
   this so nothing can stay stuck open. */
import { useEffect } from 'react'

export function useDismiss(ref, onClose, active = true) {
  useEffect(() => {
    if (!active) return undefined
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [active, onClose, ref])
}
