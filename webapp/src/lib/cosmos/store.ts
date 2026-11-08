/**
 * COSMOS — Store global (Zustand)
 * ===============================
 * Source de vérité unique partagée par :
 *  - les moteurs de rendu 2D/3D (abonnés hors React via .subscribe()/.getState())
 *  - l'interface (TopBar, recherche, panneaux, contrôles)
 *
 * La sélection est commune aux deux vues : une catégorie ou une planète
 * sélectionnée en 2D est sélectionnée en 3D, et réciproquement.
 *
 * Les commandes caméra (`camera`) sont des ordres ponctuels identifiables par
 * un nonce croissant : chaque moteur compare le nonce reçu à celui qu'il a
 * déjà traité et déclenche l'animation correspondante (même s'il était
 * inactif au moment de l'émission — la commande reste « en attente »).
 */

import { create } from 'zustand'
import { toast } from 'sonner'
import type { CategoryNode, CosmosDataset, CosmosLayout, NodeType, PlanetNode } from './types'
import { buildDemoDataset } from './mock-data'
import { buildLayout } from './layout'
import { buildSearchIndex, type SearchIndex } from './search'

export type ViewMode = '2d' | '3d'

export type CameraKind = 'global' | 'category' | 'planet' | 'zoom-in' | 'zoom-out' | 'pan'

export interface CameraCommand {
  nonce: number
  kind: CameraKind
  targetId: string | null
  /** Coordonnées monde pour la commande 'pan' (mini-carte). */
  world?: { x: number; y: number }
}

/** Surbrillance temporaire d'une planète (saut depuis la recherche). */
export interface Highlight {
  planetId: string
  /** Échéance (Date.now()) au-delà de laquelle le moteur ignore le pulse. */
  until: number
}

let cameraNonce = 0

/** Réinitialisations communes après un chargement ou un retour au menu :
 *  sélection, surbrillance, panneaux et filtres repartent propres. */
const VIEW_RESETS = {
  selectedCategoryId: null,
  selectedPlanetId: null,
  hoveredId: null,
  highlight: null,
  detailOpen: false,
  searchOpen: false,
  activeTypes: [] as NodeType[],
  activeSessionId: null as string | null,
}

function issue(
  kind: CameraKind,
  targetId: string | null,
  world?: { x: number; y: number },
): CameraCommand {
  return { nonce: ++cameraNonce, kind, targetId, ...(world ? { world } : {}) }
}

/* ------------------------------------------------------------------ */
/* Données (module-level : un seul univers, déterministe)              */
/* ------------------------------------------------------------------ */

/**
 * L'univers démarre VIDE par défaut : aucune catégorie, aucune planète.
 * L'univers de démonstration (24 étoiles · 554 planètes, clairement
 * identifié comme fictif) reste chargeable à tout moment via
 * `useCosmos.getState().loadDemoData()`.
 */
function buildEmptyDataset(): CosmosDataset {
  return {
    categories: [],
    planets: [],
    sessions: [],
    generatedAt: new Date(0).toISOString(),
    isDemo: false,
  }
}

/**
 * Les structures ci-dessous gardent une IDENTITÉ STABLE : leur contenu est
 * muté en place par `applyDataset()`. Tous les consommateurs (moteurs de
 * rendu, index dérivés, UI) lisent ainsi les données à jour sans avoir à
 * ré-importer quoi que ce soit. Les moteurs 2D/3D sont reconstruits par le
 * shell via `key={dataVersion}` quand la version change.
 */
export const dataset: CosmosDataset = buildEmptyDataset()
export const layout: CosmosLayout = buildLayout(dataset)
export const searchIndex: SearchIndex = buildSearchIndex(dataset)

export const planetById: Map<string, PlanetNode> = new Map()
export const categoryById: Map<string, CategoryNode> = new Map()
export const sessionById: Map<string, { id: string; label: string; date: string }> = new Map()

/** Index dérivés — partagés avec l'UI (ré-exportés par ui/shared.tsx). */
export const planetsByCategory: Map<string, PlanetNode[]> = new Map()
export const typeCounts: Map<NodeType, number> = new Map()

