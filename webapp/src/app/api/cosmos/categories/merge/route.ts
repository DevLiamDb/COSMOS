/**
 * COSMOS — Fusionner deux catégories
 * ===================================
 * POST /api/cosmos/categories/merge  { source: string, target: string }
 * `source` disparaît, ses souvenirs rejoignent `target`. Irréversible.
 */

import { NextResponse } from 'next/server'
import { CosmosMutationError, mergeCategories } from '@/lib/cosmos/cosmos-db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { source?: string; target?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Corps de requête JSON invalide.' }, { status: 400 })
  }
  const { source, target } = body
  if (!source || !target) {
    return NextResponse.json({ ok: false, error: 'source et target sont requis.' }, { status: 400 })
  }
  try {
    const moved = mergeCategories(source, target)
    return NextResponse.json({ ok: true, moved })
  } catch (err) {
    const message = err instanceof CosmosMutationError ? err.message : 'Échec de la fusion.'
    if (!(err instanceof CosmosMutationError)) console.error('[api/cosmos/categories/merge]', err)
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
