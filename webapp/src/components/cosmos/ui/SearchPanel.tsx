'use client'

/**
 * COSMOS — SearchPanel
 * ====================
 * Overlay de recherche globale : recherche instantanée multi-jetons
 * (searchCosmos sur l'index du store), navigation clavier ↑↓/↵/esc,
 * état vide = grille des étoiles (catégories) — ou proposition de
 * chargement si l'univers est encore vide (bouton « Charger la démo »).
 *
 * SearchPanel reste monté (raccourci ⌘K / Ctrl+K) et monte un
 * SearchOverlay frais à chaque ouverture — la requête et l'index actif
 * se remettent ainsi à zéro naturellement, sans effet de reset.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, SearchX, Sparkles, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { categoryById, dataset, planetById, searchIndex, useCosmos } from '@/lib/cosmos/store'
import { searchCosmos, type SearchHit } from '@/lib/cosmos/search'
import { NODE_TYPES } from '@/lib/cosmos/types'
import { cn } from '@/lib/utils'
import { EASE, planetsByCategory } from './shared'

export function SearchPanel() {
  const searchOpen = useCosmos((s) => s.searchOpen)

  // NB : le raccourci ⌘K / Ctrl+K (bascule ouverture/fermeture) est géré
  // par le shell (CosmosApp), unique source de vérité — ce composant n'a
  // plus son propre handler, ce qui évite un double traitement contraire
  // quand il est monté/démonté par le gating de la page d'accueil.

  return (
    <AnimatePresence>
      {searchOpen && <SearchOverlay key="search-overlay" />}
    </AnimatePresence>
  )
}

function SearchOverlay() {
  const setSearchOpen = useCosmos((s) => s.setSearchOpen)
  const focusCategory = useCosmos((s) => s.focusCategory)
  const jumpToPlanet = useCosmos((s) => s.jumpToPlanet)
  const loadDemoData = useCosmos((s) => s.loadDemoData)

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  const hits = useMemo(() => searchCosmos(searchIndex, query), [query])
  const hasQuery = query.trim().length > 0

  const close = () => setSearchOpen(false)

  const selectHit = (hit: SearchHit) => {
    if (hit.kind === 'category') {
      focusCategory(hit.id)
      setSearchOpen(false)
    } else {
      jumpToPlanet(hit.id) // ferme déjà la recherche
    }
  }

  // Focus initial du champ
  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [])

  // Navigation clavier globale tant que l'overlay est monté
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = hits.length
        if (n === 0) return
        setActiveIndex((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n))
      } else if (e.key === 'Enter') {
        // Si le focus clavier est sur un autre contrôle (ex. bouton de
        // fermeture), on laisse son activation native prioritaire.
        const t = e.target as HTMLElement | null
        if (t && t !== inputRef.current && (t.tagName === 'BUTTON' || t.tagName === 'A')) return
        e.preventDefault()
        const hit = hits[activeIndex]
        if (hit) selectHit(hit)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hits, activeIndex])

  // L'élément actif reste visible pendant la navigation clavier
  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Recherche dans l’univers">
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: EASE }}
        onClick={close}
        aria-hidden="true"
      />

      {/* Panneau */}
      <motion.div
        className="cosmos-glass absolute inset-x-0 top-[7vh] mx-auto flex w-[calc(100%_-_2rem)] max-w-2xl flex-col overflow-hidden rounded-2xl"
        initial={{ opacity: 0, scale: 0.97, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: -8 }}
        transition={{ duration: 0.24, ease: EASE }}
      >
        {/* Header : champ de recherche */}
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-white/[0.06] pl-4 pr-1.5">
          <Search size={16} strokeWidth={1.5} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(0)
            }}
            placeholder="Rechercher : planète, étoile, session, type, contenu…"
            aria-label="Terme de recherche"
            className="h-11 flex-1 border-0 bg-transparent px-0 text-[15px] shadow-none focus-visible:border-transparent focus-visible:ring-0"
          />
          <kbd className="mr-1 hidden h-5 shrink-0 items-center rounded-md border border-white/10 bg-white/[0.05] px-1.5 text-[10px] font-medium text-muted-foreground sm:flex">
            esc
          </kbd>
          <button
            type="button"
            onClick={close}
            aria-label="Fermer la recherche"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-white/[0.08] hover:text-foreground"
          >
            <X size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        {/* Corps */}
        {!hasQuery ? (
          dataset.categories.length === 0 ? (
            // Univers vide : proposition de chargement (l’overlay est remonté
            // frais à chaque ouverture — la lecture est toujours actuelle).
            <div className="flex max-h-[52vh] flex-col items-center justify-center gap-2.5 px-6 py-12 text-center">
              <SearchX
                size={16}
                strokeWidth={1.5}
                className="text-muted-foreground/50"
                aria-hidden="true"
              />
              <p className="text-sm text-foreground/85">L’univers est vide</p>
              <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
                Chargez l’univers de démonstration pour explorer des centaines de données.
              </p>
              <button
                type="button"
                onClick={() => {
                  loadDemoData()
                  close()
                }}
                className="mt-2 flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-xs font-medium text-primary-foreground transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
              >
                <Sparkles size={14} strokeWidth={1.75} aria-hidden="true" />
                Charger la démo
              </button>
            </div>
          ) : (
          // État vide : les étoiles de l'univers
          <div className="cosmos-scroll max-h-[52vh] overflow-y-auto px-4 pb-4 pt-3.5">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Étoiles de l’univers
            </p>
            <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {dataset.categories.map((c) => {
                const count = planetsByCategory.get(c.id)?.length ?? 0
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      focusCategory(c.id)
                      close()
                    }}
                    className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2 text-left transition hover:border-white/[0.12] hover:bg-white/[0.07]"
                  >
                    <span
                      className="shrink-0 text-sm leading-none"
                      style={{ color: c.color }}
                      aria-hidden="true"
                    >
                      ✦
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-foreground/90">{c.name}</span>
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">
                        {count} planète{count > 1 ? 's' : ''}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          )
        ) : hits.length === 0 ? (
          // Aucun résultat
          <div className="flex max-h-[52vh] flex-col items-center justify-center gap-2.5 px-6 py-14 text-center">
            <SearchX size={16} strokeWidth={1.5} className="text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm text-foreground/85">Aucune planète ne correspond</p>
            <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
              Essayez avec moins de mots — titres, types, sessions et contenus sont explorés,
              accents compris.
            </p>
          </div>
        ) : (
          // Résultats (liste plate scorée)
          <div
            className="cosmos-scroll max-h-[52vh] overflow-y-auto py-1.5"
            role="listbox"
            aria-label="Résultats de recherche"
          >
            {hits.map((hit, i) => {
              const planet = hit.kind === 'planet' ? planetById.get(hit.id) : undefined
              const category = categoryById.get(hit.categoryId)
              const dotColor =
                hit.kind === 'category'
                  ? (category?.color ?? '#9aa0aa')
                  : (planet?.color ?? category?.color ?? '#9aa0aa')
              const subtitle =
                hit.kind === 'planet'
                  ? `${planet ? NODE_TYPES[planet.node_type].label : 'Donnée'} · ${category?.name ?? '—'}`
                  : `Étoile · ${planetsByCategory.get(hit.id)?.length ?? 0} planètes`
              const badgeLabel =
                hit.kind === 'category'
                  ? 'étoile'
                  : planet
                    ? NODE_TYPES[planet.node_type].label
                    : ''
              return (
                <button
                  key={`${hit.kind}-${hit.id}`}
                  ref={(el) => {
                    itemRefs.current[i] = el
                  }}
                  type="button"
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => selectHit(hit)}
                  className={cn(
                    'flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors',
                    i === activeIndex ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]',
                  )}
                >
                  <span
                    className="mt-[7px] h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: dotColor }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground/95">{hit.title}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {subtitle}
                    </span>
                    {hit.snippet && (
                      <span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-muted-foreground/75">
                        {hit.snippet}
                      </span>
                    )}
                  </span>
                  {badgeLabel && (
                    <Badge
                      variant="outline"
                      className="mt-0.5 shrink-0 border-white/10 px-1.5 text-[10px] font-normal text-muted-foreground"
                    >
                      {badgeLabel}
                    </Badge>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Footer : hints + compteur */}
        <div className="flex h-10 shrink-0 items-center justify-between border-t border-white/[0.06] px-4 text-[11px] text-muted-foreground/75">
          <span className="hidden sm:block" aria-hidden="true">
            ↑↓ naviguer · ↵ ouvrir · esc fermer
          </span>
          <span className="sm:hidden" aria-hidden="true">
            ↵ ouvrir
          </span>
          <span className="tabular-nums">
            {hasQuery
              ? `${hits.length} résultat${hits.length > 1 ? 's' : ''}`
              : dataset.planets.length === 0
                ? 'univers vide'
                : `${dataset.planets.length} planètes indexées`}
          </span>
        </div>
      </motion.div>
    </div>
  )
}
