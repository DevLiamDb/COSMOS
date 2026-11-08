/**
 * COSMOS — Épingler / désépingler une planète
 * =============================================
 * POST /api/cosmos/planets/[id]/pin  { pinned: boolean }
 */

import { NextResponse } from 'next/server'
import { setPinned } from '@/lib/cosmos/cosmos-db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { pinned?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Corps de requête JSON invalide.' }, { status: 400 })
  }
  if (typeof body.pinned !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'pinned (boolean) est requis.' }, { status: 400 })
  }
  const ok = setPinned(id, body.pinned)
  if (!ok) return NextResponse.json({ ok: false, error: `Aucun souvenir avec l'id ${id}.` }, { status: 404 })
  return NextResponse.json({ ok: true, pinned: body.pinned })
}
