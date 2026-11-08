/**
 * COSMOS — Synchronisation des données actuelles
 * ==============================================
 * GET /api/cosmos/sync
 *
 * Trois sources possibles, dans cet ordre :
 *
 * 1. Lecture DIRECTE de cosmos.db (voir cosmos-db.ts) -- source de verite
 *    primaire depuis que la webapp peut aussi ECRIRE dedans (renommer une
 *    categorie, editer/creer/epingler un souvenir). Toujours a jour, sans
 *    etape d'export manuelle : Python et cette webapp partagent le meme
 *    fichier SQLite.
 * 2. Repli : l'ancien instantane live-data.json (ecrit par l'outil MCP
 *    `cosmos_export_web`) -- utile seulement si cosmos.db est illisible
 *    pour une raison quelconque mais qu'un export anterieur existe encore.
 * 3. Dernier repli : une base Prisma/SQLite locale a cette webapp, amorcee
 *    avec un jeu de donnees ecrit a la main (current-data.ts). Ce n'est PAS
 *    du vrai cosmos.db, juste un exemple honnete si rien de reel n'existe.
 *
 * Réponse : { ok: true, dataset: CosmosDataset, stats: {...} }
 */

import { promises as fs } from 'fs'
import path from 'path'
import { NextResponse } from 'next/server'
import type { CosmosDataset, NodeType } from '@/lib/cosmos/types'
import { buildCurrentDataset } from '@/lib/cosmos/current-data'
import { readCosmosDataset } from '@/lib/cosmos/cosmos-db'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const LIVE_DATA_PATH = path.join(process.cwd(), 'src', 'lib', 'cosmos', 'live-data.json')

/** Tente de lire le vrai export COSMOS. null si le fichier est absent ou
 * illisible/corrompu -- jamais d'exception qui ferait échouer toute la
 * route pour ça. Un export réel mais VIDE (cosmos.db effacé) est valide et
 * doit être honoré tel quel : ce n'est pas un cas de repli vers le seed
 * Prisma, sinon vider cosmos.db ferait réapparaître les fausses données. */
async function readLiveCosmosExport(): Promise<CosmosDataset | null> {
  try {
    const raw = await fs.readFile(LIVE_DATA_PATH, 'utf-8')
    const data = JSON.parse(raw) as CosmosDataset
    if (!data || !Array.isArray(data.categories) || !Array.isArray(data.planets)) return null
    return data
  } catch {
    return null
  }
}

/** Parse sûrement un champ JSON stocké en TEXT ('[]' si vide/corrompu). */
function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? (v as string[]) : []
  } catch {
    return []
  }
}

/** Amorce la base avec la base de connaissances initiale si elle est vide. */
async function ensureSeeded(): Promise<void> {
  const count = await db.cosmosCategory.count()
  if (count > 0) return
  const ds = buildCurrentDataset()
  await db.cosmosSession.createMany({
    data: ds.sessions.map((s) => ({ id: s.id, label: s.label, date: new Date(s.date) })),
  })
  await db.cosmosCategory.createMany({
    data: ds.categories.map((c, i) => ({
      id: c.id,
      name: c.name,
      domain: c.metadata.domain,
      description: c.description,
      color: c.color,
      tags: JSON.stringify(c.metadata.tags),
      priority: c.priority ?? false,
      position: i,
    })),
  })
  await db.cosmosPlanet.createMany({
    data: ds.planets.map((p) => ({
      id: p.id,
      categoryId: p.category_id,
      sessionId: p.session_id || null,
      title: p.title,
      nodeType: p.node_type,
      description: p.short_description,
      content: p.content,
      color: p.color,
      importance: p.metadata.importance,
      tags: JSON.stringify(p.metadata.tags),
      connections: JSON.stringify(p.metadata.connections),
      statut: p.metadata.statut ?? null,
      createdAt: new Date(p.created_at),
      updatedAt: new Date(p.updated_at),
    })),
  })
}

export async function GET() {
  try {
    // 1. Lecture directe de cosmos.db -- reflete tout, y compris les
    // editions faites depuis cette webapp elle-meme (voir cosmos-db.ts).
    let liveDataset: CosmosDataset | null = null
    try {
      liveDataset = readCosmosDataset()
    } catch (err) {
      console.error('[api/cosmos/sync] lecture directe de cosmos.db en echec, repli sur live-data.json :', err)
    }
    if (liveDataset) {
      return NextResponse.json({
        ok: true,
        dataset: liveDataset,
        stats: {
          categories: liveDataset.categories.length,
          planets: liveDataset.planets.length,
          sessions: liveDataset.sessions.length,
          syncedAt: liveDataset.generatedAt,
          source: 'cosmos-engine-direct' as const,
        },
      })
    }

    // 2. Repli : ancien instantane JSON (cosmos.db introuvable depuis ce
    // process -- ex: dossier COSMOS/ absent sur cette machine).
    const exportedDataset = await readLiveCosmosExport()
    if (exportedDataset) {
      return NextResponse.json({
        ok: true,
        dataset: exportedDataset,
        stats: {
          categories: exportedDataset.categories.length,
          planets: exportedDataset.planets.length,
          sessions: exportedDataset.sessions.length,
          syncedAt: exportedDataset.generatedAt,
          source: 'cosmos-engine-export' as const,
        },
      })
    }

    await ensureSeeded()

    const [cats, planets, sessions] = await Promise.all([
      db.cosmosCategory.findMany({ orderBy: { position: 'asc' } }),
      db.cosmosPlanet.findMany({
        orderBy: [{ categoryId: 'asc' }, { createdAt: 'asc' }],
      }),
      db.cosmosSession.findMany({ orderBy: { date: 'asc' } }),
    ])

    const dataset: CosmosDataset = {
      categories: cats.map((c) => ({
        id: c.id,
        kind: 'category' as const,
        name: c.name,
        color: c.color,
        description: c.description,
        ...(c.priority ? { priority: true } : {}),
        metadata: {
          tags: parseJsonArray(c.tags),
          domain: c.domain,
        },
      })),
      planets: planets.map((p) => ({
        id: p.id,
        kind: 'planet' as const,
        category_id: p.categoryId,
        session_id: p.sessionId ?? '',
        node_type: p.nodeType as NodeType,
        title: p.title,
        short_description: p.description,
        content: p.content,
        created_at: p.createdAt.toISOString(),
        updated_at: p.updatedAt.toISOString(),
        color: p.color,
        metadata: {
          importance: p.importance,
          tags: parseJsonArray(p.tags),
          connections: parseJsonArray(p.connections),
          ...(p.statut ? { statut: p.statut } : {}),
        },
      })),
      sessions: sessions.map((s) => ({
        id: s.id,
        label: s.label,
        date: s.date.toISOString(),
      })),
      generatedAt: new Date().toISOString(),
      isDemo: false,
    }

    return NextResponse.json({
      ok: true,
      dataset,
      stats: {
        categories: dataset.categories.length,
        planets: dataset.planets.length,
        sessions: dataset.sessions.length,
        syncedAt: dataset.generatedAt,
        source: 'seed-example' as const,
      },
    })
  } catch (err) {
    console.error('[api/cosmos/sync] échec de la synchronisation :', err)
    return NextResponse.json(
      { ok: false, error: 'Échec de la synchronisation des données.' },
      { status: 500 },
    )
  }
}
