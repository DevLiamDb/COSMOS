/**
 * COSMOS — Générateur pseudo-aléatoire déterministe (mulberry32).
 * Un même seed produit toujours le même univers : les vues 2D et 3D,
 * comme les rechargements de page, voient exactement les mêmes données.
 */

export interface Rng {
  /** Flottant dans [0, 1). */
  next(): number
  /** Entier dans [min, max] inclus. */
  int(min: number, max: number): number
  /** Flottant dans [min, max). */
  float(min: number, max: number): number
  /** Vrai avec la probabilité p. */
  chance(p: number): boolean
  /** Élément aléatoire d'un tableau (non vide). */
  pick<T>(arr: readonly T[]): T
  /** k éléments distincts d'un tableau (min(k, arr.length)). */
  sample<T>(arr: readonly T[], k: number): T[]
  /** Mélange de Fisher-Yates (nouveau tableau). */
  shuffle<T>(arr: readonly T[]): T[]
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  const next = () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const rng: Rng = {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    float: (min, max) => next() * (max - min) + min,
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    sample: <T,>(arr: readonly T[], k: number): T[] => {
      const copy = [...arr]
      const out: T[] = []
      const n = Math.min(k, copy.length)
      for (let i = 0; i < n; i++) {
        const j = Math.floor(next() * copy.length)
        out.push(copy.splice(j, 1)[0])
      }
      return out
    },
    shuffle: (arr) => {
      const copy = [...arr]
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
      }
      return copy
    },
  }
  return rng
}

/** Hash simple et stable d'une chaîne (pour dériver des seeds par nom). */
export function hashString(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
