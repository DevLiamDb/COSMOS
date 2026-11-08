'use client'

import { useEffect, useRef } from 'react'
import { Engine3D } from './engine-3d'

/**
 * Vue 3D de l'univers COSMOS — monte le moteur Three.js dans un container
 * plein écran. Le moteur vit hors de React : il est créé une seule fois,
 * activé/désactivé via `active` (mode 2d/3d) et détruit au démontage.
 */
export function UniverseView3D({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Engine3D | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const engine = new Engine3D(el)
    engineRef.current = engine
    return () => {
      engine.destroy()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    engineRef.current?.setActive(active)
  }, [active])

  return (
    <div
      ref={ref}
      className="absolute inset-0"
      aria-label="Vue 3D de l'univers COSMOS"
    />
  )
}
