'use client'

/**
 * COSMOS — DetailPanel
 * ====================
 * Panneau de détails de la sélection : planète (donnée textuelle) ou
 * catégorie (étoile + système). Desktop = panneau latéral droit ;
 * mobile = bottom-sheet avec poignée et zone sûre iOS.
 *
 * Le composant reste monté et pilote sa visibilité via AnimatePresence
 * (ouvert = detailOpen ET une sélection). La liste des planètes d'une
 * catégorie reste complète même si un filtre de types est actif :
 * c'est un index du système, pas une vue filtrée.
 */

import { Fragment, useEffect, useReducer, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Crosshair, Loader2, Pencil, Pin, Plus, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { categoryById, dataset, planetById, sessionById, useCosmos } from '@/lib/cosmos/store'
import { NODE_TYPES, type CategoryNode, type PlanetNode } from '@/lib/cosmos/types'
import { formatDate, formatRelative, readingTime, shortId } from '@/lib/cosmos/format'
import { cn } from '@/lib/utils'
import { EASE, ImportanceDots, planetsByCategory, TertiaryButton } from './shared'

export function DetailPanel() {
  const detailOpen = useCosmos((s) => s.detailOpen)
  const selectedPlanetId = useCosmos((s) => s.selectedPlanetId)
  const selectedCategoryId = useCosmos((s) => s.selectedCategoryId)

  const planet = selectedPlanetId ? (planetById.get(selectedPlanetId) ?? null) : null
  const category = planet
    ? null
    : selectedCategoryId
      ? (categoryById.get(selectedCategoryId) ?? null)
      : null
  const open = detailOpen && (planet !== null || category !== null)

  return (
    <AnimatePresence>
      {open && planet !== null && (
        <Fragment key="planet">
          <DesktopPanel>
            <PlanetDetail planet={planet} />
          </DesktopPanel>
          <MobilePanel>
            <PlanetDetail planet={planet} />
          </MobilePanel>
        </Fragment>
      )}
      {open && planet === null && category !== null && (
        <Fragment key="category">
          <DesktopPanel>
            <CategoryDetail category={category} />
          </DesktopPanel>
          <MobilePanel>
            <CategoryDetail category={category} />
          </MobilePanel>
        </Fragment>
      )}
    </AnimatePresence>
  )
}

/* ------------------------------------------------------------------ */
/* Coques desktop / mobile                                             */
/* ------------------------------------------------------------------ */

function DesktopPanel({ children }: { children: ReactNode }) {
  return (
    <motion.aside
      aria-label="Détails de la sélection"
      className="cosmos-glass fixed bottom-5 right-5 top-[76px] z-40 hidden w-[400px] max-w-[calc(100vw_-_2.5rem)] flex-col overflow-hidden rounded-2xl md:flex"
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ duration: 0.26, ease: EASE }}
    >
      {children}
    </motion.aside>
  )
}

function MobilePanel({ children }: { children: ReactNode }) {
  return (
    <motion.aside
      aria-label="Détails de la sélection"
      className="cosmos-glass fixed inset-x-0 bottom-0 z-40 flex max-h-[72dvh] flex-col overflow-hidden rounded-t-3xl md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 40, opacity: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
    >
      {/* Poignée */}
      <div className="flex shrink-0 justify-center pb-1 pt-2.5">
        <span className="h-1 w-9 rounded-full bg-white/15" aria-hidden="true" />
      </div>
      {children}
    </motion.aside>
  )
}

function CloseButton() {
  const setDetailOpen = useCosmos((s) => s.setDetailOpen)
  return (
    <button
      type="button"
      onClick={() => setDetailOpen(false)}
      aria-label="Fermer le panneau de détails"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-white/[0.08] hover:text-foreground"
    >
      <X size={16} strokeWidth={1.5} aria-hidden="true" />
    </button>
  )
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</dt>
      <dd className="mt-1 truncate text-xs text-foreground/90">{children}</dd>
    </div>
  )
}

function RecenterButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl text-xs text-muted-foreground transition hover:bg-white/[0.07] hover:text-foreground active:scale-[0.98]"
    >
      <Crosshair size={14} strokeWidth={1.5} aria-hidden="true" />
      {label}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Mode planète                                                        */
/* ------------------------------------------------------------------ */

