/**
 * COSMOS — Utilitaires de formatage (dates, identifiants, textes).
 */

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
const dateFmtLong = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso))
}

export function formatDateLong(iso: string): string {
  return dateFmtLong.format(new Date(iso))
}

/** « il y a 3 mois », « hier »… — relatif au présent. */
export function formatRelative(iso: string, now = Date.now()): string {
  const d = new Date(iso).getTime()
  const days = Math.round((now - d) / 86_400_000)
  if (days <= 0) return "aujourd’hui"
  if (days === 1) return 'hier'
  if (days < 7) return `il y a ${days} jours`
  if (days < 31) return `il y a ${Math.round(days / 7)} sem.`
  if (days < 365) return `il y a ${Math.round(days / 30)} mois`
  return `il y a ${(days / 365).toFixed(1).replace('.0', '')} an(s)`
}

/**
 * Relatif FIN (minute/heure) — pour l'indicateur de fraîcheur
 * « Dernière synchro : il y a 5 min ».
 */
export function formatRelativeFine(iso: string, now = Date.now()): string {
  const d = new Date(iso).getTime()
  if (!Number.isFinite(d)) return '—'
  const s = Math.max(0, Math.floor((now - d) / 1000))
  if (s < 45) return "à l’instant"
  const m = Math.floor(s / 60)
  if (m < 60) return `il y a ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `il y a ${h} h`
  return formatRelative(iso, now)
}

/** Temps de lecture estimé (≈ 220 mots/min). */
export function readingTime(content: string): string {
  const words = content.split(/\s+/).filter(Boolean).length
  const min = Math.max(1, Math.round(words / 220))
  return `${min} min de lecture`
}

/** Identifiant technique raccourci pour affichage : p-ia-017 → ia-017. */
export function shortId(id: string): string {
  if (id.startsWith('p-')) return id.slice(2)
  if (id.startsWith('cat-')) return id.slice(4)
  return id
}

/** Premier paragraphe « propre » d'un contenu, pour les aperçus. */
export function firstPlainParagraph(content: string): string {
  const para = content
    .split(/\n\n+/)
    .map((p) => p.replace(/^#+\s*/m, '').replace(/\*\*/g, '').replace(/^-\s*/gm, '').replace(/\s+/g, ' ').trim())
    .find((p) => p.length > 30)
  return para ?? content.replace(/\s+/g, ' ').slice(0, 140)
}
