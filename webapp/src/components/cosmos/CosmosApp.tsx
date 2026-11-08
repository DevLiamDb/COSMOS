'use client'

/**
 * COSMOS — Shell applicatif
 * =========================
 * Assemble l'univers (vues 2D/3D superposées, transition en fondu) et
 * l'interface flottante (barre, recherche, panneaux, contrôles).
 *
 * - Les deux moteurs restent montés : la sélection est commune, le
 *   basculement 2D ↔ 3D est un simple fondu et ne perd jamais l'état.
 * - Page d'accueil (atLanding) : le chrome est masqué, seules la landing
 *   et la scène ambiante sont visibles ; les raccourcis de recherche
 *   sont neutralisés.
 * - Raccourcis globaux : ⌘K / Ctrl+K ou « / » → recherche ; Échap →
 *   fermer recherche → panneau → désélection.
 */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { UniverseView2D } from './views/UniverseView2D'
import { UniverseView3D } from './views/UniverseView3D'
import { TopBar } from './ui/TopBar'
import { SearchPanel } from './ui/SearchPanel'
import { DetailPanel } from './ui/DetailPanel'
import { ViewControls } from './ui/ViewControls'
import { Minimap } from './ui/Minimap'
import { FilterBar } from './ui/FilterBar'
import { HintBar } from './ui/HintBar'
import { SelectionInfo } from './ui/SelectionInfo'
import { LandingPage } from './ui/LandingPage'
import { useCosmos } from '@/lib/cosmos/store'

/** Durée du fondu entre les vues (doit correspondre au CSS ci-dessous). */
const VIEW_FADE_MS = 650

export default function CosmosApp() {
  const mode = useCosmos((s) => s.mode)
  const searchOpen = useCosmos((s) => s.searchOpen)
  const detailOpen = useCosmos((s) => s.detailOpen)
  const selectedCategoryId = useCosmos((s) => s.selectedCategoryId)
  const selectedPlanetId = useCosmos((s) => s.selectedPlanetId)
  const setSearchOpen = useCosmos((s) => s.setSearchOpen)
  const setDetailOpen = useCosmos((s) => s.setDetailOpen)
  const selectCategory = useCosmos((s) => s.selectCategory)
  // Page d'accueil : masque tout le chrome (barre, contrôles, panneaux).
  const atLanding = useCosmos((s) => s.atLanding)
  // Version de l'univers : quand des données arrivent (0 → 1), les moteurs
  // sont RECONSTRUITS avec le dataset peuplé et rejouent leur intro caméra.
  const dataVersion = useCosmos((s) => s.dataVersion)

  const [showSplash, setShowSplash] = useState(true)

  /* Intro : écran-titre éphémère, assez court pour ne pas frustrer. */
  useEffect(() => {
    const t = window.setTimeout(() => setShowSplash(false), 2100)
    return () => window.clearTimeout(t)
  }, [])

  /* Raccourcis clavier globaux. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable

      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        // Bascule la recherche — unique source de vérité du raccourci
        // (SearchPanel n'a plus son propre handler) ; jamais depuis la
        // page d'accueil.
        const s = useCosmos.getState()
        if (!s.atLanding) s.setSearchOpen(!s.searchOpen)
        return
      }
      if (e.key === '/' && !typing) {
        e.preventDefault()
        // Pas de recherche depuis la page d'accueil.
        if (!useCosmos.getState().atLanding) setSearchOpen(true)
        return
      }
      if (e.key === 'Escape') {
        const s = useCosmos.getState()
        if (s.searchOpen) {
          s.setSearchOpen(false)
        } else if (s.detailOpen) {
          s.setDetailOpen(false)
        } else if (s.selectedPlanetId || s.selectedCategoryId) {
          s.selectPlanet(null)
          s.selectCategory(null)
          s.setDetailOpen(false)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSearchOpen, setDetailOpen, selectCategory])

  const show2d = mode === '2d'

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-background">
      {/* --- Univers -------------------------------------------------- */}
      <div
        aria-hidden={!show2d}
        className={`absolute inset-0 transition-opacity duration-[650ms] ${
          show2d ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        style={{ transitionDuration: `${VIEW_FADE_MS}ms` }}
      >
        <UniverseView2D key={`u2d-${dataVersion}`} active={show2d} />
      </div>
      <div
        aria-hidden={show2d}
        className={`absolute inset-0 transition-opacity duration-[650ms] ${
          show2d ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
        style={{ transitionDuration: `${VIEW_FADE_MS}ms` }}
      >
        <UniverseView3D key={`u3d-${dataVersion}`} active={!show2d} />
      </div>

      {/* Grain du vide — texture imperceptible */}
      <div className="cosmos-grain pointer-events-none absolute inset-0 z-[5]" aria-hidden />

      {/* Page d'accueil — overlay auto-masqué (AnimatePresence) dès qu'un
          univers est chargé ; flotte au-dessus du décor ambiant. */}
      <LandingPage />

      {/* --- Interface flottante (masquée sur la page d'accueil) -------- */}
      {!atLanding && (
        <>
          <TopBar />
          <SelectionInfo />
          <DetailPanel />
          <ViewControls />
          <Minimap />
          <FilterBar />
          <HintBar />
          <SearchPanel />
        </>
      )}

      {/* --- Écran-titre ------------------------------------------------ */}
      <AnimatePresence>
        {showSplash && (
          <motion.div
            key="splash"
            className="pointer-events-none absolute inset-0 z-[60] flex items-center justify-center bg-[#05060a]"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          >
            <motion.div
              className="flex flex-col items-center gap-4"
              initial={{ opacity: 0, scale: 0.96, filter: 'blur(6px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              transition={{ duration: 1.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="text-primary text-2xl" aria-hidden>
                ✦
              </span>
              <span className="cosmos-wordmark text-foreground text-xl sm:text-2xl">COSMOS</span>
              <span className="text-muted-foreground font-sans text-[11px] tracking-[0.2em] uppercase">
                Univers de connaissances
              </span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lecture d'écran : description du contexte (les vues décrivent leur aria-label) */}
      <div className="sr-only" aria-live="polite">
        {selectedPlanetId
          ? 'Planète sélectionnée — panneau de détails ouvert.'
          : selectedCategoryId
            ? 'Système solaire sélectionné.'
            : searchOpen
              ? 'Recherche ouverte.'
              : detailOpen
                ? 'Panneau ouvert.'
                : ''}
      </div>
    </div>
  )
}
