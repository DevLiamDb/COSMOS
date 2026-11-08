'use client'

/**
 * COSMOS — HintBar
 * ================
 * Pilule d'accueil centrée en bas d'écran. Disparaît après 16 s, dès la
 * première sélection, ou à la première ouverture de la recherche — et ne
 * réapparaît jamais. Non interactive (pointer-events-none).
 *
 * Univers vide : la pilule se retire (la page d'accueil LandingPage
 * communique à sa place) ; quand un univers est chargé, le loquet se
 * réarme — un univers frais mérite un indice frais.
 */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

import { dataset, useCosmos } from '@/lib/cosmos/store'
import { EASE } from './shared'

export function HintBar() {
  const selectedCategoryId = useCosmos((s) => s.selectedCategoryId)
  const selectedPlanetId = useCosmos((s) => s.selectedPlanetId)
  const searchOpen = useCosmos((s) => s.searchOpen)
  const dataVersion = useCosmos((s) => s.dataVersion)

  // Latch de disparition : 16 s (sur un univers peuplé), première sélection
  // ou première recherche. Réarmé à chaque univers fraîchement peuplé
  // (démo ou sync, y compris après un retour au menu).
  const [gone, setGone] = useState(() => {
    const s = useCosmos.getState()
    return s.selectedCategoryId !== null || s.selectedPlanetId !== null || s.searchOpen
  })

  const isEmpty = dataset.categories.length === 0

  // Compte à rebours des 16 s — armé uniquement sur un univers peuplé et
  // relancé à chaque nouvelle version de l'univers (dataVersion).
  useEffect(() => {
    if (isEmpty) return
    const t = setTimeout(() => setGone(true), 16000)
    return () => clearTimeout(t)
  }, [isEmpty, dataVersion])

  // Sélection / recherche → pilule vers gone ; univers frais → loquet réarmé.
  useEffect(() => {
    const unsubscribe = useCosmos.subscribe((s, prev) => {
      // NB : le dataset garde une identité STABLE et est muté en place —
      // prev.dataset voit donc déjà le contenu NOUVEAU. On détecte le
      // passage vide → peuplé via le delta de dataVersion (primitive
      // snapshottée) + la longueur courante (peuplée après mutation).
      if (s.dataVersion !== prev.dataVersion && s.dataset.categories.length > 0) {
        setGone(false)
        return
      }
      if (s.selectedCategoryId !== null || s.selectedPlanetId !== null || s.searchOpen) {
        setGone(true)
      }
    })
    return unsubscribe
  }, [])

  // Univers vide (page d'accueil) : rien à suggérer — la landing parle déjà.
  if (isEmpty) return null

  const visible =
    !gone && selectedCategoryId === null && selectedPlanetId === null && !searchOpen

  return (
    // Sur mobile, la pilule remonte au-dessus du bouton « Filtres » pour
    // ne jamais le recouvrir ; desktop : posée à bottom-5 comme prévu.
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)_+_4.25rem)] z-30 flex justify-center px-4 md:bottom-5">
      <AnimatePresence>
        {visible && (
          <motion.div
            key="hint-bar"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.32, ease: EASE }}
            className="cosmos-glass rounded-full px-4 py-2.5 text-center text-xs text-muted-foreground"
          >
            <span className="hidden sm:inline">
              Cliquez sur une étoile <span className="text-primary">✦</span> pour explorer son
              système — glissez pour voyager · molette pour zoomer
            </span>
            <span className="sm:hidden">
              Touchez une étoile <span className="text-primary">✦</span> pour explorer
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
