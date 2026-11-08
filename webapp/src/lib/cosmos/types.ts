/**
 * COSMOS — Modèle de données
 * ===========================
 * Hiérarchie : Univers → Catégories (étoiles ✦) → Systèmes solaires → Planètes → Données textuelles.
 *
 * Ce module définit les contrats partagés par :
 *  - le dataset de démonstration (mock-data.ts)
 *  - le moteur de mise en orbite (layout.ts)
 *  - les moteurs de rendu 2D (Canvas) et 3D (Three.js)
 *  - le store global (store.ts) et l'interface utilisateur
 */

/** Types de nœuds possibles pour une planète (= nature de la donnée textuelle). */
export type NodeType =
  | 'note'
  | 'idee'
  | 'decision'
  | 'evenement'
  | 'personne'
  | 'tache'
  | 'document'
  | 'conversation'
  | 'recherche'
  | 'concept'
  | 'technique'
  | 'reference'
  | 'session'
  | 'projet'

/** Registre des types de nœuds : libellés FR courts et longs (affichage UI). */
export const NODE_TYPES: Record<NodeType, { label: string; long: string }> = {
  note: { label: 'Note', long: 'Note de travail' },
  idee: { label: 'Idée', long: 'Idée / inspiration' },
  decision: { label: 'Décision', long: 'Décision d’équipe' },
  evenement: { label: 'Événement', long: 'Événement' },
  personne: { label: 'Personne', long: 'Personne / contact' },
  tache: { label: 'Tâche', long: 'Tâche / roadmap' },
  document: { label: 'Document', long: 'Document / spécification' },
  conversation: { label: 'Conversation', long: 'Conversation / réunion' },
  recherche: { label: 'Recherche', long: 'Note de recherche' },
  concept: { label: 'Concept', long: 'Concept / théorie' },
  technique: { label: 'Technique', long: 'Information technique' },
  reference: { label: 'Référence', long: 'Référence / lien' },
  session: { label: 'Session', long: 'Session de travail' },
  projet: { label: 'Projet', long: 'Contexte projet' },
}

/** Liste ordonnée des types (pour les filtres UI). */
export const NODE_TYPE_ORDER: NodeType[] = [
  'note', 'idee', 'decision', 'evenement', 'personne', 'tache', 'document',
  'conversation', 'recherche', 'concept', 'technique', 'reference', 'session', 'projet',
]

/**
 * Une catégorie = une étoile ✦ au centre d'un système solaire.
 */
export interface CategoryNode {
  id: string
  kind: 'category'
  /** Nom affiché de l'étoile. */
  name: string
  /** Couleur d'accent de la catégorie (hex #rrggbb) — teinte de l'étoile et de ses planètes. */
  color: string
  /** Description courte (1-2 phrases). */
  description: string
  /**
   * Catégorie PRIORITAIRE : chargée automatiquement en début de
   * conversation côté COSMOS réel. Visuellement distinguée dans
   * l'univers (étoile plus grande, halo renforcé, anneau pulsé).
   */
  priority?: boolean
  metadata: {
    tags: string[]
    /** Domaine principal, affiché dans le panneau de détails. */
    domain: string
  }
}

/**
 * Une planète = une donnée textuelle en orbite autour de son étoile.
 */
export interface PlanetNode {
  id: string
  kind: 'planet'
  /** Catégorie (étoile) parente. */
  category_id: string
  /** Session de travail associée. */
  session_id: string
  /** Nature de la donnée. */
  node_type: NodeType
  title: string
  short_description: string
  /** Texte complet (longueur variable, de la note courte au long document). */
  content: string
  /** ISO 8601. */
  created_at: string
  updated_at: string
  /** Couleur propre (dérivée de la teinte de la catégorie). */
  color: string
  metadata: {
    /** 1 (mineure) → 5 (structurante) — influence la taille de la planète. */
    importance: number
    tags: string[]
    /** Identifiants d'autres planètes liées (relations entre données). */
    connections: string[]
    /** Statut pour les tâches / décisions, sinon absent. */
    statut?: string
    /** Épinglage personnel — indépendant de la priorité de catégorie,
     *  posé librement par l'utilisateur sur une planète précise. */
    pinned?: boolean
    /** Champs additionnels hétérogènes (source, lieu, participants…). */
    [key: string]: unknown
  }
}

/** Session de travail regroupant plusieurs planètes. */
export interface SessionInfo {
  id: string
  label: string
  date: string // ISO
}

/**
 * Dataset complet de l'univers.
 * ⚠️ En l'état, peuplé par buildDemoDataset() — DONNÉES DE DÉMONSTRATION.
 */
export interface CosmosDataset {
  categories: CategoryNode[]
  planets: PlanetNode[]
  sessions: SessionInfo[]
  generatedAt: string
  isDemo: boolean
}

/* ------------------------------------------------------------------ */
/* Layout : positionnement des systèmes solaires et orbites            */
/* ------------------------------------------------------------------ */

/** Position orbitale d'une planète au sein de son système. */
export interface PlanetSlot {
  planetId: string
  /** Rayon de l'orbite (unités monde). */
  orbitRadius: number
  /** Angle initial (radians). */
  angle0: number
  /** Vitesse angulaire (rad/s, signée — négatif = orbite rétrograde). */
  angularSpeed: number
  /** Rayon visuel de la planète (unités monde). */
  size: number
  /** Inclinaisons du plan orbital (radians) — utilisées par la vue 3D. */
  tiltX: number
  tiltZ: number
}

/** Un système solaire = une étoile + ses orbites. */
export interface SystemLayout {
  categoryId: string
  /** Position du centre (l'étoile) en unités monde (2D : x,y ; 3D : x→x, y→z). */
  x: number
  y: number
  /** Rayon extérieur du système (dernière orbite + marge). */
  radius: number
  /** Rayon de la zone centrale sans orbite (autour de l'étoile). */
  coreRadius: number
  /** Taille visuelle de l'étoile (unités monde). */
  starSize: number
  /** Orbites du système, triées par rayon croissant. */
  slots: PlanetSlot[]
}

export interface CosmosLayout {
  systems: SystemLayout[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

/** Position 2D d'une planète à l'instant t (unités monde). */
export function planetWorldPosition(
  system: SystemLayout,
  slot: PlanetSlot,
  t: number,
): { x: number; y: number; angle: number } {
  const angle = slot.angle0 + slot.angularSpeed * t
  return {
    x: system.x + Math.cos(angle) * slot.orbitRadius,
    y: system.y + Math.sin(angle) * slot.orbitRadius,
    angle,
  }
}
