/**
 * COSMOS — Accès direct à la vraie base (cosmos.db)
 * ===================================================
 * Jusqu'ici la webapp ne lisait qu'un instantané JSON (live-data.json),
 * régénéré à la main depuis Claude Desktop via l'outil MCP
 * `cosmos_export_web`. Ça marchait pour la lecture, mais rendait
 * impossible toute édition depuis l'interface : un renommage de
 * catégorie ou une correction de texte fait ici aurait été écrasé au
 * prochain export, ou pire, invisible tant que personne ne relance
 * l'outil côté Claude.
 *
 * Ce module ouvre directement le fichier SQLite que le moteur Python
 * (COSMOS/cosmos/db.py) lit et écrit — les deux processus partagent le
 * même fichier, en WAL pour un accès concurrent correct. La webapp
 * devient un vrai deuxième client de la même base, pas un lecteur d'un
 * export figé.
 *
 * Limite assumée : la personnalisation faite ici (titre, contenu,
 * catégorie, épinglage) ne recalcule PAS l'embedding vectoriel — ça
 * demande le modèle fastembed, qui n'existe que côté Python. Un souvenir
 * édité ou créé ici reste donc cherchable par mot-clé/catégorie
 * immédiatement, mais son positionnement sémantique (recherche par sens,
 * liens automatiques) ne se met à jour qu'au prochain `cosmos_reindex()`
 * lancé depuis une conversation Claude. C'est documenté dans l'UI plutôt
 * que caché.
 */

import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import type { CategoryNode, CosmosDataset, NodeType, PlanetNode } from './types'

/** Même mapping, même palette, même titre-extraction que
 *  COSMOS/cosmos/web_export.py — dupliqué ici volontairement (pas de
 *  dépendance runtime entre un projet Python et un projet Next.js), mais
 *  gardé strictement synchronisé. Si l'un bouge, l'autre doit bouger. */
const NODE_TYPE_MAPPING: Record<string, NodeType> = {
  fait: 'note',
  decision: 'decision',
  tache: 'tache',
  preference: 'reference',
  contexte_projet: 'projet',
  question_ouverte: 'idee',
  regle: 'reference',
}
const DEFAULT_NODE_TYPE: NodeType = 'note'

const PALETTE = [
  '#7aa2f7', '#e0af68', '#f7768e', '#9ece6a', '#bb9af7', '#73daca',
  '#ff9e64', '#2ac3de', '#c0caf5', '#7dcfff', '#b4f9f8', '#f7c8e0',
  '#a9b1d6', '#c3e88d',
]
const EMBEDDING_DIM = 384

function extractTitle(surface: string): string {
  const parts = surface.split(/(?<=[.!?])\s+/)
  const first = parts[0] ?? surface
  return first.length <= 60 ? first : first.slice(0, 57) + '…'
}

/** Port fidèle de COSMOS/cosmos/summarizer.py::_naive_extractive — pour
 *  qu'un souvenir édité depuis la webapp obtienne le même genre de résumé
 *  Surface qu'un souvenir écrit par l'IA, sans dépendre de Python. */
function naiveSummarize(text: string, maxChars = 240): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  const sentences = trimmed.split(/(?<=[.!?])\s+/)
  let out = ''
  for (const s of sentences) {
    if (out.length + s.length + 1 > maxChars) break
    out = `${out} ${s}`.trim()
  }
  if (!out) out = trimmed.slice(0, maxChars).trimEnd() + '…'
  return out
}

function isHexColor(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v)
}

