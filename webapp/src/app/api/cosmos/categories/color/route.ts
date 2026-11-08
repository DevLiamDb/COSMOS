/**
 * COSMOS — Recolorer une catégorie
 * =================================
 * POST /api/cosmos/categories/color  { id: string, color: string }
 * `color` attendu au format hex #rrggbb.
 */

import { NextResponse } from 'next/server'
import { CosmosMutationError, setCategoryColor } from '@/lib/cosmos/cosmos-db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { id?: string; color?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Corps de requête JSON invalide.' }, { status: 400 })
  }
  const { id, color } = body
  if (!id || !color) {
    return NextResponse.json({ ok: false, error: 'id et color sont requis.' }, { status: 400 })
  }
  try {
    setCategoryColor(id, color)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof CosmosMutationError ? err.message : 'Échec du changement de couleur.'
    if (!(err instanceof CosmosMutationError)) console.error('[api/cosmos/categories/color]', err)
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
