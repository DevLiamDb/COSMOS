'use client'

/**
 * COSMOS — FilterBar
 * ==================
 * Bas-gauche : légende du vocabulaire (✦ étoile / ● planète) et bouton
 * « Filtres » ouvrant un Popover de filtrage par type de donnée.
 * Le bouton reste visible sur mobile, au-dessus de la zone sûre.
 */

import { useMemo, useRef, useState } from 'react'
import { Loader2, SlidersHorizontal, Upload, X } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { dataset, useCosmos } from '@/lib/cosmos/store'
import { NODE_TYPES, NODE_TYPE_ORDER } from '@/lib/cosmos/types'
import { cn } from '@/lib/utils'
import { typeCounts } from './shared'

export function FilterBar() {
  const activeTypes = useCosmos((s) => s.activeTypes)
  const toggleType = useCosmos((s) => s.toggleType)
  const clearTypes = useCosmos((s) => s.clearTypes)
  const activeSessionId = useCosmos((s) => s.activeSessionId)
  const setSessionFilter = useCosmos((s) => s.setSessionFilter)
  // Signal de re-rendu : le dataset est muté en place, ses longueurs sont
  // toujours à jour au moment du rendu.
  const dataVersion = useCosmos((s) => s.dataVersion)
  const [open, setOpen] = useState(false)

  // Sessions triées de la plus récente à la plus ancienne, avec leur
  // nombre de planètes — recalculé seulement quand le dataset change.
  const sessionsWithCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of dataset.planets) counts.set(p.session_id, (counts.get(p.session_id) ?? 0) + 1)
    return [...dataset.sessions]
      .filter((s) => counts.has(s.id))
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((s) => ({ ...s, count: counts.get(s.id) ?? 0 }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion])

  // Univers vide : rien à filtrer, la légende et les filtres disparaissent
  // -- mais l'import reste utile ici, justement pour peupler un univers
  // vide avec du contenu personnel plutôt que d'attendre une conversation.
  if (dataset.categories.length === 0) {
    return (
      <div className="pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom)_+_1rem)] left-4 z-40 flex flex-col items-start gap-2 md:bottom-5 md:left-5">
        <ImportButton />
      </div>
    )
  }

  return (
    <div className="pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom)_+_1rem)] left-4 z-40 flex flex-col items-start gap-2 md:bottom-5 md:left-5">
      {/* Légende (cachée sur très petit écran) */}
      <p className="cosmos-glass pointer-events-none hidden items-center whitespace-nowrap rounded-full px-3.5 py-2 text-[11px] text-muted-foreground sm:flex">
        <span className="text-primary" aria-hidden="true">
          ✦
        </span>
        <span className="ml-1.5">étoile = catégorie</span>
        <span className="mx-2 text-muted-foreground/40" aria-hidden="true">
          ·
        </span>
        <span aria-hidden="true">●</span>
        <span className="ml-1.5">planète = donnée</span>
      </p>

      {/* Filtres par type */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={
              activeTypes.length > 0 || activeSessionId
                ? `Filtrer — ${activeTypes.length + (activeSessionId ? 1 : 0)} filtre(s) actif(s)`
                : 'Filtrer'
            }
            className="cosmos-glass pointer-events-auto flex h-11 items-center gap-2 rounded-xl px-3.5 text-xs font-medium text-foreground/90 transition hover:brightness-[1.13]"
          >
            <SlidersHorizontal size={14} strokeWidth={1.5} className="text-muted-foreground" aria-hidden="true" />
            Filtres
            {(activeTypes.length > 0 || activeSessionId) && (
              <span
                className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
                aria-hidden="true"
              >
                {activeTypes.length + (activeSessionId ? 1 : 0)}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={10}
          className="w-[min(340px,calc(100vw_-_2rem))] rounded-2xl border-white/10 bg-popover/95 p-3.5 shadow-2xl backdrop-blur-xl"
        >
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Types de données
          </p>

          <div className="mt-2.5 grid grid-cols-2 gap-1.5">
            {NODE_TYPE_ORDER.map((t) => {
              const active = activeTypes.includes(t)
              const count = typeCounts.get(t) ?? 0
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(t)}
                  aria-pressed={active}
                  className={cn(
                    'flex h-10 items-center justify-between gap-1.5 rounded-lg border px-2.5 text-xs transition',
                    active
                      ? 'border-white/25 bg-white/[0.12] text-foreground'
                      : 'border-white/[0.08] text-muted-foreground hover:border-white/[0.16] hover:text-foreground/90',
                  )}
                >
                  <span className="truncate">{NODE_TYPES[t].label}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">{count}</span>
                </button>
              )
            })}
          </div>

          <div className="mt-2.5 flex min-h-6 items-center">
            {activeTypes.length > 0 ? (
              <button
                type="button"
                onClick={() => clearTypes()}
                className="text-xs text-primary transition hover:underline"
              >
                Tout afficher
              </button>
            ) : (
              <span className="text-[11px] text-muted-foreground/70">Tous les types sont affichés</span>
            )}
          </div>

          {sessionsWithCounts.length > 1 && (
            <>
              <p className="mt-3 border-t border-white/[0.06] pt-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Session
              </p>
              <div className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
                {sessionsWithCounts.map((s) => {
                  const active = activeSessionId === s.id
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSessionFilter(s.id)}
                      aria-pressed={active}
                      className={cn(
                        'flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition',
                        active
                          ? 'border-white/25 bg-white/[0.12] text-foreground'
                          : 'border-white/[0.08] text-muted-foreground hover:border-white/[0.16] hover:text-foreground/90',
                      )}
                    >
                      <span className="truncate">{s.label}</span>
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">{s.count}</span>
                    </button>
                  )
                })}
              </div>
              {activeSessionId && (
                <button
                  type="button"
                  onClick={() => setSessionFilter(null)}
                  className="mt-1.5 text-xs text-primary transition hover:underline"
                >
                  Toutes les sessions
                </button>
              )}
            </>
          )}

          <p className="mt-2.5 border-t border-white/[0.06] pt-2.5 text-[10px] text-muted-foreground/60">
            {dataset.isDemo
              ? `Univers de démonstration — ${dataset.planets.length} planètes fictives`
              : `${dataset.planets.length} planètes`}
          </p>
        </PopoverContent>
      </Popover>

      <ImportButton />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Import de notes personnelles (.md/.txt)                             */