/** Recalcule tous les index dérivés depuis `dataset` (mutation en place). */
function refreshDerivedIndexes(): void {
  planetById.clear()
  categoryById.clear()
  sessionById.clear()
  planetsByCategory.clear()
  typeCounts.clear()
  for (const c of dataset.categories) {
    categoryById.set(c.id, c)
    planetsByCategory.set(c.id, [])
  }
  for (const s of dataset.sessions) sessionById.set(s.id, s)
  for (const p of dataset.planets) {
    planetById.set(p.id, p)
    planetsByCategory.get(p.category_id)?.push(p)
    typeCounts.set(p.node_type, (typeCounts.get(p.node_type) ?? 0) + 1)
  }
}

/**
 * Remplace le contenu de l'univers courant. Les identités des structures
 * exportées (dataset, layout, searchIndex, Maps, index dérivés) sont
 * conservées : seul leur contenu change.
 */
function applyDataset(next: CosmosDataset): void {
  dataset.categories.length = 0
  dataset.categories.push(...next.categories)
  dataset.planets.length = 0
  dataset.planets.push(...next.planets)
  dataset.sessions.length = 0
  dataset.sessions.push(...next.sessions)
  dataset.generatedAt = next.generatedAt
  dataset.isDemo = next.isDemo

  const nextLayout = buildLayout(next)
  layout.systems.length = 0
  layout.systems.push(...nextLayout.systems)
  layout.bounds.minX = nextLayout.bounds.minX
  layout.bounds.minY = nextLayout.bounds.minY
  layout.bounds.maxX = nextLayout.bounds.maxX
  layout.bounds.maxY = nextLayout.bounds.maxY

  const nextIndex = buildSearchIndex(next)
  searchIndex.categories.length = 0
  searchIndex.categories.push(...nextIndex.categories)
  searchIndex.planets.length = 0
  searchIndex.planets.push(...nextIndex.planets)

  refreshDerivedIndexes()
}

refreshDerivedIndexes()

/* ------------------------------------------------------------------ */
/* Personnalisation -- appels réseau vers les routes de mutation        */
/* (voir src/app/api/cosmos/*), qui écrivent directement dans cosmos.db */
/* (voir cosmos-db.ts). Après toute mutation réussie, on refetch tout   */
/* le dataset plutôt que de rejouer la mutation localement : plus sûr   */
/* (une fusion de catégories ou un renommage touchent potentiellement   */
/* beaucoup de planètes, la source de vérité reste la base).            */
/* ------------------------------------------------------------------ */

interface MutationResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

async function postJson(url: string, body: unknown): Promise<MutationResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return (await res.json()) as MutationResult
  } catch {
    return { ok: false, error: 'Erreur réseau -- la webapp peut-elle joindre son propre serveur ?' }
  }
}

async function patchJson(url: string, body: unknown): Promise<MutationResult> {
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return (await res.json()) as MutationResult
  } catch {
    return { ok: false, error: 'Erreur réseau -- la webapp peut-elle joindre son propre serveur ?' }
  }
}