function floatBufferToArray(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

function floatArrayToBuffer(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
}

function zeroEmbedding(): Buffer {
  return floatArrayToBuffer(new Float32Array(EMBEDDING_DIM))
}

/* ------------------------------------------------------------------ */
/* Connexion + migration (miroir de COSMOS/cosmos/db.py::_run_migrations) */
/* ------------------------------------------------------------------ */

function defaultDbPath(): string {
  // webapp/ est désormais un sous-dossier de COSMOS/ (fusion backend +
  // webapp) -- cosmos.db vit un niveau au-dessus du cwd de ce process Next.js.
  return path.resolve(process.cwd(), '..', 'cosmos.db')
}

export function cosmosDbPath(): string {
  return process.env.COSMOS_DB_PATH || defaultDbPath()
}

/** true seulement si le vrai moteur Python a déjà tourné au moins une
 *  fois (la base existe). On n'invente jamais un cosmos.db vide depuis
 *  la webapp — Python reste seul responsable de la création initiale. */
export function cosmosDbExists(): boolean {
  try {
    // turbopackIgnore : le chemin pointe volontairement hors du projet
    // (dossier COSMOS/ frère de celui-ci) -- pas question de le figer en
    // sous-dossier statique pour faire taire l'avertissement de traçage.
    return fs.statSync(/* turbopackIgnore: true */ cosmosDbPath()).size > 0
  } catch {
    return false
  }
}

type ColumnMigrations = Record<string, Record<string, string>>

const MIGRATIONS: ColumnMigrations = {
  categories: { color: 'ALTER TABLE categories ADD COLUMN color TEXT' },
  nodes: {
    pinned: 'ALTER TABLE nodes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0',
    title: 'ALTER TABLE nodes ADD COLUMN title TEXT',
    updated_at: 'ALTER TABLE nodes ADD COLUMN updated_at TEXT',
  },
}

function ensureSchema(db: Database.Database): void {
  for (const [table, columns] of Object.entries(MIGRATIONS)) {
    const existing = new Set(
      (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((r) => r.name),
    )
    for (const [column, ddl] of Object.entries(columns)) {
      if (!existing.has(column)) db.exec(ddl)
    }
  }
  db.exec("UPDATE nodes SET updated_at = created_at WHERE updated_at IS NULL")
}

const globalForCosmos = globalThis as unknown as { cosmosDb?: Database.Database }

/** Connexion process-wide (réutilisée entre requêtes, comme lib/db.ts
 *  pour Prisma) — WAL pour que Python (connexion longue durée) et cette
 *  webapp (ouvertures ponctuelles par requête API) cohabitent sans se
 *  bloquer mutuellement sur un simple accès en lecture. */
function getDb(): Database.Database {
  if (globalForCosmos.cosmosDb) return globalForCosmos.cosmosDb
  const db = new Database(cosmosDbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 3000')
  ensureSchema(db)
  if (process.env.NODE_ENV !== 'production') globalForCosmos.cosmosDb = db
  return db
}

/* ------------------------------------------------------------------ */
/* Lecture — reconstruit le CosmosDataset directement depuis les tables */
/* (remplace le pipeline export_graph() -> build_web_dataset() côté     */
/* Python pour la lecture ; celui-ci reste utilisable en secours manuel) */
/* ------------------------------------------------------------------ */

interface CategoryRow {
  name: string
  n_examples: number
  priority: number
  color: string | null
  created_at: string
}

interface NodeRow {
  id: string
  session_id: string
  node_type: string
  surface: string
  abyss: string
  title: string | null
  pinned: number
  created_at: string
  updated_at: string | null
}

interface EdgeRow {
  from_node: string
  to_node: string
}

/** Couleurs manquantes assignées et persistées dans l'ordre alphabétique
 *  des catégories — exactement l'algorithme de
 *  CosmosEngine.list_categories() côté Python, pour qu'une catégorie
 *  garde la même couleur qu'elle soit d'abord lue par la webapp ou par
 *  Claude. */
function loadCategoriesWithColor(db: Database.Database): CategoryRow[] {
  const rows = db
    .prepare('SELECT name, n_examples, priority, color, created_at FROM categories ORDER BY name')
    .all() as CategoryRow[]
  const updateColor = db.prepare('UPDATE categories SET color = ? WHERE name = ?')
  rows.forEach((row, i) => {
    if (!row.color) {
      row.color = PALETTE[i % PALETTE.length]
      updateColor.run(row.color, row.name)
    }
  })
  return rows
}

export function readCosmosDataset(): CosmosDataset | null {
  if (!cosmosDbExists()) return null
  const db = getDb()

  const categoryRows = loadCategoriesWithColor(db)
  const nodeRows = db
    .prepare(
      'SELECT id, session_id, node_type, surface, abyss, title, pinned, created_at, updated_at FROM nodes',
    )
    .all() as NodeRow[]
  const edgeRows = db.prepare('SELECT from_node, to_node FROM edges').all() as EdgeRow[]

  // Seules les catégories avec au moins un vrai souvenir deviennent une
  // étoile — un système vide n'a pas de sens visuellement.
  const categoryNames = [...new Set(nodeRows.map((n) => n.node_type))].sort()
  const colorByName = new Map(categoryRows.map((c) => [c.name, c.color as string]))
  const priorityByName = new Map(categoryRows.map((c) => [c.name, Boolean(c.priority)]))

  const nodeIds = new Set(nodeRows.map((n) => n.id))
  const connections = new Map<string, Set<string>>()
  for (const id of nodeIds) connections.set(id, new Set())
  for (const e of edgeRows) {
    if (nodeIds.has(e.from_node) && nodeIds.has(e.to_node)) {
      connections.get(e.from_node)!.add(e.to_node)
      connections.get(e.to_node)!.add(e.from_node)
    }
  }

  const sessionFirstSeen = new Map<string, string>()
  const planets: PlanetNode[] = nodeRows.map((n) => {
    const existing = sessionFirstSeen.get(n.session_id)
    if (!existing || n.created_at < existing) sessionFirstSeen.set(n.session_id, n.created_at)
    const isPriority = priorityByName.get(n.node_type) ?? false
    return {
      id: n.id,
      kind: 'planet',
      category_id: n.node_type,
      session_id: n.session_id,
      node_type: NODE_TYPE_MAPPING[n.node_type] ?? DEFAULT_NODE_TYPE,
      title: n.title || extractTitle(n.surface),
      short_description: n.surface,
      content: n.abyss,
      created_at: n.created_at,
      updated_at: n.updated_at || n.created_at,
      color: colorByName.get(n.node_type) ?? '#7aa2f7',
      metadata: {
        importance: isPriority ? 5 : 3,
        tags: [],
        connections: [...(connections.get(n.id) ?? [])].sort(),
        pinned: Boolean(n.pinned),
      },
    }
  })

  const categories: CategoryNode[] = categoryNames.map((name) => {
    const isPriority = priorityByName.get(name) ?? false
    return {
      id: name,
      kind: 'category',
      name,
      color: colorByName.get(name) ?? '#7aa2f7',
      description: isPriority
        ? 'Catégorie prioritaire — chargée automatiquement par cosmos_priority_context, sans avoir à la rechercher.'
        : 'Catégorie de souvenirs COSMOS.',
      priority: isPriority,
      metadata: { tags: [], domain: name },
    }
  })

  const sessions = [...sessionFirstSeen.entries()].map(([id, date]) => ({ id, label: id, date }))

  return {
    categories,
    planets,
    sessions,
    generatedAt: new Date().toISOString(),
    isDemo: false,
  }
}

/* ------------------------------------------------------------------ */
/* Écriture — personnalisation manuelle depuis la webapp                */
/* ------------------------------------------------------------------ */

export class CosmosMutationError extends Error {}

function requireCategory(db: Database.Database, name: string): CategoryRow {
  const row = db
    .prepare('SELECT name, n_examples, priority, color, created_at FROM categories WHERE name = ?')
    .get(name) as CategoryRow | undefined
  if (!row) throw new CosmosMutationError(`catégorie inconnue : ${name}`)
  return row
}

export function renameCategory(oldName: string, newName: string): void {
  const trimmed = newName.trim()
  if (!trimmed) throw new CosmosMutationError('le nouveau nom ne peut pas être vide')
  const db = getDb()
  requireCategory(db, oldName)
  const clash = db.prepare('SELECT name FROM categories WHERE name = ?').get(trimmed)
  if (clash) throw new CosmosMutationError(`« ${trimmed} » existe déjà — utilise la fusion à la place`)
  const tx = db.transaction(() => {
    db.prepare('UPDATE categories SET name = ? WHERE name = ?').run(trimmed, oldName)
    db.prepare('UPDATE nodes SET node_type = ? WHERE node_type = ?').run(trimmed, oldName)
  })
  tx()
}

export function setCategoryColor(name: string, color: string): void {
  if (!isHexColor(color)) throw new CosmosMutationError('couleur invalide (attendu #rrggbb)')
  const db = getDb()
  requireCategory(db, name)
  db.prepare('UPDATE categories SET color = ? WHERE name = ?').run(color, name)
}

export function mergeCategories(source: string, target: string): number {
  if (source === target) throw new CosmosMutationError('impossible de fusionner une catégorie avec elle-même')
  const db = getDb()
  const src = requireCategory(db, source)
  const tgt = requireCategory(db, target)
  const tx = db.transaction(() => {
    const nSrc = src.n_examples
    const nTgt = tgt.n_examples
    const total = nSrc + nTgt

    const srcEmb = floatBufferToArray(
      (db.prepare('SELECT embedding FROM categories WHERE name = ?').get(source) as { embedding: Buffer }).embedding,
    )
    const tgtEmb = floatBufferToArray(
      (db.prepare('SELECT embedding FROM categories WHERE name = ?').get(target) as { embedding: Buffer }).embedding,
    )
    let mergedVec: Float32Array
    if (total > 0) {
      mergedVec = new Float32Array(EMBEDDING_DIM)
      for (let i = 0; i < EMBEDDING_DIM; i++) {
        mergedVec[i] = (srcEmb[i] * nSrc + tgtEmb[i] * nTgt) / total
      }
    } else {
      mergedVec = tgtEmb
    }

    const moved = db.prepare('UPDATE nodes SET node_type = ? WHERE node_type = ?').run(target, source).changes
    db.prepare('UPDATE categories SET embedding = ?, n_examples = ?, priority = ? WHERE name = ?').run(
      floatArrayToBuffer(mergedVec),
      total,
      (src.priority || tgt.priority) ? 1 : 0,
      target,
    )
    db.prepare('DELETE FROM categories WHERE name = ?').run(source)
    return moved
  })
  return tx()
}

interface UpdateNodeInput {
  title?: string | null
  content?: string
  nodeType?: string
}

export function updateNode(nodeId: string, input: UpdateNodeInput): boolean {
  const db = getDb()
  const row = db.prepare('SELECT node_type FROM nodes WHERE id = ?').get(nodeId) as
    | { node_type: string }
    | undefined
  if (!row) return false

  const sets: string[] = []
  const params: unknown[] = []
  if (input.content !== undefined && input.content.trim()) {
    const surface = naiveSummarize(input.content)
    sets.push('abyss = ?', 'surface = ?')
    params.push(input.content, surface)
  }
  if (input.title !== undefined) {
    sets.push('title = ?')
    params.push(input.title || null)
  }
  if (input.nodeType !== undefined && input.nodeType !== row.node_type) {
    touchCategory(db, input.nodeType)
    sets.push('node_type = ?')
    params.push(input.nodeType)
  }
  if (sets.length === 0) return true
  sets.push('updated_at = ?')
  params.push(new Date().toISOString(), nodeId)
  db.prepare(`UPDATE nodes SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  return true
}

export function setPinned(nodeId: string, pinned: boolean): boolean {
  const db = getDb()
  const result = db
    .prepare('UPDATE nodes SET pinned = ?, updated_at = ? WHERE id = ?')
    .run(pinned ? 1 : 0, new Date().toISOString(), nodeId)
  return result.changes > 0
}

/** Crée (sans embedding réel, voir note en tête de fichier) ou retrouve
 *  la catégorie cible, avec un vecteur prototype raisonnable par défaut
 *  (celui de la catégorie si elle existe déjà, sinon zéro) plutôt qu'une
 *  valeur totalement arbitraire. */
function touchCategory(db: Database.Database, name: string): void {
  const row = db.prepare('SELECT name FROM categories WHERE name = ?').get(name)
  if (row) return
  db.prepare(
    'INSERT INTO categories (name, embedding, n_examples, priority, color, created_at) VALUES (?, ?, 0, 0, NULL, ?)',
  ).run(name, zeroEmbedding(), new Date().toISOString())
}

export interface CreateNodeInput {
  nodeType: string
  title: string
  content: string
  sessionId?: string
  createdAt?: string
}

/** Création manuelle d'une planète depuis la webapp, sans passer par une
 *  conversation avec l'IA. L'embedding utilisé est celui de la catégorie
 *  cible (raisonnable : place le souvenir près des autres de son
 *  groupe) — affiné au prochain cosmos_reindex(). */
export function createNode(input: CreateNodeInput): string {
  if (!input.content.trim()) throw new CosmosMutationError('le contenu ne peut pas être vide')
  const db = getDb()
  const nodeId = randomUUID()
  const now = new Date().toISOString()
  const createdAt = input.createdAt || now
  const surface = naiveSummarize(input.content)

  const tx = db.transaction(() => {
    const catRow = db
      .prepare('SELECT embedding, n_examples FROM categories WHERE name = ?')
      .get(input.nodeType) as { embedding: Buffer; n_examples: number } | undefined
    const embedding = catRow ? catRow.embedding : zeroEmbedding()

    db.prepare(
      'INSERT INTO nodes (id, session_id, node_type, surface, abyss, title, pinned, embedding, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
    ).run(
      nodeId,
      input.sessionId || 'manuel',
      input.nodeType,
      surface,
      input.content,
      input.title || null,
      embedding,
      createdAt,
      now,
    )

    if (catRow) {
      db.prepare('UPDATE categories SET n_examples = n_examples + 1 WHERE name = ?').run(input.nodeType)
    } else {
      db.prepare(
        'INSERT INTO categories (name, embedding, n_examples, priority, color, created_at) VALUES (?, ?, 1, 0, NULL, ?)',
      ).run(input.nodeType, embedding, now)
    }
  })
  tx()
  return nodeId
}
