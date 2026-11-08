/**
 * COSMOS — Créer une planète manuellement
 * =========================================
 * POST /api/cosmos/planets  { nodeType, title, content, sessionId? }
 * Voir cosmos-db.ts::createNode pour la limite assumée sur l'embedding
 * (placeholder = prototype de la catégorie, affiné au prochain
 * cosmos_reindex() côté Python).
 */

import { NextResponse } from 'next/server'
import { CosmosMutationError, createNode } from '@/lib/cosmos/cosmos-db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { nodeType?: string; title?: string; content?: string; sessionId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Corps de requête JSON invalide.' }, { status: 400 })
  }
  const { nodeType, title, content, sessionId } = body
  if (!nodeType || !content) {
    return NextResponse.json({ ok: false, error: 'nodeType et content sont requis.' }, { status: 400 })
  }
  try {
    const id = createNode({ nodeType, title: title || '', content, sessionId })
    return NextResponse.json({ ok: true, id })
  } catch (err) {
    const message = err instanceof CosmosMutationError ? err.message : 'Échec de la création.'
    if (!(err instanceof CosmosMutationError)) console.error('[api/cosmos/planets]', err)
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