async function fetchCosmosDataset(): Promise<CosmosDataset | null> {
  try {
    const res = await fetch('/api/cosmos/sync', { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as { ok: boolean; dataset?: CosmosDataset }
    if (!data.ok || !data.dataset || !Array.isArray(data.dataset.categories)) return null
    return data.dataset
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export interface CosmosStore {
  // --- données ---------------------------------------------------------
  /** Structure de l'univers courant (identité stable, contenu mutable). */
  dataset: CosmosDataset
  layout: CosmosLayout
  /** Incrémenté à chaque chargement de données — les vues sont re-montées
   *  avec `key={dataVersion}` ; l'UI s'y abonne pour se rafraîchir. */
  dataVersion: number
  /** Incrémenté pour des mutations légères qui ne changent pas la
   *  structure des systèmes (épinglage) -- signal de re-render UI qui,
   *  contrairement à `dataVersion`, ne remonte PAS les moteurs 2D/3D. */
  uiTick: number
  /** Vrai au démarrage et après un retour au menu : la page d'accueil
   *  (LandingPage) est affichée par-dessus la scène ambiante. */
  atLanding: boolean
  /** Statut de la synchronisation des données actuelles. */
  syncStatus: 'idle' | 'syncing' | 'error'
  /** Charge l'univers de démonstration (rechargeable après un retour menu). */
  loadDemoData: () => void
  /** Récupère les données actuelles via GET /api/cosmos/sync et charge
   *  l'univers réel. En cas d'échec : syncStatus='error', on reste sur
   *  la page d'accueil (l'UI affiche l'erreur). */
  loadCurrentData: () => Promise<void>
  /** Vide l'univers (scène ambiante) et retourne à la page d'accueil. */
  goToLanding: () => void

  // --- vue ------------------------------------------------------------
  mode: ViewMode
  setMode: (mode: ViewMode) => void
  /** Vrai pendant l'animation de transition 2D ↔ 3D (fade). */
  transitioning: boolean

  // --- sélection -------------------------------------------------------
  selectedCategoryId: string | null
  selectedPlanetId: string | null
  hoveredId: string | null
  highlight: Highlight | null

  /** Sélectionne une catégorie (et déselectionne la planète). Ne bouge pas la caméra. */
  selectCategory: (id: string | null) => void
  /** Sélectionne une planète (et sa catégorie). Ne bouge pas la caméra. */
  selectPlanet: (id: string | null) => void
  setHovered: (id: string | null) => void

  /** Sélection + caméra sur le système solaire + ouvre le panneau. */
  focusCategory: (id: string) => void
  /** Sélection + caméra sur la planète (suivi) + ouvre le panneau. */
  focusPlanet: (id: string) => void
  /** Recherche : sélection + caméra + pulse de surbrillance + panneau. */
  jumpToPlanet: (id: string) => void
  /** Désélectionne tout, caméra cadre l'univers entier. */
  resetView: () => void
  /** Caméra cadre l'univers sans toucher à la sélection. */
  frameAll: () => void
  /** Zoom incrémental (boutons UI) — les moteurs interprètent selon leur vue. */
  zoomIn: () => void
  zoomOut: () => void

  // --- panneaux ---------------------------------------------------------
  detailOpen: boolean
  setDetailOpen: (open: boolean) => void
  searchOpen: boolean
  setSearchOpen: (open: boolean) => void

  // --- filtres ------------------------------------------------------------
  /** Types actifs ; vide = tous les types. */
  activeTypes: NodeType[]
  toggleType: (t: NodeType) => void
  clearTypes: () => void
  /** Session active ; null = toutes les sessions. */
  activeSessionId: string | null
  /** Filtre sur une session (null = toutes) — re-cliquer désélectionne. */
  setSessionFilter: (id: string | null) => void
  /** Une planète est-elle visible selon les filtres ? */
  isPlanetVisible: (p: PlanetNode) => boolean

  // --- commandes caméra -----------------------------------------------
  camera: CameraCommand
  /** Déplace la caméra vers un point du monde (mini-carte), zoom inchangé. */
  panToWorld: (x: number, y: number) => void

  // --- personnalisation --------------------------------------------------
  /** Vrai pendant n'importe quelle mutation (rename/couleur/fusion/édition/
   *  création/épinglage/import) -- désactive les boutons concernés le temps
   *  de l'aller-retour réseau. */
  mutating: boolean
  renameCategory: (id: string, newName: string) => Promise<boolean>
  setCategoryColor: (id: string, color: string) => Promise<boolean>
  mergeCategories: (source: string, target: string) => Promise<boolean>
  updatePlanet: (id: string, patch: { title?: string; content?: string; nodeType?: NodeType | string }) => Promise<boolean>
  createPlanet: (input: { nodeType: string; title: string; content: string; sessionId?: string }) => Promise<string | null>
  togglePin: (id: string) => Promise<boolean>
  importNotes: (input: {
    nodeType: string
    sessionId?: string
    files: { filename: string; content: string; lastModified?: string }[]
  }) => Promise<number>
}

export const useCosmos = create<CosmosStore>((set, get) => ({
  dataset,
  layout,

  dataVersion: 0,
  uiTick: 0,
  atLanding: true,
  syncStatus: 'idle',

  loadDemoData: () => {
    // Rechargeable à volonté : après un retour au menu, on doit pouvoir
    // repartir sur la démonstration (plus de garde d'idempotence).
    applyDataset(buildDemoDataset())
    set((s) => ({
      dataVersion: s.dataVersion + 1,
      atLanding: false,
      syncStatus: 'idle',
      ...VIEW_RESETS,
    }))
  },

  loadCurrentData: async () => {
    // Un seul appel à la fois (protection double-clic).
    if (get().syncStatus === 'syncing') return
    set({ syncStatus: 'syncing' })
    try {
      const res = await fetch('/api/cosmos/sync', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { ok: boolean; dataset?: CosmosDataset }
      if (!data.ok || !data.dataset || !Array.isArray(data.dataset.categories)) {
        throw new Error('réponse de synchronisation invalide')
      }
      applyDataset(data.dataset)
      set((s) => ({
        dataVersion: s.dataVersion + 1,
        atLanding: false,
        syncStatus: 'idle',
        ...VIEW_RESETS,
      }))
    } catch {
      // Échec (réseau / HTTP / parse) : on reste sur la page d'accueil,
      // l'UI affiche l'erreur et propose de réessayer.
      set({ syncStatus: 'error' })
    }
  },

  goToLanding: () => {
    // Retour au menu : univers vidé → les moteurs se reconstruisent en
    // mode ambiant derrière la page d'accueil (key={dataVersion}).
    applyDataset(buildEmptyDataset())
    set((s) => ({
      dataVersion: s.dataVersion + 1,
      atLanding: true,
      syncStatus: 'idle',
      ...VIEW_RESETS,
    }))
  },

  mode: '2d',
  setMode: (mode) => set({ mode }),
  transitioning: false,

  selectedCategoryId: null,
  selectedPlanetId: null,
  hoveredId: null,
  highlight: null,

  selectCategory: (id) =>
    set((s) => ({
      selectedCategoryId: id,
      selectedPlanetId: null,
      highlight: s.selectedPlanetId ? null : s.highlight,
    })),
  selectPlanet: (id) => {
    if (!id) {
      set({ selectedPlanetId: null, highlight: null })
      return
    }
    const p = planetById.get(id)
    if (!p) return
    set({ selectedPlanetId: id, selectedCategoryId: p.category_id })
  },
  setHovered: (id) => set({ hoveredId: id }),

  focusCategory: (id) => {
    const p = planetById.get(get().selectedPlanetId ?? '')
    set((s) => ({
      selectedCategoryId: id,
      selectedPlanetId: null,
      highlight: p ? null : s.highlight,
      detailOpen: true,
      camera: issue('category', id),
    }))
  },
  focusPlanet: (id) => {
    const p = planetById.get(id)
    if (!p) return
    set({
      selectedPlanetId: id,
      selectedCategoryId: p.category_id,
      detailOpen: true,
      camera: issue('planet', id),
    })
  },
  jumpToPlanet: (id) => {
    const p = planetById.get(id)
    if (!p) return
    set({
      selectedPlanetId: id,
      selectedCategoryId: p.category_id,
      detailOpen: true,
      searchOpen: false,
      highlight: { planetId: id, until: Date.now() + 5200 },
      camera: issue('planet', id),
    })
  },
  resetView: () =>
    set({
      selectedCategoryId: null,
      selectedPlanetId: null,
      highlight: null,
      detailOpen: false,
      camera: issue('global', null),
    }),
  frameAll: () => set({ camera: issue('global', null) }),
  zoomIn: () => set({ camera: issue('zoom-in', null) }),
  zoomOut: () => set({ camera: issue('zoom-out', null) }),

  detailOpen: false,
  setDetailOpen: (open) => set({ detailOpen: open }),
  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),

  activeTypes: [],
  toggleType: (t) =>
    set((s) => {
      if (s.activeTypes.length === 0) {
        // tous → un seul
        return { activeTypes: [t] }
      }
      if (s.activeTypes.includes(t)) {
        const next = s.activeTypes.filter((x) => x !== t)
        // si on vide la sélection, on revient à « tous »
        return { activeTypes: next }
      }
      // si on ajoute le dernier type manquant → tous
      const next = [...s.activeTypes, t]
      return { activeTypes: next.length >= 14 ? [] : next }
    }),
  clearTypes: () => set({ activeTypes: [] }),

  activeSessionId: null,
  setSessionFilter: (id) =>
    set((s) => ({ activeSessionId: s.activeSessionId === id ? null : id })),

  isPlanetVisible: (p) => {
    const { activeTypes, activeSessionId } = get()
    if (activeSessionId && p.session_id !== activeSessionId) return false
    if (activeTypes.length === 0) return true
    return activeTypes.includes(p.node_type)
  },

  camera: { nonce: 0, kind: 'global', targetId: null },
  panToWorld: (x, y) => set({ camera: issue('pan', null, { x, y }) }),

  mutating: false,

  renameCategory: async (id, newName) => {
    set({ mutating: true })
    const result = await postJson('/api/cosmos/categories/rename', { id, newName })
    if (!result.ok) {
      toast.error(result.error || 'Échec du renommage.')
      set({ mutating: false })
      return false
    }
    const fresh = await fetchCosmosDataset()
    if (fresh) applyDataset(fresh)
    set((s) => ({
      mutating: false,
      dataVersion: s.dataVersion + 1,
      // La catégorie affichée a changé d'id (id = nom) -- on suit le
      // renommage plutôt que de se retrouver sur une catégorie fantôme.
      selectedCategoryId: s.selectedCategoryId === id ? newName : s.selectedCategoryId,
    }))
    toast.success(`Catégorie renommée en « ${newName} ».`)
    return true
  },

  setCategoryColor: async (id, color) => {
    set({ mutating: true })
    const result = await postJson('/api/cosmos/categories/color', { id, color })
    if (!result.ok) {
      toast.error(result.error || 'Échec du changement de couleur.')
      set({ mutating: false })
      return false
    }
    const fresh = await fetchCosmosDataset()
    if (fresh) applyDataset(fresh)
    set((s) => ({ mutating: false, dataVersion: s.dataVersion + 1 }))
    return true
  },

  mergeCategories: async (source, target) => {
    set({ mutating: true })
    const result = await postJson('/api/cosmos/categories/merge', { source, target })
    if (!result.ok) {
      toast.error(result.error || 'Échec de la fusion.')
      set({ mutating: false })
      return false
    }
    const fresh = await fetchCosmosDataset()
    if (fresh) applyDataset(fresh)
    set((s) => ({
      mutating: false,
      dataVersion: s.dataVersion + 1,
      selectedCategoryId: s.selectedCategoryId === source ? target : s.selectedCategoryId,
    }))
    toast.success(`« ${source} » fusionnée dans « ${target} ».`)
    return true
  },

  updatePlanet: async (id, patch) => {
    set({ mutating: true })
    const result = await patchJson(`/api/cosmos/planets/${encodeURIComponent(id)}`, patch)
    if (!result.ok) {
      toast.error(result.error || 'Échec de la modification.')
      set({ mutating: false })
      return false
    }
    const fresh = await fetchCosmosDataset()
    if (fresh) applyDataset(fresh)
    set((s) => ({ mutating: false, dataVersion: s.dataVersion + 1 }))
    toast.success('Souvenir modifié.')
    return true
  },

  createPlanet: async (input) => {
    set({ mutating: true })
    const result = await postJson('/api/cosmos/planets', input)
    if (!result.ok) {
      toast.error(result.error || 'Échec de la création.')
      set({ mutating: false })
      return null
    }
    const fresh = await fetchCosmosDataset()
    if (fresh) applyDataset(fresh)
    set((s) => ({ mutating: false, dataVersion: s.dataVersion + 1 }))
    toast.success('Nouvelle planète créée.')
    return (result.id as string) ?? null
  },

  togglePin: async (id) => {
    const current = planetById.get(id)
    if (!current) return false
    const nextPinned = !current.metadata.pinned
    // Optimiste : l'objet est partagé (même référence dans dataset.planets
    // et planetById), le muter en place suffit à ce que l'UI et les
    // moteurs de rendu le voient immédiatement, sans attendre le
    // round-trip réseau ni remonter les moteurs (contrairement aux autres
    // mutations, qui touchent la structure des systèmes).
    current.metadata.pinned = nextPinned
    set((s) => ({ uiTick: s.uiTick + 1 }))
    const result = await postJson(`/api/cosmos/planets/${encodeURIComponent(id)}/pin`, { pinned: nextPinned })
    if (!result.ok) {
      current.metadata.pinned = !nextPinned // annule l'optimisme
      set((s) => ({ uiTick: s.uiTick + 1 }))
      toast.error(result.error || "Échec de l'épinglage.")
      return false
    }
    return true
  },

  importNotes: async (input) => {
    set({ mutating: true })
    const result = await postJson('/api/cosmos/import', input)
    if (!result.ok) {
      toast.error(result.error || "Échec de l'import.")
      set({ mutating: false })
      return 0
    }
    const fresh = await fetchCosmosDataset()
    if (fresh) applyDataset(fresh)
    set((s) => ({ mutating: false, dataVersion: s.dataVersion + 1 }))
    const created = (result.created as number) ?? 0
    const errors = (result.errors as string[]) ?? []
    if (created > 0) toast.success(`${created} souvenir(s) importé(s).`)
    if (errors.length > 0) toast.error(errors.join(' · '))
    return created
  },
}))

/** Accès hors React (moteurs de rendu). */
export const cosmosStore = useCosmos
