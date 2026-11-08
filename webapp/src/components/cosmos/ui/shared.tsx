'use client'

/**
 * COSMOS UI — éléments partagés
 * ==============================
 * Constantes et index dérivés du dataset. Les index (planètes par catégorie,
 * comptes par type) sont détenus par le store et mutés en place par
 * `applyDataset()` — l'univers peut donc démarrer vide puis être peuplé
 * (loadDemoData) sans casser les imports : mêmes instances, contenu à jour.
 */

import type { ReactNode } from 'react'
import { planetsByCategory, typeCounts } from '@/lib/cosmos/store'
import { cn } from '@/lib/utils'

/** Courbe d'easing standard des transitions COSMOS (durées 220–320 ms). */
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]

/**
 * Bouton tertiaire : texte seul, sans fond ni bordure au repos -- pour les
 * actions secondaires (Annuler, bascules Modifier/Ajouter) qui ne doivent
 * pas concurrencer visuellement l'action principale (Enregistrer, Créer,
 * Fusionner...). Un seul point de vérité pour ce style plutôt qu'un
 * className dupliqué et progressivement divergent à chaque usage.
 */
export function TertiaryButton({
  children,
  onClick,
  disabled,
  className,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:bg-white/[0.07] hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** Planètes par catégorie, dans l'ordre du dataset (maintenu par le store). */
export { planetsByCategory, typeCounts }

/**
 * Points d'importance (1 à 5), remplis avec la couleur de la planète.
 * Taille « sm » pour les lignes de listes denses.
 */
export function ImportanceDots({
  importance,
  color,
  size = 'md',
  className,
}: {
  importance: number
  color: string
  size?: 'sm' | 'md'
  className?: string
}) {
  const n = Math.max(0, Math.min(5, Math.round(importance)))
  return (
    <span
      className={cn('inline-flex items-center', size === 'sm' ? 'gap-[3px]' : 'gap-1', className)}
      aria-hidden="true"
      title={`Importance ${n}/5`}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={cn('rounded-full', size === 'sm' ? 'h-1 w-1' : 'h-1.5 w-1.5')}
          style={{ backgroundColor: i < n ? color : 'rgba(255, 255, 255, 0.14)' }}
        />
      ))}
    </span>
  )
}
