'use client'

/**
 * COSMOS — SelectionInfo
 * ======================
 * Chip contextuelle sous la TopBar (desktop uniquement) : rappel de la
 * sélection en cours. Clic sur la chip = recentrage caméra ; bouton × =
 * efface la sélection SANS bouger la caméra. Mobile : masquée (le
 * bottom-sheet de détails joue ce rôle).
 */

import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'

import { categoryById, planetById, useCosmos } from '@/lib/cosmos/store'
import { EASE, planetsByCategory } from './shared'

export function SelectionInfo() {
  const selectedPlanetId = useCosmos((s) => s.selectedPlanetId)
  const selectedCategoryId = useCosmos((s) => s.selectedCategoryId)
  const focusPlanet = useCosmos((s) => s.focusPlanet)
  const focusCategory = useCosmos((s) => s.focusCategory)
  const selectCategory = useCosmos((s) => s.selectCategory)
  const setDetailOpen = useCosmos((s) => s.setDetailOpen)

  const planet = selectedPlanetId ? planetById.get(selectedPlanetId) : undefined
  const category = planet
    ? categoryById.get(planet.category_id)
    : selectedCategoryId
      ? categoryById.get(selectedCategoryId)
      : undefined

  // Efface la sélection sans toucher à la caméra
  const dismiss = () => {
    selectCategory(null)
    setDetailOpen(false)
  }

  return (
    <AnimatePresence>
      {(planet || category) && (
        <motion.div
          key={planet ? `planet-${planet.id}` : `category-${category?.id}`}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: EASE }}
          className="fixed left-4 top-[68px] z-30 hidden md:flex md:left-5"
        >
          <div className="cosmos-glass flex h-11 items-center rounded-xl pl-3 pr-1">
            {planet ? (
              <button
                type="button"
                onClick={() => focusPlanet(planet.id)}
                title="Recentrer sur cette planète"
                className="flex min-w-0 items-center gap-2 rounded-xl py-1 pr-2.5 transition hover:opacity-75"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: planet.color }}
                  aria-hidden="true"
                />
                <span className="max-w-[280px] truncate text-[13px] text-foreground/95">
                  {planet.title}
                </span>
                {category && (
                  <>
                    <span className="text-muted-foreground/40" aria-hidden="true">
                      ·
                    </span>
                    <span className="max-w-[140px] truncate text-[11px] text-muted-foreground">
                      {category.name}
                    </span>
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => category && focusCategory(category.id)}
                title="Recentrer sur ce système"
                className="flex min-w-0 items-center gap-2 rounded-xl py-1 pr-2.5 transition hover:opacity-75"
              >
                {category && (
                  <>
                    <span
                      className="text-sm leading-none"
                      style={{ color: category.color }}
                      aria-hidden="true"
                    >
                      ✦
                    </span>
                    <span className="max-w-[280px] truncate text-[13px] text-foreground/95">
                      {category.name}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {planetsByCategory.get(category.id)?.length ?? 0} planètes
                    </span>
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={dismiss}
              aria-label="Effacer la sélection"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-white/[0.1] hover:text-foreground"
            >
              <X size={14} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
