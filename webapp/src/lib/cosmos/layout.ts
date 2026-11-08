/**
 * COSMOS — Moteur de mise en orbite
 * ==================================
 * Transforme un dataset en univers navigable :
 *  - chaque catégorie devient un système solaire (étoile + orbites) ;
 *  - les planètes reçoivent une orbite, une vitesse angulaire, une taille ;
 *  - les systèmes sont répartis dans l'espace (spirale dorée + test de
 *    non-collision) afin qu'aucun chevauchement ne crée d'ambiguïté.
 *
 * Le layout est déterministe : les vues 2D et 3D partagent exactement la
 * même géographie (2D : x,y  —  3D : x→x, y→z, + légère élévation y).
 */

import type { CosmosDataset, CosmosLayout, PlanetSlot, SystemLayout } from './types'
import { hashString, mulberry32 } from './rng'

/** Angle d'or (radians) — répartition uniforme sur la spirale. */
const GOLDEN_ANGLE = 2.399963229728653

/** Marge minimale entre deux systèmes (unités monde). */
const SYSTEM_MARGIN = 110

/** Pas d'exploration de la spirale de placement. */
const SPIRAL_STEP = 46

export function buildLayout(dataset: CosmosDataset): CosmosLayout {
  // Univers vide : pas de systèmes, mais des bornes finies et centrées pour
  // que les caméras (fitZoom, cadrage global) restent bien définies.
  if (dataset.categories.length === 0) {
    return { systems: [], bounds: { minX: -900, minY: -900, maxX: 900, maxY: 900 } }
  }

  const planetsByCat = new Map<string, typeof dataset.planets>()
  for (const p of dataset.planets) {
    const list = planetsByCat.get(p.category_id) ?? []
    list.push(p)
    planetsByCat.set(p.category_id, list)
  }

  // 1. Construction des systèmes (orbites) — déterministe par catégorie.
  const systems: SystemLayout[] = dataset.categories.map((cat) => {
    const rng = mulberry32(hashString(cat.id + '::orbits'))
    const planets = (planetsByCat.get(cat.id) ?? []).slice()
    const n = planets.length

    // Taille de l'étoile : croît avec le nombre de planètes, bornée.
    // Une catégorie prioritaire (chargée automatiquement par COSMOS réel,
    // voir cosmos_priority_context côté serveur) a une étoile visiblement
    // plus grande — même logique que le halo renforcé dans les moteurs 2D/3D.
    const starSize = (13 + Math.sqrt(n) * 1.7) * (cat.priority ? 1.4 : 1)

    // Zone centrale sans orbite, puis anneaux réguliers.
    const coreRadius = starSize + 16 + Math.sqrt(n) * 1.2
    const gap = n > 34 ? 15 : n > 16 ? 17 : 19

    // Ordre des orbites : on mélange puis on trie par taille décroissante
    // pour éviter l'effet « grosses planètes au centre » systématique —
    // mais avec un léger tri par importance pour garder du sens.
    const shuffled = rng.shuffle(planets)
    shuffled.sort((a, b) => b.metadata.importance - a.metadata.importance || rng.next() - 0.5)

    const slots: PlanetSlot[] = shuffled.map((p, i) => {
      const orbitRadius = coreRadius + 14 + i * gap + rng.float(-2.5, 2.5)
      // Vitesse kepler-like : plus l'orbite est large, plus elle est lente.
      const speed = (0.85 / Math.pow(orbitRadius, 0.62)) * rng.float(0.75, 1.25)
      const dir = rng.chance(0.88) ? 1 : -1
      // Angle initial : angle d'or + bruit → répartition homogène.
      const angle0 = i * GOLDEN_ANGLE + rng.float(0, Math.PI / 3)
      return {
        planetId: p.id,
        orbitRadius,
        angle0,
        angularSpeed: speed * dir,
        size: planetSize(p.content.length, p.metadata.importance, rng),
        tiltX: rng.float(-0.28, 0.28),
        tiltZ: rng.float(-0.28, 0.28),
      }
    })

    const lastOrbit = slots.length > 0 ? slots[slots.length - 1].orbitRadius : coreRadius
    return {
      categoryId: cat.id,
      x: 0,
      y: 0,
      radius: lastOrbit + 26,
      coreRadius,
      starSize,
      slots: slots.sort((a, b) => a.orbitRadius - b.orbitRadius),
    }
  })

  // 2. Placement des systèmes : du plus grand au plus petit, sur une spirale
  //    dorée, avec rejet des positions trop proches d'un système existant.
  const ordered = [...systems].sort((a, b) => b.radius - a.radius)
  const placed: SystemLayout[] = []

  for (const sys of ordered) {
    let done = false
    for (let k = 0; k < 4000 && !done; k++) {
      const dist = k === 0 ? 0 : 60 + k * SPIRAL_STEP
      const angle = k * GOLDEN_ANGLE
      const x = Math.cos(angle) * dist
      const y = Math.sin(angle) * dist
      let ok = true
      for (const q of placed) {
        const minDist = sys.radius + q.radius + SYSTEM_MARGIN + 0.16 * (sys.radius + q.radius)
        const dx = x - q.x
        const dy = y - q.y
        if (dx * dx + dy * dy < minDist * minDist) {
          ok = false
          break
        }
      }
      if (ok) {
        sys.x = x
        sys.y = y
        placed.push(sys)
        done = true
      }
    }
    if (!done) {
      // Filet de sécurité (ne devrait jamais se produire avec 24 systèmes).
      sys.x = placed.length * 900
      sys.y = 0
      placed.push(sys)
    }
  }

  // 3. Recentrage du cosmos sur son centre de masse.
  let cx = 0
  let cy = 0
  for (const s of systems) {
    cx += s.x
    cy += s.y
  }
  cx /= systems.length
  cy /= systems.length
  for (const s of systems) {
    s.x -= cx
    s.y -= cy
  }

  // 4. Bornes globales.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const s of systems) {
    minX = Math.min(minX, s.x - s.radius)
    maxX = Math.max(maxX, s.x + s.radius)
    minY = Math.min(minY, s.y - s.radius)
    maxY = Math.max(maxY, s.y + s.radius)
  }

  return { systems, bounds: { minX, minY, maxX, maxY } }
}

/** Taille visuelle d'une planète (rayon en unités monde). */
function planetSize(contentLength: number, importance: number, rng: { float(a: number, b: number): number }): number {
  const byText = Math.sqrt(contentLength) / 26
  const byImportance = importance * 0.55
  return Math.min(8.5, Math.max(2.4, 1.5 + byText * 0.9 + byImportance * 0.6 + rng.float(-0.3, 0.3)))
}

/** Zoom (2D) permettant de cadrer un rectangle monde dans un viewport. */
export function fitZoom(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  viewW: number,
  viewH: number,
  padding = 1.15,
): number {
  const w = Math.max(1, bounds.maxX - bounds.minX)
  const h = Math.max(1, bounds.maxY - bounds.minY)
  return Math.min(viewW / w, viewH / h) / padding
}