/* ------------------------------------------------------------------ */

function ImportButton() {
  const importNotes = useCosmos((s) => s.importNotes)
  const mutating = useCosmos((s) => s.mutating)
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState('journal')
  const [files, setFiles] = useState<File[]>([])
  const [importing, setImporting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const existingCategoryNames = [...new Set(dataset.categories.map((c) => c.name))]

  const pickFiles = (list: FileList | null) => {
    if (!list) return
    setFiles((prev) => [...prev, ...Array.from(list)])
  }
  const removeFile = (i: number) => setFiles((prev) => prev.filter((_, j) => j !== i))

  const submit = async () => {
    if (!category.trim() || files.length === 0) return
    setImporting(true)
    try {
      const payload = await Promise.all(
        files.map(
          (f) =>
            new Promise<{ filename: string; content: string; lastModified?: string }>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () =>
                resolve({
                  filename: f.name,
                  content: String(reader.result ?? ''),
                  lastModified: new Date(f.lastModified).toISOString(),
                })
              reader.onerror = () => reject(reader.error)
              reader.readAsText(f)
            }),
        ),
      )
      const created = await importNotes({ nodeType: category.trim(), files: payload })
      if (created > 0) {
        setFiles([])
        setOpen(false)
      }
    } finally {
      setImporting(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Importer mes propres notes"
          className="cosmos-glass pointer-events-auto flex h-11 items-center gap-2 rounded-xl px-3.5 text-xs font-medium text-foreground/90 transition hover:brightness-[1.13]"
        >
          <Upload size={14} strokeWidth={1.5} className="text-muted-foreground" aria-hidden="true" />
          Importer
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        className="w-[min(340px,calc(100vw_-_2rem))] rounded-2xl border-white/10 bg-popover/95 p-3.5 shadow-2xl backdrop-blur-xl"
      >
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Importer mes notes
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground/80">
          Chaque fichier .md/.txt devient un souvenir. Le titre est repris du premier « # titre » du
          fichier, sinon de son nom.
        </p>

        <label className="mt-3 block text-[10px] uppercase tracking-wider text-muted-foreground/70">
          Catégorie de destination
        </label>
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          list="cosmos-import-categories"
          placeholder="ex: journal"
          className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <datalist id="cosmos-import-categories">
          {existingCategoryNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>

        <input
          ref={inputRef}
          type="file"
          accept=".md,.txt,text/markdown,text/plain"
          multiple
          className="hidden"
          onChange={(e) => pickFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-2.5 flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 text-xs text-muted-foreground transition hover:border-white/30 hover:text-foreground"
        >
          Choisir des fichiers…
        </button>

        {files.length > 0 && (
          <ul className="mt-2 flex max-h-32 flex-col gap-1 overflow-y-auto">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.04] px-2 py-1 text-[11px] text-foreground/85"
              >
                <span className="truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  aria-label={`Retirer ${f.name}`}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={importing || mutating || files.length === 0 || !category.trim()}
          className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-xs font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-40"
        >
          {importing && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
          Importer {files.length > 0 ? `(${files.length})` : ''}
        </button>
      </PopoverContent>
    </Popover>
  )
}
