'use client'

/**
 * COSMOS — TopBar
 * ===============
 * Barre flottante haute : retour au menu (page d'accueil), wordmark
 * (retour vue globale), déclencheur de recherche (desktop), statistiques
 * de l'univers et bascule 2D / 3D.
 * Le conteneur est pointer-events-none : seuls les éléments interactifs
 * captent le pointeur (la vue reste manipulable partout ailleurs).
 */

import { useEffect, useState } from 'react'
import { ArrowLeft, Search } from 'lucide-react'

import { dataset, useCosmos } from '@/lib/cosmos/store'
import { formatRelativeFine } from '@/lib/cosmos/format'
import { cn } from '@/lib/utils'

export function TopBar() {
  const mode = useCosmos((s) => s.mode)
  const setMode = useCosmos((s) => s.setMode)
  const setSearchOpen = useCosmos((s) => s.setSearchOpen)
  const resetView = useCosmos((s) => s.resetView)
  const goToLanding = useCosmos((s) => s.goToLanding)
  // Le bouton « Menu » n'existe que dans l'univers (pas sur la page
  // d'accueil, où toute la barre est masquée par le shell — double garde).
  const atLanding = useCosmos((s) => s.atLanding)
  // Signal de re-rendu : le dataset est muté en place, ses longueurs sont
  // toujours à jour au moment du rendu.
  useCosmos((s) => s.dataVersion)

  // Horloge légère pour que « il y a 5 min » avance sans nouvelle sync.
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 px-3 pt-3 sm:px-4 sm:pt-4 md:px-5 md:pt-5">
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Retour au menu principal — à gauche du wordmark */}
        {!atLanding && (
          <button
            type="button"
            onClick={goToLanding}
            aria-label="Retour au menu principal"
            className="pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-foreground/80 transition hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:w-auto sm:gap-2 sm:px-3"
          >
            <ArrowLeft size={15} strokeWidth={1.75} aria-hidden="true" />
            <span className="hidden text-sm sm:inline">Menu</span>
          </button>
        )}

        {/* Wordmark — clic = vue globale */}
        <button
          type="button"
          onClick={resetView}
          aria-label="COSMOS — revenir à la vue d’ensemble"
          className="pointer-events-auto flex h-11 shrink-0 items-center gap-2 rounded-xl px-2.5 transition hover:bg-white/[0.06]"
        >
          <span className="text-[15px] leading-none text-primary" aria-hidden="true">
            ✦
          </span>
          <span className="cosmos-wordmark text-sm text-foreground/90">COSMOS</span>
        </button>

        {/* Déclencheur de recherche — centré, desktop uniquement */}
        <div className="pointer-events-none hidden min-w-0 flex-1 justify-center md:flex">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="cosmos-glass pointer-events-auto flex h-11 w-full max-w-md items-center gap-2.5 rounded-xl px-4 text-left transition hover:brightness-[1.13]"
          >
            <Search size={15} strokeWidth={1.5} className="shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              Rechercher dans l’univers…
            </span>
            <kbd className="hidden shrink-0 items-center rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:flex">
              Ctrl K
            </kbd>
          </button>
        </div>

        {/* Droite : stats + recherche mobile + bascule 2D/3D */}
        <div className="pointer-events-auto ml-auto flex items-center gap-2 md:gap-3">
          <p className="hidden whitespace-nowrap text-[11px] tabular-nums text-muted-foreground md:block">
            {dataset.categories.length === 0 ? (
              <span className="italic text-muted-foreground/70">univers vide</span>
            ) : (
              <>
                {dataset.categories.length} étoiles · {dataset.planets.length} planètes
                {dataset.isDemo ? (
                  <span className="text-muted-foreground/60"> · démo</span>
                ) : (
                  <span
                    className="text-muted-foreground/60"
                    title={`Synchronisé le ${new Date(dataset.generatedAt).toLocaleString('fr-FR')}`}
                  >
                    {' '}
                    · synchro {formatRelativeFine(dataset.generatedAt)}
                  </span>
                )}
              </>
            )}
          </p>

          {/* Recherche — mobile */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Rechercher dans l’univers"
            className="cosmos-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:brightness-[1.13] hover:text-foreground md:hidden"
          >
            <Search size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>

          {/* Bascule 2D / 3D */}
          <div
            className="cosmos-glass flex h-11 shrink-0 items-center gap-0.5 rounded-xl p-1"
            role="group"
            aria-label="Mode de vue"
          >
            {(['2d', '3d'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={cn(
                  'h-9 w-11 rounded-xl text-xs font-medium tracking-wide transition',
                  mode === m
                    ? 'bg-white/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground/80',
                )}
              >
                {m.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  )
}
