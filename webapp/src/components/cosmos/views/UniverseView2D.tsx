'use client'

import { useEffect, useRef } from 'react'
import { Engine2D } from './engine-2d'

/**
 * Vue 2D de l'univers COSMOS — simple hôte React du moteur Canvas.
 * Le parent garde le contrôle des `pointer-events` (le div n'en force aucun,
 * actif ou non) : il masque simplement cette couche quand la vue 3D est active.
 */
export function UniverseView2D({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Engine2D | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const engine = new Engine2D(ref.current)
    engineRef.current = engine
    return () => {
      engine.destroy()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    engineRef.current?.setActive(active)
  }, [active])

  return <div ref={ref} className="absolute inset-0" aria-label="Vue 2D de l'univers COSMOS" />
}
