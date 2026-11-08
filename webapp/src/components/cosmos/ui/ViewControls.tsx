'use client'

/**
 * COSMOS — ViewControls
 * =====================
 * Cluster flottant bas-droite : zoom +/−, cadrage de l'univers, vue globale.
 * Desktop : se décale à gauche quand le panneau de détails est ouvert
 * (pour ne pas passer dessous). Mobile : se cache quand le bottom-sheet
 * de détails occupe le bas de l'écran.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Crosshair, Maximize2, Minus, Plus } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCosmos } from '@/lib/cosmos/store'
import { useIsMobile } from '@/hooks/use-mobile'
import { EASE } from './shared'

/** Panneau détails (400) + offset droit (20) + gouttière (12) − ancrage (20). */
const DETAIL_SHIFT = 412

export function ViewControls() {
  const zoomIn = useCosmos((s) => s.zoomIn)
  const zoomOut = useCosmos((s) => s.zoomOut)
  const frameAll = useCosmos((s) => s.frameAll)
  const resetView = useCosmos((s) => s.resetView)
  const detailOpen = useCosmos((s) => s.detailOpen)
  const isMobile = useIsMobile()

  // Apparition après montage (évite un flash de position lié à useIsMobile)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const hiddenOnMobile = isMobile && detailOpen
  const shiftForPanel = !isMobile && detailOpen

  return (
    <AnimatePresence>
      {mounted && (
        <motion.div
          key="view-controls"
          className="fixed bottom-[calc(env(safe-area-inset-bottom)_+_1rem)] right-4 z-40 md:bottom-5 md:right-5"
          initial={{ opacity: 0, y: 12 }}
          animate={{
            opacity: hiddenOnMobile ? 0 : 1,
            y: hiddenOnMobile ? 16 : 0,
            x: shiftForPanel ? -DETAIL_SHIFT : 0,
          }}
          transition={{ duration: 0.28, ease: EASE }}
          style={{ pointerEvents: hiddenOnMobile ? 'none' : undefined }}
        >
          <div className="cosmos-glass flex flex-col gap-1 rounded-2xl p-1.5">
            <ControlButton label="Zoomer" onClick={zoomIn}>
              <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            </ControlButton>
            <ControlButton label="Dézoomer" onClick={zoomOut}>
              <Minus size={16} strokeWidth={1.5} aria-hidden="true" />
            </ControlButton>
            <div className="mx-2 h-px shrink-0 bg-white/[0.08]" aria-hidden="true" />
            <ControlButton label="Cadrer l’univers" onClick={frameAll}>
              <Maximize2 size={16} strokeWidth={1.5} aria-hidden="true" />
            </ControlButton>
            <ControlButton label="Vue globale (Échap)" onClick={resetView}>
              <Crosshair size={16} strokeWidth={1.5} aria-hidden="true" />
            </ControlButton>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-white/[0.08] hover:text-foreground active:scale-95"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="left"
        sideOffset={8}
        className="rounded-lg border border-white/10 bg-popover/95 px-2.5 py-1 text-[11px] text-popover-foreground shadow-xl backdrop-blur-md [&>svg]:fill-popover"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
