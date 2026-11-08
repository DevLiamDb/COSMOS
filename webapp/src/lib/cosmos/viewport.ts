/**
 * COSMOS — Bus de viewport (mini-carte)
 * =====================================
 * Pont léger entre les moteurs de rendu (2D/3D) et la mini-carte, SANS
 * re-render React : les moteurs publient l'état de leur caméra à chaque
 * frame (simple mutation d'objet), la mini-carte le lit dans sa propre
 * boucle rAF.
 *
 * Le bus reflète TOUJOURS le moteur ACTIF (le dernier à avoir publié).
 * `at` (performance.now()) permet d'ignorer un état périmé — par exemple
 * juste après un changement de vue 2D ↔ 3D.
 */

export interface ViewportState {
  /** Centre de la vue en unités monde (3D : x = target.x, y = target.z). */
  x: number
  y: number
  /** Pixels CSS par unité monde (3D : hauteur du canvas / hauteur visible). */
  zoom: number
  /** Dimensions du canvas actif (px CSS). */
  w: number
  h: number
  /** Vue ayant publié en dernier. */
  mode: '2d' | '3d'
  /** performance.now() de la dernière publication (0 = jamais). */
  at: number
}

/** État muté en place — ne JAMAIS remplacer l'objet (identité stable). */
export const viewport: ViewportState = { x: 0, y: 0, zoom: 1, w: 1, h: 1, mode: '2d', at: 0 }

/** Publie un rafraîchissement (appelé par le moteur actif, chaque frame). */
export function publishViewport(v: {
  x: number
  y: number
  zoom: number
  w: number
  h: number
  mode: '2d' | '3d'
}): void {
  viewport.x = v.x
  viewport.y = v.y
  viewport.zoom = v.zoom
  viewport.w = v.w
  viewport.h = v.h
  viewport.mode = v.mode
  viewport.at = performance.now()
}
