/**
 * COSMOS — Palette des couleurs de catégories (étoiles).
 * Teintes choisies pour être lisibles et distinctes sur fond quasi noir,
 * avec une saturation maîtrisée (pas de néons criards).
 */

/** hsl → hex */
export function hsl(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace('#', '')
  return {
    r: parseInt(m.slice(0, 2), 16),
    g: parseInt(m.slice(2, 4), 16),
    b: parseInt(m.slice(4, 6), 16),
  }
}

/** Couleur rgba() depuis un hex, avec alpha. */
export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Éclaircit / assombrit un hex (amount ∈ [-1, 1]). */
export function shade(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex)
  const f = (v: number) => {
    const t = amount > 0 ? v + (255 - v) * amount : v * (1 + amount)
    return Math.round(Math.max(0, Math.min(255, t)))
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(r)}${f(g)}${f(b)}`
}

/** Variation de teinte/luminosité autour d'une couleur (pour les planètes). */
export function hueShift(hex: string, dh: number, dl = 0): string {
  const { r, g, b } = hexToRgb(hex)
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (d !== 0) {
    const rn = r / 255
    const gn = g / 255
    const bn = b / 255
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return hsl((h + dh + 360) % 360, Math.min(100, Math.max(0, s * 100)), Math.min(90, Math.max(8, (l + dl) * 100)))
}

/**
 * Palette des 24 catégories de démonstration — teintes réparties sur tout le
 * spectre pour que chaque système solaire soit immédiatement identifiable.
 */
export const CATEGORY_PALETTE: string[] = [
  hsl(38, 78, 66), // ambre
  hsl(22, 82, 64), // cuivre
  hsl(350, 72, 66), // rose framboise
  hsl(318, 62, 68), // magenta doux
  hsl(286, 58, 68), // violet orchidée
  hsl(262, 55, 68), // lavande
  hsl(238, 52, 68), // bleu nuit (donnée, pas un accent UI)
  hsl(210, 60, 66), // azur
  hsl(190, 62, 62), // cyan pâle
  hsl(172, 52, 58), // turquoise
  hsl(155, 48, 58), // menthe
  hsl(140, 46, 58), // émeraude
  hsl(118, 40, 60), // vert feuille
  hsl(96, 42, 62), // vert lime
  hsl(78, 44, 60), // olive clair
  hsl(58, 52, 64), // jaune sable
  hsl(48, 70, 66), // or
  hsl(12, 74, 64), // terracotta
  hsl(335, 64, 70), // corail
  hsl(305, 52, 70), // fuchsia pastel
  hsl(272, 48, 70), // lilas
  hsl(196, 48, 64), // bleu glacier
  hsl(163, 42, 62), // vert d'eau
  hsl(30, 62, 62), // caramel
]
