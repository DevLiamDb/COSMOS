/**
 * COSMOS — Renommer une catégorie
 * ================================
 * POST /api/cosmos/categories/rename  { id: string, newName: string }
 * Écrit directement dans cosmos.db (voir cosmos-db.ts) : renomme la
 * catégorie ET tous les souvenirs qui lui appartiennent, dans la même
 * transaction. `id` d'une catégorie = son nom (voir types.ts).
 */

import { NextResponse } from 'next/server'
import { CosmosMutationError, renameCategory } from '@/lib/cosmos/cosmos-db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { id?: string; newName?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Corps de requête JSON invalide.' }, { status: 400 })
  }
  const { id, newName } = body
  if (!id || !newName) {
    return NextResponse.json({ ok: false, error: 'id et newName sont requis.' }, { status: 400 })
  }
  try {
    renameCategory(id, newName)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof CosmosMutationError ? err.message : 'Échec du renommage.'
    if (!(err instanceof CosmosMutationError)) console.error('[api/cosmos/categories/rename]', err)
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