function PlanetDetail({ planet }: { planet: PlanetNode }) {
  const focusCategory = useCosmos((s) => s.focusCategory)
  const focusPlanet = useCosmos((s) => s.focusPlanet)
  const jumpToPlanet = useCosmos((s) => s.jumpToPlanet)
  const highlight = useCosmos((s) => s.highlight)
  const togglePin = useCosmos((s) => s.togglePin)
  const updatePlanet = useCosmos((s) => s.updatePlanet)
  const mutating = useCosmos((s) => s.mutating)
  // Le pin est muté en place sur l'objet partagé (voir store.ts::togglePin)
  // -- ce composant doit s'abonner à uiTick pour re-render au bon moment.
  useCosmos((s) => s.uiTick)

  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(planet.title)
  const [draftContent, setDraftContent] = useState(planet.content)

  const startEditing = () => {
    setDraftTitle(planet.title)
    setDraftContent(planet.content)
    setEditing(true)
  }
  const cancelEditing = () => setEditing(false)
  const saveEditing = async () => {
    const ok = await updatePlanet(planet.id, { title: draftTitle, content: draftContent })
    if (ok) setEditing(false)
  }

  const category = categoryById.get(planet.category_id) ?? null
  const session = sessionById.get(planet.session_id) ?? null
  const connections = planet.metadata.connections
    .map((id) => planetById.get(id))
    .filter((p): p is PlanetNode => p !== undefined)

  // Pulsation douce tant que la surbrillance (saut depuis la recherche) est
  // active — dérivée de l'état du store, avec un re-rendu à l'échéance pour
  // l'arrêter net (le highlight peut rester en place dans le store).
  const highlightActive = highlight !== null && highlight.planetId === planet.id
  const [, tick] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    if (!highlightActive || highlight === null) return
    const remaining = highlight.until - Date.now()
    if (remaining <= 0) return
    const t = setTimeout(tick, remaining)
    return () => clearTimeout(t)
  }, [highlightActive, highlight])
  const pulsing = highlightActive && highlight !== null && highlight.until > Date.now()

  return (
    <>
      <header className="shrink-0 px-5 pb-3 pt-3 md:pt-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={cn('mt-[9px] h-2.5 w-2.5 shrink-0 rounded-full', pulsing && 'animate-pulse')}
            style={{
              backgroundColor: planet.color,
              boxShadow: pulsing ? `0 0 12px ${planet.color}` : undefined,
            }}
          />
          <div className="min-w-0 flex-1">
            {editing ? (
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Titre"
                className="w-full rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1.5 font-display text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : (
              <h2 className="font-display text-lg leading-snug text-foreground">{planet.title}</h2>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className="border-white/10 px-1.5 text-[10px] font-normal text-muted-foreground"
              >
                {NODE_TYPES[planet.node_type].label}
              </Badge>
              {typeof planet.metadata.statut === 'string' && planet.metadata.statut.length > 0 && (
                <Badge
                  variant="outline"
                  className="border-white/10 px-1.5 text-[10px] font-normal text-muted-foreground"
                >
                  {planet.metadata.statut}
                </Badge>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => togglePin(planet.id)}
            aria-label={planet.metadata.pinned ? 'Désépingler' : 'Épingler ce souvenir'}
            aria-pressed={Boolean(planet.metadata.pinned)}
            title={planet.metadata.pinned ? 'Désépingler' : "Épingler — important pour moi, indépendamment de la catégorie"}
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition hover:bg-white/[0.08]',
              planet.metadata.pinned ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {planet.metadata.pinned ? (
              <Pin size={16} strokeWidth={1.75} fill="currentColor" aria-hidden="true" />
            ) : (
              <Pin size={16} strokeWidth={1.5} aria-hidden="true" />
            )}
          </button>
          <CloseButton />
        </div>
      </header>

      <div className="cosmos-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {/* Méta */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 border-t border-white/[0.06] pt-4">
          <Meta label="Catégorie">
            {category ? (
              <button
                type="button"
                onClick={() => focusCategory(category.id)}
                className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] py-0.5 pl-2 pr-2.5 text-xs text-foreground/90 transition hover:bg-white/[0.09]"
                title={`Explorer le système ${category.name}`}
              >
                <span
                  className="text-[11px] leading-none"
                  style={{ color: category.color }}
                  aria-hidden="true"
                >
                  ✦
                </span>
                <span className="truncate">{category.name}</span>
              </button>
            ) : (
              '—'
            )}
          </Meta>
          <Meta label="Session">{session?.label ?? '—'}</Meta>
          <Meta label="Créée">{formatDate(planet.created_at)}</Meta>
          <Meta label="Modifiée">{formatRelative(planet.updated_at)}</Meta>
          <Meta label="Identifiant">
            <span className="font-mono text-[11px] text-muted-foreground">{shortId(planet.id)}</span>
          </Meta>
          <Meta label="Lecture">{readingTime(planet.content)}</Meta>
          <Meta label="Importance">
            <span className="flex h-4 items-center">
              <ImportanceDots importance={planet.metadata.importance} color={planet.color} />
            </span>
          </Meta>
        </dl>

        {/* Connexions */}
        {connections.length > 0 && (
          <section className="mt-5 border-t border-white/[0.06] pt-4">
            <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">Connexions</h3>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {connections.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => jumpToPlanet(p.id)}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] py-1 pl-2 pr-2.5 text-xs text-foreground/90 transition hover:bg-white/[0.09]"
                  title={p.title}
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: p.color }}
                    aria-hidden="true"
                  />
                  <span className="max-w-[180px] truncate">{p.title}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Contenu */}
        <section className="mt-5 border-t border-white/[0.06] pt-4">
          <div className="mb-2.5 flex items-center justify-between">
            <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">Contenu</h3>
            {!editing && (
              <TertiaryButton onClick={startEditing}>
                <Pencil size={12} strokeWidth={1.75} aria-hidden="true" />
                Modifier
              </TertiaryButton>
            )}
          </div>
          {editing ? (
            <div className="flex flex-col gap-2.5">
              <textarea
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                rows={10}
                placeholder="Contenu"
                className="cosmos-scroll w-full resize-y rounded-xl border border-white/10 bg-white/[0.04] p-3 font-sans text-sm leading-relaxed text-foreground/90 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="text-[10px] text-muted-foreground/70">
                Modifier le texte ici ne recalcule pas les liens sémantiques automatiquement — relance un
                <code className="mx-1 rounded bg-white/[0.08] px-1 py-0.5">cosmos_reindex</code>
                depuis Claude si besoin.
              </p>
              <div className="flex justify-end gap-2">
                <TertiaryButton onClick={cancelEditing} disabled={mutating}>
                  Annuler
                </TertiaryButton>
                <button
                  type="button"
                  onClick={saveEditing}
                  disabled={mutating || !draftContent.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
                >
                  {mutating ? (
                    <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Check size={12} strokeWidth={2} aria-hidden="true" />
                  )}
                  Enregistrer
                </button>
              </div>
            </div>
          ) : (
            <Prose content={planet.content} />
          )}
        </section>
      </div>

      <footer className="shrink-0 border-t border-white/[0.06] p-2.5">
        <RecenterButton label="Recentrer sur cette planète" onClick={() => focusPlanet(planet.id)} />
      </footer>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Mode catégorie (étoile)                                             */
/* ------------------------------------------------------------------ */

function CategoryDetail({ category }: { category: CategoryNode }) {
  const focusCategory = useCosmos((s) => s.focusCategory)
  const focusPlanet = useCosmos((s) => s.focusPlanet)
  const renameCategory = useCosmos((s) => s.renameCategory)
  const setCategoryColor = useCosmos((s) => s.setCategoryColor)
  const mergeCategories = useCosmos((s) => s.mergeCategories)
  const createPlanet = useCosmos((s) => s.createPlanet)
  const mutating = useCosmos((s) => s.mutating)

  const [tools, setTools] = useState(false)
  const [nameDraft, setNameDraft] = useState(category.name)
  const [mergeTarget, setMergeTarget] = useState('')
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')

  // Reset des brouillons quand on change de catégorie sélectionnée.
  useEffect(() => {
    setNameDraft(category.name)
    setTools(false)
    setMergeTarget('')
    setAdding(false)
    setNewTitle('')
    setNewContent('')
  }, [category.id])

  const planets = planetsByCategory.get(category.id) ?? []
  const sessionCount = new Set(planets.map((p) => p.session_id)).size
  const otherCategories = dataset.categories.filter((c) => c.id !== category.id)

  const submitRename = async () => {
    const trimmed = nameDraft.trim()
    if (!trimmed || trimmed === category.name) return
    await renameCategory(category.id, trimmed)
  }
  const submitMerge = async () => {
    if (!mergeTarget) return
    await mergeCategories(category.id, mergeTarget)
    setMergeTarget('')
  }
  const submitCreate = async () => {
    if (!newContent.trim()) return
    const id = await createPlanet({ nodeType: category.id, title: newTitle, content: newContent })
    if (id) {
      setNewTitle('')
      setNewContent('')
      setAdding(false)
    }
  }

  return (
    <>
      <header className="shrink-0 px-5 pb-3 pt-3.5 md:pt-5">
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 shrink-0 text-3xl leading-none"
            style={{ color: category.color }}
            aria-hidden="true"
          >
            ✦
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl leading-tight text-foreground">{category.name}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{category.metadata.domain}</p>
          </div>
          <button
            type="button"
            onClick={() => setTools((v) => !v)}
            aria-label="Personnaliser cette catégorie"
            aria-pressed={tools}
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition hover:bg-white/[0.08]',
              tools ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Pencil size={15} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <CloseButton />
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{category.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span className="tabular-nums">
            {planets.length} planète{planets.length > 1 ? 's' : ''}
          </span>
          <span className="text-muted-foreground/40" aria-hidden="true">
            ·
          </span>
          <span className="tabular-nums">
            {sessionCount} session{sessionCount > 1 ? 's' : ''}
          </span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
            {shortId(category.id)}
          </span>
        </div>

        {tools && (
          <div className="mt-3.5 flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                Renommer
              </label>
              <div className="mt-1.5 flex gap-1.5">
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button
                  type="button"
                  onClick={submitRename}
                  disabled={mutating || !nameDraft.trim() || nameDraft.trim() === category.name}
                  className="shrink-0 rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-40"
                >
                  OK
                </button>
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                Couleur
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="color"
                  value={category.color}
                  onChange={(e) => setCategoryColor(category.id, e.target.value)}
                  disabled={mutating}
                  className="h-8 w-10 cursor-pointer rounded-lg border border-white/10 bg-transparent p-0.5"
                  aria-label="Couleur de la catégorie"
                />
                <span className="font-mono text-[11px] text-muted-foreground">{category.color}</span>
              </div>
            </div>

            {otherCategories.length > 0 && (
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                  Fusionner dans…
                </label>
                <div className="mt-1.5 flex gap-1.5">
                  <select
                    value={mergeTarget}
                    onChange={(e) => setMergeTarget(e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">Choisir une catégorie cible…</option>
                    {otherCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={submitMerge}
                    disabled={mutating || !mergeTarget}
                    className="shrink-0 rounded-lg border border-white/15 px-2.5 text-xs text-foreground/90 transition hover:bg-white/[0.08] disabled:opacity-40"
                  >
                    Fusionner
                  </button>
                </div>
                <p className="mt-1.5 text-[10px] text-muted-foreground/70">
                  Irréversible — « {category.name} » disparaît, ses planètes rejoignent la cible.
                </p>
              </div>
            )}
          </div>
        )}
      </header>

      <div className="cosmos-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="flex items-center justify-between px-2.5 pt-2">
          <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Planètes du système
          </h3>
          <TertiaryButton onClick={() => setAdding((v) => !v)} className="px-1.5 py-1">
            <Plus size={12} strokeWidth={2} aria-hidden="true" />
            Ajouter
          </TertiaryButton>
        </div>

        {adding && (
          <div className="mx-2.5 mt-2 flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Titre (optionnel)"
              className="rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              rows={4}
              placeholder="Contenu…"
              className="cosmos-scroll resize-y rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex justify-end gap-2">
              <TertiaryButton onClick={() => setAdding(false)}>
                Annuler
              </TertiaryButton>
              <button
                type="button"
                onClick={submitCreate}
                disabled={mutating || !newContent.trim()}
                className="rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-40"
              >
                Créer
              </button>
            </div>
          </div>
        )}

        <div className="mt-1">
          {planets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => focusPlanet(p.id)}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-white/[0.05]"
              title={p.title}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: p.color }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/90">{p.title}</span>
              {p.metadata.pinned && (
                <Pin size={11} strokeWidth={2} fill="currentColor" className="shrink-0 text-primary" aria-hidden="true" />
              )}
              <Badge
                variant="outline"
                className="shrink-0 border-white/10 px-1.5 text-[10px] font-normal text-muted-foreground"
              >
                {NODE_TYPES[p.node_type].label}
              </Badge>
              <ImportanceDots
                importance={p.metadata.importance}
                color={p.color}
                size="sm"
                className="shrink-0"
              />
            </button>
          ))}
        </div>
      </div>

      <footer className="shrink-0 border-t border-white/[0.06] p-2.5">
        <RecenterButton label="Recentrer le système" onClick={() => focusCategory(category.id)} />
      </footer>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Rendu markdown léger                                                */
/* ------------------------------------------------------------------ */

/**
 * Prose minimale : blocs séparés par lignes vides ; `## …` → h2 ;
 * bloc de lignes `- ` → liste ; `**gras**` → strong ; sinon paragraphe.
 */
function Prose({ content }: { content: string }) {
  const blocks = content
    .split(/\n\n+/)
    .map((b) => b.trim())
    .filter(Boolean)

  return (
    <div className="cosmos-prose">
      {blocks.map((block, i) => {
        if (block.startsWith('## ')) {
          return <h2 key={i}>{renderInline(block.slice(3).trim())}</h2>
        }
        const lines = block.split('\n').map((l) => l.trim())
        if (lines.length > 0 && lines.every((l) => l.startsWith('- '))) {
          return (
            <ul key={i} className="m-0 list-none p-0">
              {lines.map((l, j) => (
                <li key={j}>{renderInline(l.slice(2))}</li>
              ))}
            </ul>
          )
        }
        return <p key={i}>{renderInline(block)}</p>
      })}
    </div>
  )
}

function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  if (parts.length === 1) return text
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    return <Fragment key={i}>{part}</Fragment>
  })
}
