/**
 * COSMOS — Recherche globale instantanée
 * ======================================
 * Indexe catégories et planètes (titres, contenus, descriptions, sessions,
 * types, identifiants) et retourne des résultats scorés, groupés par catégorie.
 * Le scan complet (~600 entités) est suffisamment rapide pour être fait à
 * chaque frappe, sans worker ni debounce lourd.
 */

import type { CosmosDataset, NodeType } from './types'
import { NODE_TYPES } from './types'

export interface SearchHit {
  kind: 'category' | 'planet'
  id: string
  categoryId: string
  title: string
  subtitle: string
  /** Extrait de contenu autour de la première occurrence (si match contenu). */
  snippet: string | null
  score: number
}

interface IndexedPlanet {
  id: string
  categoryId: string
  title: string
  titleN: string
  desc: string
  descN: string
  content: string
  contentN: string
  type: NodeType
  typeLabel: string
  sessionId: string
  importance: number
}

interface IndexedCategory {
  id: string
  name: string
  nameN: string
  desc: string
  descN: string
  tags: string[]
}

export interface SearchIndex {
  planets: IndexedPlanet[]
  categories: IndexedCategory[]
}

/** Normalisation : minuscules + suppression des diacritiques. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

export function buildSearchIndex(dataset: CosmosDataset): SearchIndex {
  return {
    categories: dataset.categories.map((c) => ({
      id: c.id,
      name: c.name,
      nameN: norm(c.name),
      desc: c.description,
      descN: norm(c.description),
      tags: c.metadata.tags.map(norm),
    })),
    planets: dataset.planets.map((p) => ({
      id: p.id,
      categoryId: p.category_id,
      title: p.title,
      titleN: norm(p.title),
      desc: p.short_description,
      descN: norm(p.short_description),
      content: p.content,
      contentN: norm(p.content),
      type: p.node_type,
      typeLabel: NODE_TYPES[p.node_type].label,
      sessionId: p.session_id,
      importance: p.metadata.importance,
    })),
  }
}

/** Score d'un champ : préfixe > mot entier > sous-chaîne. */
function fieldScore(field: string, token: string): number {
  const idx = field.indexOf(token)
  if (idx === -1) return 0
  if (idx === 0) return 3
  const before = field[idx - 1]
  if (before === ' ' || before === '-' || before === '/' || before === '(') return 2.4
  return 1.2
}

function snippetAround(content: string, token: string): string | null {
  const idx = norm(content).indexOf(token)
  if (idx === -1) return null
  const from = Math.max(0, idx - 46)
  const to = Math.min(content.length, idx + token.length + 70)
  const raw = content.slice(from, to).replace(/\s+/g, ' ')
  return `${from > 0 ? '…' : ''}${raw}${to < content.length ? '…' : ''}`
}

/**
 * Recherche multi-jetons : tous les jetons doivent matcher (ET) quelque part,
 * le score agrège la pertinence par champ.
 */
export function searchCosmos(index: SearchIndex, rawQuery: string, limit = 50): SearchHit[] {
  const query = norm(rawQuery.trim())
  if (query.length === 0) return []
  const tokens = query.split(/\s+/).filter(Boolean).slice(0, 6)
  if (tokens.length === 0) return []
  const hits: SearchHit[] = []

  // --- catégories ------------------------------------------------------
  for (const c of index.categories) {
    let total = 0
    let all = true
    for (const tk of tokens) {
      const s =
        fieldScore(c.nameN, tk) * 10 +
        fieldScore(c.descN, tk) * 3 +
        (c.tags.some((t) => t.includes(tk)) ? 5 : 0)
      if (s === 0) {
        all = false
        break
      }
      total += s
    }
    if (all) {
      hits.push({
        kind: 'category',
        id: c.id,
        categoryId: c.id,
        title: c.name,
        subtitle: 'Catégorie · système solaire',
        snippet: c.desc.length > 90 ? `${c.desc.slice(0, 90)}…` : c.desc,
        score: total + 14, // bonus : les catégories remontent naturellement
      })
    }
  }

  // --- planètes ---------------------------------------------------------
  for (const p of index.planets) {
    let total = 0
    let all = true
    let contentMatch = false
    for (const tk of tokens) {
      let s =
        fieldScore(p.titleN, tk) * 12 +
        fieldScore(p.descN, tk) * 4 +
        fieldScore(p.typeLabel.toLowerCase(), tk) * 3.5 +
        (p.sessionId.includes(tk) ? 2.2 : 0) +
        (p.id.includes(tk) ? (tk.length >= 3 ? 2.8 : 0.8) : 0)
      if (s === 0) {
        // dernier recours : le contenu complet
        const cs = fieldScore(p.contentN, tk)
        if (cs === 0) {
          all = false
          break
        }
        s = cs * 1
        contentMatch = true
      }
      total += s
    }
    if (all) {
      total += p.importance * 0.9
      hits.push({
        kind: 'planet',
        id: p.id,
        categoryId: p.categoryId,
        title: p.title,
        subtitle: `${p.typeLabel} · session ${p.sessionId.slice(-2)}`,
        snippet: contentMatch ? snippetAround(p.content, tokens[0]) : p.desc,
        score: total,
      })
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}
