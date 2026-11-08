/**
 * COSMOS — Importer du contenu personnel (fichiers .md/.txt)
 * =============================================================
 * POST /api/cosmos/import  { nodeType: string, sessionId?: string,
 *                             files: [{ filename, content, lastModified? }] }
 *
 * Un fichier = un souvenir (pas de découpage par titre -- simple et
 * prévisible). Le titre est la première ligne "# ..." du fichier si elle
 * existe, sinon le nom de fichier sans extension. Pensé pour un import de
 * notes/journal personnel plutôt que du contenu généré par une conversation
 * avec l'IA -- voir cosmos-db.ts::createNode pour la limite sur
 * l'embedding (placeholder, affiné au prochain reindex).
 */

import { NextResponse } from 'next/server'
import { CosmosMutationError, createNode } from '@/lib/cosmos/cosmos-db'

export const dynamic = 'force-dynamic'

interface ImportFile {
  filename: string
  content: string
  lastModified?: string
}

function titleFromFile(file: ImportFile): string {
  const firstLine = file.content.trimStart().split('\n', 1)[0] ?? ''
  const heading = firstLine.match(/^#{1,6}\s+(.+)$/)
  if (heading) return heading[1].trim()
  return file.filename.replace(/\.[^./\\]+$/, '')
}

export async function POST(req: Request) {
  let body: { nodeType?: string; sessionId?: string; files?: ImportFile[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Corps de requête JSON invalide.' }, { status: 400 })
  }
  const { nodeType, sessionId, files } = body
  if (!nodeType || !Array.isArray(files) || files.length === 0) {
    return NextResponse.json({ ok: false, error: 'nodeType et au moins un fichier sont requis.' }, { status: 400 })
  }

  const created: string[] = []
  const errors: string[] = []
  for (const file of files) {
    if (!file.content || !file.content.trim()) {
      errors.push(`${file.filename} : vide, ignoré.`)
      continue
    }
    try {
      const id = createNode({
        nodeType,
        title: titleFromFile(file),
        content: file.content,
        sessionId: sessionId || 'import-personnel',
        createdAt: file.lastModified,
      })
      created.push(id)
    } catch (err) {
      const message = err instanceof CosmosMutationError ? err.message : 'échec inconnu'
      errors.push(`${file.filename} : ${message}`)
    }
  }

  return NextResponse.json({ ok: true, created: created.length, ids: created, errors })
}
