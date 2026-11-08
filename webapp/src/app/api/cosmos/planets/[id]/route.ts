/**
 * COSMOS — Éditer une planète existante
 * =======================================
 * PATCH /api/cosmos/planets/[id]  { title?, content?, nodeType? }
 * Ne change que les champs fournis. Voir cosmos-db.ts::updateNode pour la
 * limite assumée (pas de recalcul d'embedding depuis la webapp).
 */

import { NextResponse } from 'next/server'
import { CosmosMutationError, updateNode } from '@/lib/cosmos/cosmos-db'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { title?: string | null; content?: string; nodeType?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Corps de requête JSON invalide.' }, { status: 400 })
  }
  try {
    const ok = updateNode(id, { title: body.title, content: body.content, nodeType: body.nodeType })
    if (!ok) return NextResponse.json({ ok: false, error: `Aucun souvenir avec l'id ${id}.` }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof CosmosMutationError ? err.message : 'Échec de la modification.'
    if (!(err instanceof CosmosMutationError)) console.error('[api/cosmos/planets/[id]]', err)
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
