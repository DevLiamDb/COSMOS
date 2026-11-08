'use client'

/**
 * COSMOS — Minimap
 * ================
 * Repère de l'univers entier (desktop uniquement) : chaque système solaire
 * est un point coloré par sa catégorie, positionné selon layout.bounds.
 * Clic = panToWorld() vers ce point (zoom inchangé côté moteur actif) --
 * utile pour ne pas se perdre une fois zoomé profond dans un système, sans
 * repasser par « Cadrer l'univers » (qui, lui, recadre tout et perd le
 * zoom courant).
 *
 * Volontairement simple : pas de rectangle de viewport en direct (il
 * faudrait que les moteurs publient leur position caméra courante dans le
 * store, hors périmètre ici) -- juste un repère spatial des systèmes.
 */

import { useState } from 'react'

import { categoryById, layout, useCosmos } from '@/lib/cosmos/store'
import { useIsMobile } from '@/hooks/use-mobile'

const SIZE = 136
const PADDING = 12
/** Même décalage que ViewControls/DetailPanel quand le panneau est ouvert. */
const DETAIL_SHIFT = 412

export function Minimap() {
  useCosmos((s) => s.dataVersion)
  const panToWorld = useCosmos((s) => s.panToWorld)
  const detailOpen = useCosmos((s) => s.detailOpen)
  const atLanding = useCosmos((s) => s.atLanding)
  const isMobile = useIsMobile()
  const [hoveredCat, setHoveredCat] = useState<string | null>(null)

  // Repli léger : sur mobile l'écran est trop petit pour que ça reste
  // utile, et sous 2 systèmes une mini-carte n'apporte rien à repérer.
  if (atLanding || isMobile || layout.systems.length < 2) return null

  const b = layout.bounds
  const worldW = Math.max(1, b.maxX - b.minX)
  const worldH = Math.max(1, b.maxY - b.minY)
  const inner = SIZE - PADDING * 2
  const scale = Math.min(inner / worldW, inner / worldH)
  const toLocal = (x: number, y: number) => ({
    x: PADDING + (x - b.minX) * scale,
    y: PADDING + (y - b.minY) * scale,
  })

  return (
    <div
      className="cosmos-glass pointer-events-auto fixed z-30 rounded-2xl p-2 transition-transform duration-300"
      style={{
        top: 76,
        right: 20,
        width: SIZE,
        height: SIZE,
        transform: detailOpen ? `translateX(-${DETAIL_SHIFT}px)` : undefined,
      }}
    >
      <svg
        width={SIZE - 16}
        height={SIZE - 16}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label="Mini-carte de l’univers"
      >
        {layout.systems.map((sys) => {
          const cat = categoryById.get(sys.categoryId)
          const p = toLocal(sys.x, sys.y)
          const r = Math.max(2, Math.min(5.5, sys.starSize * scale * 0.7))
          const hovered = hoveredCat === sys.categoryId
          return (
            <circle
              key={sys.categoryId}
              cx={p.x}
              cy={p.y}
              r={hovered ? r + 1.5 : r}
              fill={cat?.color ?? '#7aa2f7'}
              opacity={cat?.priority ? 1 : 0.72}
              className="cursor-pointer transition-[r] duration-150"
              onMouseEnter={() => setHoveredCat(sys.categoryId)}
              onMouseLeave={() => setHoveredCat((c) => (c === sys.categoryId ? null : c))}
              onClick={() => panToWorld(sys.x, sys.y)}
            >
              <title>{cat?.name ?? sys.categoryId}</title>
            </circle>
          )
        })}
      </svg>
    </div>
  )
}
