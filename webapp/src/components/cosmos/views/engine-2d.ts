/**
 * COSMOS — Moteur de rendu 2D (Canvas)
 * =====================================
 * Représente l'univers en vue « carte du ciel » : chaque catégorie est une
 * étoile ✦ au centre de son système solaire, chaque donnée une planète en
 * orbite. Classe pure TypeScript (aucun React) pilotée par une boucle
 * `requestAnimationFrame` interne.
 *
 * API publique :
 *   new Engine2D(container)  — monte le canvas plein container
 *   setActive(active)        — active/suspend update+render (la boucle vit)
 *   destroy()                — libère tout (RAF, observers, listeners, store)
 *
 * Interactions : molette (zoom au curseur), drag (pan + inertie), pinch
 * mobile (zoom à deux doigts), tap (sélection étoile/planète), survol.
 *
 * Univers vide : si le moteur est construit sans système (dataset vide), il
 * rend une « nébuleuse primordiale » — poussières dorées en voyages
 * interpolés, anneaux d'orbites fantômes, ondulations et étoile ✦ fantôme,
 * avec une lente dérive caméra cinématique tant que l'utilisateur n'a pas
 * interagi.
 *
 * Perf : sprites d'étoiles et vignette pré-rendus hors écran, culling par
 * système, aucune allocation ni `shadowBlur` dans les chemins chauds.
 */

import { categoryById, cosmosStore, layout, planetById } from '@/lib/cosmos/store'
import type { CameraCommand } from '@/lib/cosmos/store'
import { fitZoom } from '@/lib/cosmos/layout'
import { rgba } from '@/lib/cosmos/colors'
import { hashString, mulberry32 } from '@/lib/cosmos/rng'
import type { Rng } from '@/lib/cosmos/rng'
import { planetWorldPosition } from '@/lib/cosmos/types'
import type { PlanetSlot, SystemLayout } from '@/lib/cosmos/types'

/* ------------------------------------------------------------------ */
/* Constantes de rendu et d'interaction                                */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2
/** Fond du vide. */
const BG_COLOR = '#05060a'
/** Zoom maximal (pixels par unité monde). */
const MAX_ZOOM = 9
/** Sensibilité molette (zoom exponentiel au curseur). */
const WHEEL_SENSITIVITY = 0.00125
/** Raideur du lissage caméra → cible (par seconde). */
const CAM_SMOOTH = 5.5
/** Raideur du fondu d'atténuation des systèmes non sélectionnés. */
const DIM_SMOOTH = 4
/** Atténuation cible d'un système non sélectionné. */
const DIM_FADED = 0.26
/** Sous ce zoom, on ne trace plus les orbites (trop petites). */
const MIN_ORBIT_ZOOM = 0.13
/** Seuil de zoom pour les labels d'étoiles (fondu progressif). */
const STAR_LABEL_ZOOM = 0.15
/** Seuil de zoom pour les labels de planètes (système sélectionné/hover). */
const PLANET_LABEL_ZOOM = 1.25
/** Taille (px) des sprites d'étoiles ✦ pré-rendus. */
const STAR_SPRITE_SIZE = 112
/** Nombre de points du champ d'étoiles parallaxe. */
const STARFIELD_COUNT = 420
/** Taille du « tuile » virtuelle du champ d'étoiles (effet infini). */
const STARFIELD_TILE = 2048
/** Couleur du texte des labels. */
const LABEL_TEXT = '#ECEAE5'
/** Couleur de l'ombre des labels (double draw). */
const LABEL_SHADOW = '#000000'
/** Facteur de zoom de départ de l'intro (effet d'ouverture). */
const INTRO_ZOOM_FACTOR = 1.5
/** Décalage de départ de l'intro (fraction du viewport monde). */
const INTRO_OFFSET = 0.12

/** Couleur par défaut si une catégorie est introuvable (ne devrait pas arriver). */
const FALLBACK_COLOR = '#8fa3c8'

/* ------------------------------------------------------------------ */
/* Mode « nébuleuse primordiale » (univers vide)                       */
/* ------------------------------------------------------------------ */

/** Seed du générateur déterministe du décor ambient. */
const AMBIENT_SEED = 777
/** Nombre de poussières primordiales. */
const AMBIENT_MOTE_COUNT = 110
/** Rayon de dispersion des poussières (unités monde ; univers vide ±900). */
const AMBIENT_MOTE_SPREAD = 850
/** Rayon du dégagement central autour de l'étoile fantôme. */
const AMBIENT_MOTE_CLEARING = 110
/** Durées min/max d'un voyage de poussière (s). */
const AMBIENT_JOURNEY_MIN = 7
const AMBIENT_JOURNEY_MAX = 16
/** Styles de remplissage des poussières : or chaud, blanc doux, braise. */
const AMBIENT_MOTE_FILLS = [
  'rgba(232, 196, 118, 1)',
  'rgba(216, 221, 232, 1)',
  'rgba(200, 138, 90, 1)',
]
/** Anneaux d'orbites fantômes : rayon monde, période (s) et phase de
 *  respiration, style de trait (or / blanc doux). */
const AMBIENT_RINGS: ReadonlyArray<{
  radius: number
  period: number
  phase: number
  style: string
}> = [
  { radius: 130, period: 6.4, phase: 0.0, style: 'rgba(232, 196, 118, 1)' },
  { radius: 220, period: 7.7, phase: 2.1, style: 'rgba(216, 221, 232, 1)' },
  { radius: 330, period: 8.9, phase: 4.2, style: 'rgba(232, 196, 118, 1)' },
]
/** Ondulations : période d'émission (s), durée de vie (s), rayon final (monde). */
const AMBIENT_RIPPLE_PERIOD = 6.5
const AMBIENT_RIPPLE_DURATION = 5.5
const AMBIENT_RIPPLE_MAX_R = 520
/** Dérive caméra Lissajous : amplitudes (unités monde) et pulsations (rad/s). */
const AMBIENT_DRIFT_AX = 82
const AMBIENT_DRIFT_AY = 74
const AMBIENT_DRIFT_WX = TAU / 40
const AMBIENT_DRIFT_WY = TAU / 55
/** Couleur de l'étoile fantôme centrale. */
const GHOST_GOLD = '#d9b36a'

/* ------------------------------------------------------------------ */
/* Types locaux                                                        */
/* ------------------------------------------------------------------ */

/** Un point du champ d'étoiles parallaxe (espace « tuile »). */
interface StarPoint {
  x: number
  y: number
  size: number
  alpha: number
  /** Couche proche (parallaxe 0.25) vs lointaine (0.12). */
  near: boolean
}

/** Informations de rendu pré-calculées pour un système. */
interface SysInfo {
  sys: SystemLayout
  /** Couleur de la catégorie (hex). */
  color: string
  /** Nom de l'étoile. */
  name: string
  /** Libellé « N planètes » (pré-calculé, aucune allocation par frame). */
  countLabel: string
  /** Phase de scintillement (aléatoire déterministe par système). */
  phase: number
}

type HitKind = 'none' | 'planet' | 'star'

/** Résultat de hit-testing — objet réutilisé, ne pas conserver la référence. */
interface HitResult {
  kind: HitKind
  id: string | null
}

/** Position écran d'un pointeur actif (px, repère canvas). */
interface PointerPt {
  x: number
  y: number
}

/** Poussière primordiale : un voyage interpolé de (x, y) vers (tx, ty),
 *  renouvelé à l'arrivée — jamais de téléportation, jamais de bruit. */
interface AmbientMote {
  /** Départ du voyage courant (unités monde). */
  x: number
  y: number
  /** Cible du voyage courant (unités monde). */
  tx: number
  ty: number
  /** Durée du voyage (s). */
  duration: number
  /** Début du voyage (s, base performance.now()/1000). */
  startTime: number
  /** Taille (unités monde → rayon écran = max(0.8, size × zoom)). */
  size: number
  /** Opacité de base (0.25 – 0.7). */
  baseAlpha: number
  /** Phase de scintillement (rad). */
  twinklePhase: number
  /** Vitesse de scintillement (rad/s). */
  twinkleSpeed: number
  /** Index de couleur : 0 = or, 1 = blanc doux, 2 = braise. */
  colorIndex: number
  /** Flux pseudo-aléatoire propre (retargets sans aucune allocation). */
  seed: number
}

const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v)

/** Interpolation douce (accélération puis décélération) — voyages de poussières. */
const easeInOutCubic = (p: number): number =>
  p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2

/** Décélération franche — expansion des ondulations. */
const easeOutCubic = (p: number): number => 1 - Math.pow(1 - p, 3)

/** Point uniforme dans la couronne [inner, outer] (dégagement central). */
const ambientAnnulusPoint = (rng: Rng, inner: number, outer: number): { x: number; y: number } => {
  // Racine carrée : densité uniforme dans la couronne, pas d'amas central.
  const r = Math.sqrt(rng.float(inner * inner, outer * outer))
  const a = rng.float(0, TAU)
  return { x: Math.cos(a) * r, y: Math.sin(a) * r }
}

/* ------------------------------------------------------------------ */
/* Classe Engine2D                                                     */
/* ------------------------------------------------------------------ */

export class Engine2D {
  /* ============ DOM / canvas ============ */

  private container: HTMLElement
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private ro: ResizeObserver | null = null
  /** rect du canvas, rafraîchie au resize et à chaque pointerdown. */
  private rect = { left: 0, top: 0 }
  private width = 1
  private height = 1
  private dpr = 1
  private destroyed = false
  private active = false

  /* ============ Boucle ============ */

  private rafId = 0
  private lastFrameTime = 0

  /* ============ Caméra ============ */

  /** État courant (position monde du centre de la vue + pixels/unité monde). */
  private cam = { x: 0, y: 0, zoom: 1 }
  /** Cible vers laquelle la caméra glisse en douceur. */
  private target = { x: 0, y: 0, zoom: 1 }
  /** Borne basse de zoom = cadrage global × 0.5 (recalculée au resize). */
  private minZoom = 0.02
  /** Planète suivie par la caméra (commande 'planet'). */
  private followId: string | null = null
  /** Dernier nonce de commande caméra traité. */
  private lastNonce = 0
  /** Vitesse de pan pour l'inertie (px/s, repère écran). */
  private vel = { x: 0, y: 0 }
  private unsub: () => void

  /* ============ Interactions pointeur ============ */

  private pointers = new Map<number, PointerPt>()
  private gesture = {
    active: false,
    dragging: false,
    moved: 0,
    downT: 0,
    lastX: 0,
    lastY: 0,
    lastT: 0,
  }
  private pinch = { active: false, startDist: 1, startZoom: 1, worldX: 0, worldY: 0 }
  /** Vrai si le curseur survole une entité cliquable. */
  private hoverFound = false

  /* ============ Rendu pré-calculé ============ */

  /** Sprites ✦ par catégorie (halo + glyphe + cœur blanc). */
  private sprites = new Map<string, HTMLCanvasElement>()
  /** Vignette radiale pré-rendue (reconstruite au resize). */
  private vignette: HTMLCanvasElement | null = null
  /** Champ d'étoiles parallaxe (déterministe, seed 1234). */
  private stars: StarPoint[] = []
  /** Atténuation lissée par système (categoryId → dim). */
  private dimMap = new Map<string, number>()
  /** Infos de rendu parallèles à layout.systems. */
  private sysInfos: SysInfo[] = []
  private systemById = new Map<string, SystemLayout>()
  /** Index planète → { système, slot } pour suivi caméra et hit-testing. */
  private slotIndex = new Map<string, { sys: SystemLayout; slot: PlanetSlot }>()
  /** Titres raccourcis (labels), calculés une seule fois. */
  private shortTitles = new Map<string, string>()
  /** Familles de polices résolues depuis les variables CSS. */
  private fontDisplayFamily = 'system-ui, sans-serif'
  private fontSansFamily = 'system-ui, sans-serif'
  /** Fonts canvas pré-composées (aucune concaténation par frame). */
  private starFont = '500 11px system-ui, sans-serif'
  private countFont = '400 10px system-ui, sans-serif'
  private planetFont = '500 10.5px system-ui, sans-serif'

  /* ============ Objets réutilisés (zéro allocation par frame) ============ */

  private hit: HitResult = { kind: 'none', id: null }

  /** L'intro cinématique a-t-elle été posée ? */
  private introDone = false

  /* ============ Mode « nébuleuse primordiale » (univers vide) ============ */

  /** Construit avec un univers vide → décor ambient au lieu des systèmes. */
  private ambient = false
  /** Poussières primordiales (pré-allouées, triées par couleur). */
  private motes: AmbientMote[] = []
  /** Sprite ✦ fantôme doré au centre du monde (0, 0). */
  private ghostSprite: HTMLCanvasElement | null = null
  /** Instant de référence du décor ambient (s) — phase des animations. */
  private ambientT0 = 0
  /** L'utilisateur a-t-il pris la main sur la caméra ? (coupe la dérive à vie) */
  private userInteracted = false

  /* ================================================================== */
  /* Construction / destruction                                          */
  /* ================================================================== */

  constructor(container: HTMLElement) {
    this.container = container

    // --- Canvas plein container ------------------------------------------------
    const canvas = document.createElement('canvas')
    canvas.style.position = 'absolute'
    canvas.style.inset = '0'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    canvas.style.touchAction = 'none' // drag / pinch gérés ici
    canvas.setAttribute('aria-hidden', 'true')
    container.appendChild(canvas)
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')

    // --- Index pré-calculés ----------------------------------------------------
    for (const sys of layout.systems) {
      this.systemById.set(sys.categoryId, sys)
      const cat = categoryById.get(sys.categoryId)
      this.sysInfos.push({
        sys,
        color: cat?.color ?? FALLBACK_COLOR,
        name: cat?.name ?? '',
        countLabel: `${sys.slots.length} planète${sys.slots.length > 1 ? 's' : ''}`,
        phase: ((hashString(sys.categoryId) % 1000) / 1000) * TAU,
      })
      for (const slot of sys.slots) {
        this.slotIndex.set(slot.planetId, { sys, slot })
      }
    }
    // Titres raccourcis pour les labels de planètes (une seule fois).
    for (const p of planetById.values()) {
      this.shortTitles.set(p.id, p.title.length > 42 ? `${p.title.slice(0, 41)}…` : p.title)
    }

    // --- Éléments de décor pré-calculés ----------------------------------------
    this.buildStarfield()
    this.resolveFonts()
    this.buildStarSprites()
    // --- Univers vide → décor ambient (« nébuleuse primordiale ») ---------------
    // Détection une seule fois à la construction : quand les données arrivent,
    // le shell REMONTE la vue (clé React) → un moteur neuf, plein, est reconstruit.
    this.ambient = layout.systems.length === 0
    if (this.ambient) this.buildAmbient(performance.now() / 1000)
    // Les polices web (next/font) peuvent arriver après le premier paint :
    // on régénère les sprites ✦ une fois qu'elles sont prêtes.
    document.fonts?.ready.then(() => {
      if (this.destroyed) return
      this.resolveFonts()
      this.buildStarSprites()
      if (this.ambient) this.buildGhostSprite()
    })

    // --- Dimension initiale + observers ----------------------------------------
    this.resize()
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    window.addEventListener('resize', this.onWindowResize)

    // --- Écouteurs pointeur / molette ------------------------------------------
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerCancel)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })

    // --- Commandes caméra du store ---------------------------------------------
    // Inactif → la commande reste « en attente » (traitée à l'activation).
    this.unsub = cosmosStore.subscribe((s, prev) => {
      if (s.camera.nonce !== prev.camera.nonce && this.active) this.onCamera(s.camera)
    })

    // --- Caméra initiale : cadrage global + intro cinématique -------------------
    // (reportée au premier resize si le conteneur n'a pas encore de taille)
    this.applyIntroCamera()
    // Toute commande émise avant le montage reste en attente (nonce > 0).
    this.lastNonce = 0

    // --- Boucle de rendu --------------------------------------------------------
    this.lastFrameTime = performance.now()
    this.rafId = requestAnimationFrame(this.frame)
  }

  /** Active ou suspend le moteur. La boucle RAF reste vivante mais saute
   *  update/render quand `active === false` (coût quasi nul). */
  setActive(active: boolean): void {
    if (this.destroyed || this.active === active) return
    this.active = active
    if (active) {
      // Repartir sur un dt propre.
      this.lastFrameTime = performance.now()
      // Traiter une commande caméra émise pendant l'inactivité.
      const cmd = cosmosStore.getState().camera
      if (cmd.nonce !== this.lastNonce) this.onCamera(cmd)
    }
  }

  /** Libère toutes les ressources (RAF, observers, listeners, store, canvas). */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    cancelAnimationFrame(this.rafId)
    this.unsub()
    this.ro?.disconnect()
    window.removeEventListener('resize', this.onWindowResize)
    const canvas = this.canvas
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.onPointerDown)
      canvas.removeEventListener('pointermove', this.onPointerMove)
      canvas.removeEventListener('pointerup', this.onPointerUp)
      canvas.removeEventListener('pointercancel', this.onPointerCancel)
      canvas.removeEventListener('pointerleave', this.onPointerLeave)
      canvas.removeEventListener('wheel', this.onWheel)
      canvas.remove()
    }
    this.pointers.clear()
    this.sprites.clear()
    this.dimMap.clear()
    this.ghostSprite = null
    this.motes = []
    this.vignette = null
    this.canvas = null
    this.ctx = null
  }

  /* ================================================================== */
  /* Commandes caméra (store)                                            */
  /* ================================================================== */

  private onCamera(cmd: CameraCommand): void {
    this.lastNonce = cmd.nonce
    // En mode ambient, une commande caméra explicite (bouton UI, recherche…)
    // prend la main : la dérive cinématique s'arrête définitivement.
    if (this.ambient) this.userInteracted = true
    const w = this.width
    const h = this.height
    const b = layout.bounds

    switch (cmd.kind) {
      case 'global': {
        // Cadrer tout l'univers (avec une petite marge de 6 %).
        this.followId = null
        this.target.x = (b.minX + b.maxX) / 2
        this.target.y = (b.minY + b.maxY) / 2
        this.target.zoom = clamp(fitZoom(b, w, h) * 0.94, this.minZoom, MAX_ZOOM)
        break
      }
      case 'category': {
        // Centrer le système solaire, zoom ajusté à son rayon.
        const sys = this.systemById.get(cmd.targetId ?? '')
        if (!sys) break
        this.followId = null
        this.target.x = sys.x
        this.target.y = sys.y
        this.target.zoom = clamp(
          Math.min(w, h) / (sys.radius * 2.6),
          Math.max(0.18, this.minZoom),
          Math.min(3, MAX_ZOOM),
        )
        break
      }
      case 'planet': {
        // Suivre la planète ; le zoom ne redescend jamais sous 2.3.
        const id = cmd.targetId
        const loc = id ? this.slotIndex.get(id) : undefined
        if (!loc) break
        this.followId = id
        this.target.zoom = clamp(Math.max(this.target.zoom, 2.3), this.minZoom, MAX_ZOOM)
        // Positionner immédiatement la cible pour lancer le travelling.
        const pos = planetWorldPosition(loc.sys, loc.slot, performance.now() / 1000)
        this.target.x = pos.x
        this.target.y = pos.y
        break
      }
      case 'zoom-in':
      case 'zoom-out': {
        // Zoom incrémental autour du centre écran.
        const f = cmd.kind === 'zoom-in' ? 1.5 : 1 / 1.5
        this.target.zoom = clamp(this.target.zoom * f, this.minZoom, MAX_ZOOM)
        break
      }
      case 'pan': {
        // Déplacement direct vers un point du monde (clic sur la mini-carte)
        // -- zoom inchangé, on ne fait que recentrer.
        if (!cmd.world) break
        this.followId = null
        this.target.x = cmd.world.x
        this.target.y = cmd.world.y
        break
      }
    }
  }

  /* ================================================================== */
  /* Boucle : update + render                                            */
  /* ================================================================== */

  private frame = (now: number): void => {
    if (this.destroyed) return
    this.rafId = requestAnimationFrame(this.frame)
    const dt = Math.min(0.1, Math.max(0, (now - this.lastFrameTime) / 1000))
    this.lastFrameTime = now
    if (!this.active) return // boucle vivante mais moteur suspendu
    this.update(dt, now)
    this.render(now, dt)
  }

  private update(dt: number, now: number): void {
    const dragging = this.pinch.active || (this.gesture.active && this.gesture.dragging)

    // --- Inertie du pan (décroissance ~ ×0.92 par frame à 60 fps) -------------
    if (!dragging && (this.vel.x !== 0 || this.vel.y !== 0)) {
      const speed = Math.hypot(this.vel.x, this.vel.y)
      if (speed < 1.2) {
        // ~0.02 px/frame : arrêt net.
        this.vel.x = 0
        this.vel.y = 0
      } else {
        const dx = (this.vel.x * dt) / this.cam.zoom
        const dy = (this.vel.y * dt) / this.cam.zoom
        this.cam.x -= dx
        this.cam.y -= dy
        this.target.x -= dx
        this.target.y -= dy
        const decay = Math.pow(0.92, dt * 60)
        this.vel.x *= decay
        this.vel.y *= decay
      }
    }

    // --- Suivi de planète (commande 'planet') ----------------------------------
    if (this.followId) {
      const loc = this.slotIndex.get(this.followId)
      if (loc) {
        const pos = planetWorldPosition(loc.sys, loc.slot, now / 1000)
        this.target.x = pos.x
        this.target.y = pos.y
      } else {
        this.followId = null
      }
    }

    // --- Dérive cinématique (ambient, avant toute interaction) ------------------
    // Lente figure de Lissajous autour du centre monde : le lissage
    // exponentiel ci-dessous la rend parfaitement onctueuse. Coupée
    // définitivement au premier contact utilisateur (pointeur/molette/
    // pincement/commande caméra) — la cible reste alors où elle est.
    if (this.ambient && !this.userInteracted && !dragging) {
      const tau = now / 1000 - this.ambientT0
      this.target.x = AMBIENT_DRIFT_AX * Math.sin(AMBIENT_DRIFT_WX * tau)
      this.target.y = AMBIENT_DRIFT_AY * Math.sin(AMBIENT_DRIFT_WY * tau)
    }

    // --- Lissage exponentiel caméra → cible ------------------------------------
    const k = 1 - Math.exp(-dt * CAM_SMOOTH)
    this.cam.x += (this.target.x - this.cam.x) * k
    this.cam.y += (this.target.y - this.cam.y) * k
    // Zoom interpolé en espace logarithmique : vitesse perceptive constante.
    const logZ = Math.log(this.cam.zoom) + (Math.log(this.target.zoom) - Math.log(this.cam.zoom)) * k
    this.cam.zoom = Math.exp(logZ)
  }

  /* ================================================================== */
  /* Rendu                                                               */
  /* ================================================================== */

  private render(now: number, dt: number): void {
    const ctx = this.ctx
    if (!ctx || !this.canvas) return
    const w = this.width
    const h = this.height
    if (w < 2 || h < 2) return

    const st = cosmosStore.getState()
    const t = now / 1000
    const zoom = this.cam.zoom
    const camX = this.cam.x
    const camY = this.cam.y
    const cx = w / 2
    const cy = h / 2

    // --- 1. Fond + vignette -----------------------------------------------------
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.fillStyle = BG_COLOR
    ctx.fillRect(0, 0, w, h)
    if (this.vignette) ctx.drawImage(this.vignette, 0, 0, w, h)

    // --- 2. Champ d'étoiles parallaxe (derrière tout) ---------------------------
    this.drawStarfield(ctx, w, h, camX, camY)

    // --- 2b. Univers vide : nébuleuse primordiale --------------------------------
    // Poussières interpolées → anneaux fantômes → ondulations → étoile ✦.
    // Aucun système, planète ni label n'existe : on s'arrête là.
    if (this.ambient) {
      this.drawAmbient(ctx, w, h, camX, camY, zoom, t)
      return
    }

    // --- 3. Systèmes solaires ----------------------------------------------------
    const halfW = cx / zoom
    const halfH = cy / zoom
    const vx0 = camX - halfW
    const vx1 = camX + halfW
    const vy0 = camY - halfH
    const vy1 = camY + halfH

    const selCat = st.selectedCategoryId
    const selPlanetId = st.selectedPlanetId
    const hoveredId = st.hoveredId
    // `until` est en base Date.now() (voir store.jumpToPlanet).
    const highlight = st.highlight && st.highlight.until > Date.now() ? st.highlight : null

    // Catégorie « propriétaire » des entités survolées/sélectionnées/mises en
    // avant — pour les labels de planètes et l'atténuation des systèmes.
    const hoveredPlanet = hoveredId ? planetById.get(hoveredId) : undefined
    const hoveredCat = hoveredPlanet
      ? hoveredPlanet.category_id
      : hoveredId && categoryById.has(hoveredId)
        ? hoveredId
        : null
    const selPlanetCat = selPlanetId ? (planetById.get(selPlanetId)?.category_id ?? null) : null
    const highlightCat = highlight ? (planetById.get(highlight.planetId)?.category_id ?? null) : null

    const zoomFade = clamp((zoom - STAR_LABEL_ZOOM) / 0.15, 0, 1)
    const dimK = 1 - Math.exp(-dt * DIM_SMOOTH)
    const allPlanetLabels = zoom > PLANET_LABEL_ZOOM

    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'

    for (const info of this.sysInfos) {
      const sys = info.sys

      // Culling : le cercle englobant du système doit couper le viewport.
      if (
        sys.x + sys.radius < vx0 ||
        sys.x - sys.radius > vx1 ||
        sys.y + sys.radius < vy0 ||
        sys.y - sys.radius > vy1
      ) {
        continue
      }

      const isSel = sys.categoryId === selCat
      const isHov = sys.categoryId === hoveredCat
      const specialSys = isSel || isHov

      // Facteur d'atténuation lissé (par système).
      let dim = this.dimMap.get(sys.categoryId)
      if (dim === undefined) dim = 1
      dim += ((selCat === null || isSel ? 1 : DIM_FADED) - dim) * dimK
      this.dimMap.set(sys.categoryId, dim)

      const starSx = (sys.x - camX) * zoom + cx
      const starSy = (sys.y - camY) * zoom + cy

      /* --- 3a. Orbites (une seule passe beginPath par système) ---------------- */
      if (zoom >= MIN_ORBIT_ZOOM) {
        ctx.beginPath()
        for (const slot of sys.slots) {
          const r = slot.orbitRadius * zoom
          if (r < 2.5) continue // sous-pixel : inutile
          ctx.moveTo(starSx + r, starSy)
          ctx.arc(starSx, starSy, r, 0, TAU)
        }
        ctx.strokeStyle = info.color
        ctx.lineWidth = 1
        ctx.globalAlpha = isSel ? 0.1 : 0.05 * dim
        ctx.stroke()
        ctx.globalAlpha = 1
      }

      /* --- 3b. Étoile ✦ (sprite pré-rendu + scintillement) ------------------- */
      const size = clamp(sys.starSize * zoom, 12, 46)
      const sprite = this.sprites.get(sys.categoryId)
      if (sprite) {
        ctx.globalAlpha = (0.9 + 0.1 * Math.sin(t * 1.7 + info.phase)) * dim
        ctx.drawImage(sprite, starSx - size / 2, starSy - size / 2, size, size)
        ctx.globalAlpha = 1
      }

      /* --- 3c/3d. Planètes + états spéciaux ------------------------------------ */
      for (const slot of sys.slots) {
        const planet = planetById.get(slot.planetId)
        // Les planètes filtrées (types) ne sont ni dessinées ni annotées.
        if (!planet || !st.isPlanetVisible(planet)) continue

        const angle = slot.angle0 + slot.angularSpeed * t
        const sx = (sys.x + Math.cos(angle) * slot.orbitRadius - camX) * zoom + cx
        const sy = (sys.y + Math.sin(angle) * slot.orbitRadius - camY) * zoom + cy
        const pr = Math.max(slot.size * zoom, 1.4)
        if (sx < -48 || sx > w + 48 || sy < -48 || sy > h + 48) continue

        // Disque de la planète.
        ctx.globalAlpha = dim
        ctx.fillStyle = planet.color
        ctx.beginPath()
        ctx.arc(sx, sy, pr, 0, TAU)
        ctx.fill()
        if (pr > 4.5) {
          // Croissant de lumière côté étoile (petit cercle clair décalé).
          let dx = starSx - sx
          let dy = starSy - sy
          const dl = Math.hypot(dx, dy) || 1
          dx = (dx / dl) * pr * 0.32
          dy = (dy / dl) * pr * 0.32
          ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
          ctx.beginPath()
          ctx.arc(sx + dx, sy + dy, pr * 0.55, 0, TAU)
          ctx.fill()
          // Liseré sombre.
          ctx.strokeStyle = 'rgba(3, 4, 8, 0.5)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(sx, sy, pr - 0.5, 0, TAU)
          ctx.stroke()
        }
        ctx.globalAlpha = 1

        // Survol : anneau blanc discret.
        if (planet.id === hoveredId) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(sx, sy, pr + 4, 0, TAU)
          ctx.stroke()
        }
        // Sélection : anneau couleur planète + halo pulsant lent.
        if (planet.id === selPlanetId) {
          ctx.strokeStyle = planet.color
          ctx.lineWidth = 1.5
          ctx.globalAlpha = 0.8
          ctx.beginPath()
          ctx.arc(sx, sy, pr + 5, 0, TAU)
          ctx.stroke()
          const pulse = Math.sin(t * 1.6)
          ctx.globalAlpha = 0.2 + 0.1 * pulse
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(sx, sy, pr + 9 + 3 * pulse, 0, TAU)
          ctx.stroke()
          ctx.globalAlpha = 1
        }
        // Surbrillance (recherche) : deux anneaux expansifs en boucle.
        if (highlight && planet.id === highlight.planetId) {
          ctx.strokeStyle = planet.color
          ctx.lineWidth = 1.5
          for (let k = 0; k < 2; k++) {
            const phase = (now / 900 + k * 0.5) % 1
            ctx.globalAlpha = (1 - phase) * 0.8
            ctx.beginPath()
            ctx.arc(sx, sy, pr + phase * 22, 0, TAU)
            ctx.stroke()
          }
          ctx.globalAlpha = 1
        }
      }

      /* --- 3e. Labels ----------------------------------------------------------- */
      // Les systèmes « spéciaux » (survolés/sélectionnés) ne sont jamais éteints
      // complètement, même si une autre sélection atténue le reste.
      const labelDim = specialSys ? Math.max(dim, 0.85) : dim

      // Nom de l'étoile (fondu avec le zoom, ou plein si hover/sélection).
      const starAlpha = Math.max(zoomFade, specialSys ? 1 : 0)
      if (starAlpha > 0.02 && info.name) {
        const ly = starSy + size / 2 + 12
        ctx.font = this.starFont
        ctx.globalAlpha = 0.62 * starAlpha * labelDim
        ctx.fillStyle = LABEL_SHADOW
        ctx.fillText(info.name, starSx, ly + 1)
        ctx.fillStyle = LABEL_TEXT
        ctx.fillText(info.name, starSx, ly)
        // Nombre de planètes — uniquement au survol ou à la sélection.
        if (specialSys) {
          const ly2 = ly + 14
          ctx.font = this.countFont
          ctx.globalAlpha = 0.35
          ctx.fillStyle = LABEL_SHADOW
          ctx.fillText(info.countLabel, starSx, ly2 + 1)
          ctx.fillStyle = LABEL_TEXT
          ctx.fillText(info.countLabel, starSx, ly2)
        }
        ctx.globalAlpha = 1
      }

      // Labels de planètes : toutes celles du système survolé/sélectionné si on
      // est assez zoomé, ou toujours pour la planète survolée/sélectionnée/
      // mise en avant.
      const wantAll = allPlanetLabels && specialSys
      const sysHasSpecial =
        hoveredCat === sys.categoryId ||
        selPlanetCat === sys.categoryId ||
        highlightCat === sys.categoryId
      if (wantAll || sysHasSpecial) {
        ctx.font = this.planetFont
        for (const slot of sys.slots) {
          const planet = planetById.get(slot.planetId)
          if (!planet || !st.isPlanetVisible(planet)) continue
          const special =
            planet.id === hoveredId ||
            planet.id === selPlanetId ||
            (highlight !== null && planet.id === highlight.planetId)
          if (!wantAll && !special) continue
          const angle = slot.angle0 + slot.angularSpeed * t
          const sx = (sys.x + Math.cos(angle) * slot.orbitRadius - camX) * zoom + cx
          const sy = (sys.y + Math.sin(angle) * slot.orbitRadius - camY) * zoom + cy
          if (sx < -60 || sx > w + 60 || sy < -60 || sy > h + 60) continue
          const pr = Math.max(slot.size * zoom, 1.4)
          const ly = sy + pr + 14
          const title = this.shortTitles.get(planet.id) ?? planet.title
          ctx.globalAlpha = 0.85 * labelDim
          ctx.fillStyle = LABEL_SHADOW
          ctx.fillText(title, sx, ly + 1, 170)
          ctx.fillStyle = LABEL_TEXT
          ctx.fillText(title, sx, ly, 170)
        }
        ctx.globalAlpha = 1
      }
    }
  }

  /** Champ d'étoiles discret, deux couches de parallaxe, enroulé à l'écran. */
  private drawStarfield(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    camX: number,
    camY: number,
  ): void {
    if (this.stars.length === 0 || w < 2 || h < 2) return
    ctx.fillStyle = '#d2d8e6'
    for (const s of this.stars) {
      const par = s.near ? 0.25 : 0.12
      let sx = (s.x - camX * par) % w
      let sy = (s.y - camY * par) % h
      if (sx < 0) sx += w
      if (sy < 0) sy += h
      ctx.globalAlpha = s.alpha
      ctx.fillRect(sx, sy, s.size, s.size)
    }
    ctx.globalAlpha = 1
  }

  /* ================================================================== */
  /* Mode ambient — nébuleuse primordiale (univers vide)                */
  /* ================================================================== */

  /** Construit le décor ambient : poussières déterministes (seed fixe),
   *  triées par couleur pour limiter les changements d'état au rendu. */
  private buildAmbient(t0: number): void {
    this.ambientT0 = t0
    const rng = mulberry32(AMBIENT_SEED)
    const motes: AmbientMote[] = []
    for (let i = 0; i < AMBIENT_MOTE_COUNT; i++) {
      const from = ambientAnnulusPoint(rng, AMBIENT_MOTE_CLEARING, AMBIENT_MOTE_SPREAD)
      const to = ambientAnnulusPoint(rng, AMBIENT_MOTE_CLEARING, AMBIENT_MOTE_SPREAD)
      // Départs échelonnés dans le passé : la nébuleuse n'émerge jamais d'un coup.
      motes.push({
        x: from.x,
        y: from.y,
        tx: to.x,
        ty: to.y,
        duration: rng.float(AMBIENT_JOURNEY_MIN, AMBIENT_JOURNEY_MAX),
        startTime: t0 - rng.float(0, AMBIENT_JOURNEY_MAX),
        size: rng.float(1.2, 2.6),
        baseAlpha: rng.float(0.25, 0.7),
        twinklePhase: rng.float(0, TAU),
        twinkleSpeed: rng.float(0.5, 1.3),
        // Surtout de l'or chaud, un peu de blanc doux, quelques braises.
        colorIndex: rng.next() < 0.7 ? 0 : rng.next() < 0.67 ? 1 : 2,
        seed: rng.int(0, 0x7fffffff),
      })
    }
    // Tri par couleur : au rendu, un seul changement de fillStyle par groupe.
    motes.sort((a, b) => a.colorIndex - b.colorIndex)
    this.motes = motes
    this.buildGhostSprite()
  }

  /** Sprite ✦ fantôme doré (mode ambient) — même technique que les sprites
   *  d'étoiles : halo radial pré-rendu + vrai glyphe U+2726 + cœur clair. */
  private buildGhostSprite(): void {
    const S = STAR_SPRITE_SIZE
    const m = S / 2
    const c = document.createElement('canvas')
    c.width = S
    c.height = S
    const g = c.getContext('2d')
    if (!g) {
      this.ghostSprite = null
      return
    }
    const grd = g.createRadialGradient(m, m, 2, m, m, m)
    grd.addColorStop(0, rgba(GHOST_GOLD, 0.5))
    grd.addColorStop(0.32, rgba(GHOST_GOLD, 0.16))
    grd.addColorStop(1, rgba(GHOST_GOLD, 0))
    g.fillStyle = grd
    g.fillRect(0, 0, S, S)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `${Math.round(S * 0.46)}px ${this.fontDisplayFamily}`
    g.fillStyle = GHOST_GOLD
    g.fillText('✦', m, m + S * 0.01)
    // Léger cœur clair pour l'éclat.
    g.font = `${Math.round(S * 0.23)}px ${this.fontDisplayFamily}`
    g.fillStyle = 'rgba(255, 255, 255, 0.7)'
    g.fillText('✦', m, m + S * 0.005)
    this.ghostSprite = c
  }

  /** Avance le flux pseudo-aléatoire propre à une poussière (mulberry32
   *  inliné → aucune allocation) et retourne un flottant dans [0, 1). */
  private moteNext(m: AmbientMote): number {
    m.seed = (m.seed + 0x6d2b79f5) | 0
    let t = Math.imul(m.seed ^ (m.seed >>> 15), 1 | m.seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Fin d'un voyage : l'arrivée devient le nouveau départ, une nouvelle
   *  cible et durée sont tirées du flux propre — continuation interpolée,
   *  jamais de saut. */
  private retargetMote(m: AmbientMote, nowSec: number): void {
    m.x = m.tx
    m.y = m.ty
    const u1 = this.moteNext(m)
    const u2 = this.moteNext(m)
    const u3 = this.moteNext(m)
    const r = Math.sqrt(
      AMBIENT_MOTE_CLEARING * AMBIENT_MOTE_CLEARING +
        u1 * (AMBIENT_MOTE_SPREAD * AMBIENT_MOTE_SPREAD - AMBIENT_MOTE_CLEARING * AMBIENT_MOTE_CLEARING),
    )
    const a = u2 * TAU
    m.tx = Math.cos(a) * r
    m.ty = Math.sin(a) * r
    m.duration = AMBIENT_JOURNEY_MIN + u3 * (AMBIENT_JOURNEY_MAX - AMBIENT_JOURNEY_MIN)
    m.startTime = nowSec
  }

  /** Décor ambient, tout en espace monde (réagit au pan/zoom) :
   *  poussières interpolées, anneaux respirants, ondulations, étoile ✦. */
  private drawAmbient(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    camX: number,
    camY: number,
    zoom: number,
    t: number,
  ): void {
    const cx = w / 2
    const cy = h / 2
    // Position écran de l'étoile fantôme (centre monde 0, 0).
    const gx = -camX * zoom + cx
    const gy = -camY * zoom + cy

    /* --- 1. Poussières primordiales (pré-triées par couleur) ---------------- */
    // L'alpha varie par poussière (enveloppe sin² + scintillement) : un seul
    // beginPath/fill par point, mais le fillStyle ne change que 3 fois par
    // frame grâce au tri — zéro allocation, zéro shadowBlur.
    let curColor = -1
    for (const m of this.motes) {
      // Avancement du voyage ; à l'arrivée, enchaînement immédiat sur un
      // nouveau tronçon (position actuelle = nouveau départ).
      let p = (t - m.startTime) / m.duration
      if (p >= 1) {
        this.retargetMote(m, t)
        p = 0
      } else if (p < 0) {
        p = 0
      }
      const e = easeInOutCubic(p)
      const sx = (m.x + (m.tx - m.x) * e - camX) * zoom + cx
      const sy = (m.y + (m.ty - m.y) * e - camY) * zoom + cy
      if (sx < -8 || sx > w + 8 || sy < -8 || sy > h + 8) continue
      if (m.colorIndex !== curColor) {
        ctx.fillStyle = AMBIENT_MOTE_FILLS[m.colorIndex]
        curColor = m.colorIndex
      }
      // Enveloppe douce sin²(progress·π) : fondu complet au départ/arrivée.
      const env = Math.sin(p * Math.PI)
      const twinkle = 0.85 + 0.15 * Math.sin(t * m.twinkleSpeed + m.twinklePhase)
      ctx.globalAlpha = m.baseAlpha * env * env * twinkle
      const r = Math.max(0.8, m.size * zoom)
      if (r < 1.1) {
        // Point sous-pixel : un simple carré plein suffit et c'est plus rapide.
        ctx.fillRect(sx - r, sy - r, r * 2, r * 2)
      } else {
        ctx.beginPath()
        ctx.arc(sx, sy, r, 0, TAU)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1

    /* --- 2. Anneaux d'orbites fantômes (respiration ±5 %) ------------------- */
    // Trois fins cercles concentriques qui esquissent les orbites à venir :
    // rayon et opacité respirent ensemble (alpha 0.05 → 0.16, 6–9 s).
    ctx.lineWidth = 1
    for (const ring of AMBIENT_RINGS) {
      const pulse = Math.sin((TAU * t) / ring.period + ring.phase)
      const r = ring.radius * (1 + 0.05 * pulse) * zoom
      if (r < 6) continue // sous-pixel : on épargne le traceur
      ctx.strokeStyle = ring.style
      ctx.globalAlpha = 0.105 + 0.055 * pulse
      ctx.beginPath()
      ctx.arc(gx, gy, r, 0, TAU)
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    /* --- 3. Ondulations : deux canaux décalés d'une demi-période ------------ */
    // Un cercle d'or s'échappe de l'étoile fantôme toutes les ~6,5 s (décalé
    // de 3,25 s sur le second canal), 0 → ~520 unités monde en ~5,5 s.
    ctx.strokeStyle = AMBIENT_MOTE_FILLS[0]
    ctx.lineWidth = 1.5
    for (let k = 0; k < 2; k++) {
      const phase = ((t - this.ambientT0) / AMBIENT_RIPPLE_PERIOD + k * 0.5) % 1
      const age = phase * AMBIENT_RIPPLE_PERIOD
      if (age >= AMBIENT_RIPPLE_DURATION) continue
      const p = age / AMBIENT_RIPPLE_DURATION
      const r = AMBIENT_RIPPLE_MAX_R * easeOutCubic(p) * zoom
      if (r < 1) continue
      ctx.globalAlpha = (1 - p) * 0.35
      ctx.beginPath()
      ctx.arc(gx, gy, r, 0, TAU)
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    /* --- 4. Étoile fantôme ✦ (taille et opacité vivantes) ------------------- */
    if (this.ghostSprite) {
      const size = 120 * (1 + 0.07 * Math.sin(t * 0.45))
      ctx.globalAlpha = 0.55 + 0.18 * Math.sin(t * 0.3)
      ctx.drawImage(this.ghostSprite, gx - size / 2, gy - size / 2, size, size)
      ctx.globalAlpha = 1
    }
  }

  /* ================================================================== */
  /* Construction des éléments pré-rendus                               */
  /* ================================================================== */

  /** Résout les familles de polices depuis les variables CSS du thème. */
  private resolveFonts(): void {
    try {
      // Les variables next/font vivent sur <body> (voir app/layout.tsx) ; on
      // essaie d'abord <html> puis <body> par robustesse.
      const root = getComputedStyle(document.documentElement)
      const body = getComputedStyle(document.body)
      const d = (root.getPropertyValue('--font-display') || body.getPropertyValue('--font-display')).trim()
      const s = (root.getPropertyValue('--font-sans') || body.getPropertyValue('--font-sans')).trim()
      if (d) {
        this.fontDisplayFamily = d
        this.starFont = `500 11px ${d}`
      }
      if (s) {
        this.fontSansFamily = s
        this.countFont = `400 10px ${s}`
        this.planetFont = `500 10.5px ${s}`
      }
    } catch {
      // Styles indisponibles : on garde les valeurs par défaut.
    }
  }

  /**
   * Sprites d'étoiles ✦ : caractère Unicode U+2726 rendu via fillText dans la
   * couleur de la catégorie, avec halo radial dégradé et léger cœur blanc.
   */
  private buildStarSprites(): void {
    this.sprites.clear()
    const S = STAR_SPRITE_SIZE
    const m = S / 2
    for (const cat of categoryById.values()) {
      const c = document.createElement('canvas')
      c.width = S
      c.height = S
      const g = c.getContext('2d')
      if (!g) continue
      // Halo radial (pré-rendu → aucun shadowBlur dans la boucle). Une
      // catégorie prioritaire (voir layout.ts::starSize) a un halo plus
      // intense en plus d'être physiquement plus grande une fois dessinée.
      const haloBoost = cat.priority ? 1.5 : 1
      const grd = g.createRadialGradient(m, m, 2, m, m, m)
      grd.addColorStop(0, rgba(cat.color, Math.min(0.9, 0.5 * haloBoost)))
      grd.addColorStop(0.32, rgba(cat.color, Math.min(0.35, 0.16 * haloBoost)))
      grd.addColorStop(1, rgba(cat.color, 0))
      g.fillStyle = grd
      g.fillRect(0, 0, S, S)
      // Le vrai caractère ✦, dans la couleur de la catégorie.
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.font = `${Math.round(S * 0.46)}px ${this.fontDisplayFamily}`
      g.fillStyle = cat.color
      g.fillText('✦', m, m + S * 0.01)
      // Léger cœur blanc pour l'éclat.
      g.font = `${Math.round(S * 0.23)}px ${this.fontDisplayFamily}`
      g.fillStyle = 'rgba(255, 255, 255, 0.7)'
      g.fillText('✦', m, m + S * 0.005)
      this.sprites.set(cat.id, c)
    }
  }

  /** Vignette radiale (transparente au centre → noir 0.5 aux bords). */
  private buildVignette(): void {
    const w = this.width
    const h = this.height
    if (w < 2 || h < 2) {
      this.vignette = null
      return
    }
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')
    if (!g) {
      this.vignette = null
      return
    }
    const cx = w / 2
    const cy = h / 2
    const grd = g.createRadialGradient(cx, cy, Math.min(w, h) * 0.36, cx, cy, Math.hypot(w, h) * 0.55)
    grd.addColorStop(0, 'rgba(0, 0, 0, 0)')
    grd.addColorStop(0.62, 'rgba(0, 0, 0, 0.16)')
    grd.addColorStop(1, 'rgba(0, 0, 0, 0.5)')
    g.fillStyle = grd
    g.fillRect(0, 0, w, h)
    this.vignette = c
  }

  /** Champ d'étoiles déterministe (seed 1234), deux couches de parallaxe. */
  private buildStarfield(): void {
    const rng = mulberry32(1234)
    const stars: StarPoint[] = []
    for (let i = 0; i < STARFIELD_COUNT; i++) {
      const near = rng.chance(0.42)
      const bright = near && rng.chance(0.18)
      stars.push({
        x: rng.float(0, STARFIELD_TILE),
        y: rng.float(0, STARFIELD_TILE),
        size: bright ? 1.5 : 1,
        alpha: bright ? rng.float(0.5, 0.68) : rng.float(0.25, 0.6),
        near,
      })
    }
    this.stars = stars
  }

  /* ================================================================== */
  /* Dimension / caméra initiale                                        */
  /* ================================================================== */

  private onWindowResize = (): void => {
    this.resize()
  }

  /** Recadre le canvas sur le container (DPR-aware), reconstruit la vignette. */
  private resize(): void {
    const canvas = this.canvas
    if (!canvas || this.destroyed) return
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    const dpr = window.devicePixelRatio || 1
    this.width = w
    this.height = h
    this.dpr = dpr
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    // Borne basse de zoom : la moitié du cadrage global.
    this.minZoom = fitZoom(layout.bounds, w, h) * 0.5
    this.target.zoom = clamp(this.target.zoom, this.minZoom, MAX_ZOOM)
    this.cam.zoom = clamp(this.cam.zoom, this.minZoom, MAX_ZOOM)
    this.buildVignette()
    const r = canvas.getBoundingClientRect()
    this.rect.left = r.left
    this.rect.top = r.top
    // Première vraie dimension → poser l'intro (le constructeur a pu tourner
    // avant la mise en page).
    if (!this.introDone && this.container.clientWidth > 10) this.applyIntroCamera()
  }

  /** Caméra initiale : cadrage global + léger travelling d'ouverture.
   *  Sans effet si le conteneur n'a pas encore de taille exploitable. */
  private applyIntroCamera(): void {
    if (this.introDone) return // ne jouer l'ouverture qu'une fois
    if (this.width <= 10 || this.height <= 10) return
    const b = layout.bounds
    const z = clamp(fitZoom(b, this.width, this.height) * 0.94, this.minZoom, MAX_ZOOM)
    this.target.x = (b.minX + b.maxX) / 2
    this.target.y = (b.minY + b.maxY) / 2
    this.target.zoom = z
    // Départ légèrement décalé et zoomé : le lissage fait le travelling.
    this.cam.zoom = Math.min(z * INTRO_ZOOM_FACTOR, MAX_ZOOM)
    this.cam.x = this.target.x + (this.width / z) * INTRO_OFFSET
    this.cam.y = this.target.y + (this.height / z) * INTRO_OFFSET
    this.followId = null
    this.introDone = true
  }

  /* ================================================================== */
  /* Interactions pointeur / molette                                     */
  /* ================================================================== */

  private onPointerDown = (e: PointerEvent): void => {
    const canvas = this.canvas
    if (!canvas || this.destroyed) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    // Premier contact : l'utilisateur prend la main — la dérive ambient
    // cinématique s'arrête définitivement (la cible reste où elle est).
    this.userInteracted = true
    // Rafraîchir le repère écran (le layout a pu bouger).
    const r = canvas.getBoundingClientRect()
    this.rect.left = r.left
    this.rect.top = r.top
    const x = e.clientX - this.rect.left
    const y = e.clientY - this.rect.top
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      // Pointeur déjà relâché : on ignore proprement.
    }
    this.pointers.set(e.pointerId, { x, y })
    this.vel.x = 0
    this.vel.y = 0
    if (this.pointers.size === 1) {
      this.gesture.active = true
      this.gesture.dragging = false
      this.gesture.moved = 0
      this.gesture.lastX = x
      this.gesture.lastY = y
      this.gesture.lastT = e.timeStamp
      this.gesture.downT = e.timeStamp
    } else if (this.pointers.size === 2) {
      // Deux doigts → pincement (plus de drag simple).
      this.gesture.active = false
      this.gesture.dragging = false
      this.beginPinch()
    }
    this.updateCursor()
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (this.destroyed) return
    const x = e.clientX - this.rect.left
    const y = e.clientY - this.rect.top
    const p = this.pointers.get(e.pointerId)
    if (p) {
      p.x = x
      p.y = y
    }

    // --- Pinch : zoom autour du milieu des deux doigts --------------------------
    if (this.pinch.active && this.pointers.size >= 2) {
      const pts = Array.from(this.pointers.values())
      const a = pts[0]
      const b = pts[1]
      if (a && b) {
        const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
        const mx = (a.x + b.x) / 2
        const my = (a.y + b.y) / 2
        const nz = clamp((this.pinch.startZoom * dist) / this.pinch.startDist, this.minZoom, MAX_ZOOM)
        // Le point monde saisi au départ du pincement reste sous le milieu.
        this.cam.zoom = nz
        this.cam.x = this.pinch.worldX - (mx - this.width / 2) / nz
        this.cam.y = this.pinch.worldY - (my - this.height / 2) / nz
        this.target.zoom = nz
        this.target.x = this.cam.x
        this.target.y = this.cam.y
      }
      this.updateCursor()
      return
    }

    // --- Drag (pan) : caméra posée directement, pas de lissage ------------------
    if (p && this.pointers.size === 1 && this.gesture.active) {
      const dx = x - this.gesture.lastX
      const dy = y - this.gesture.lastY
      const dtms = Math.max(1, e.timeStamp - this.gesture.lastT)
      this.gesture.moved += Math.hypot(dx, dy)
      if (!this.gesture.dragging && this.gesture.moved > 4) {
        this.gesture.dragging = true
        this.followId = null // interaction utilisateur → arrêt du suivi
      }
      if (this.gesture.dragging) {
        this.cam.x -= dx / this.cam.zoom
        this.cam.y -= dy / this.cam.zoom
        this.target.x = this.cam.x
        this.target.y = this.cam.y
        // Vitesse lissée (px/s) pour l'inertie au relâchement.
        this.vel.x = this.vel.x * 0.65 + (dx / dtms) * 1000 * 0.35
        this.vel.y = this.vel.y * 0.65 + (dy / dtms) * 1000 * 0.35
      }
      this.gesture.lastX = x
      this.gesture.lastY = y
      this.gesture.lastT = e.timeStamp
      this.updateCursor()
      return
    }

    // --- Survol simple (aucun pointeur actif) ------------------------------------
    if (!p) {
      this.updateHover(x, y)
    }
  }

  private onPointerUp = (e: PointerEvent): void => {
    if (this.destroyed) return
    this.pointers.delete(e.pointerId)
    if (this.pointers.size === 0) {
      const wasPinch = this.pinch.active
      this.pinch.active = false
      // Tap : peu de déplacement et bref → sélection.
      if (this.gesture.active && !this.gesture.dragging && !wasPinch) {
        const dur = e.timeStamp - this.gesture.downT
        if (this.gesture.moved < 6 && dur < 450) {
          this.tapSelect(e.clientX - this.rect.left, e.clientY - this.rect.top)
        }
      }
      this.gesture.active = false
      this.gesture.dragging = false
      // L'inertie utilisera la vitesse mesurée pendant le drag (si drag il y a eu).
    } else if (this.pointers.size === 1) {
      // Fin de pincement → reprendre un drag simple avec le doigt restant.
      this.pinch.active = false
      this.vel.x = 0
      this.vel.y = 0
      const rp = Array.from(this.pointers.values())[0]
      if (rp) {
        this.gesture.active = true
        this.gesture.dragging = true
        this.gesture.moved = 999 // jamais un tap
        this.gesture.lastX = rp.x
        this.gesture.lastY = rp.y
        this.gesture.lastT = e.timeStamp
      }
    }
    this.updateCursor()
  }

  private onPointerCancel = (e: PointerEvent): void => {
    if (this.destroyed) return
    this.pointers.delete(e.pointerId)
    if (this.pointers.size === 0) {
      this.pinch.active = false
      this.gesture.active = false
      this.gesture.dragging = false
      this.vel.x = 0
      this.vel.y = 0
    } else if (this.pointers.size === 1) {
      this.pinch.active = false
      this.vel.x = 0
      this.vel.y = 0
      const rp = Array.from(this.pointers.values())[0]
      if (rp) {
        this.gesture.active = true
        this.gesture.dragging = true
        this.gesture.moved = 999
        this.gesture.lastX = rp.x
        this.gesture.lastY = rp.y
        this.gesture.lastT = e.timeStamp
      }
    }
    this.updateCursor()
  }

  private onPointerLeave = (): void => {
    if (this.destroyed || this.pointers.size > 0) return
    this.hoverFound = false
    const st = cosmosStore.getState()
    if (st.hoveredId !== null) st.setHovered(null)
    this.updateCursor()
  }

  private onWheel = (e: WheelEvent): void => {
    if (this.destroyed) return
    e.preventDefault()
    this.userInteracted = true // la dérive ambient s'arrête ici aussi
    this.followId = null // interaction utilisateur → arrêt du suivi
    this.vel.x = 0
    this.vel.y = 0
    // Normaliser deltaMode (lignes / pages → pixels).
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.height : 1
    const factor = Math.exp(-e.deltaY * unit * WHEEL_SENSITIVITY)
    const mx = e.clientX - this.rect.left
    const my = e.clientY - this.rect.top
    const cx = this.width / 2
    const cy = this.height / 2
    // Point monde actuellement visible sous le curseur (ancre du zoom).
    const wx = this.cam.x + (mx - cx) / this.cam.zoom
    const wy = this.cam.y + (my - cy) / this.cam.zoom
    const nz = clamp(this.target.zoom * factor, this.minZoom, MAX_ZOOM)
    this.target.zoom = nz
    // La cible maintient ce point sous le curseur au nouveau zoom.
    this.target.x = wx - (mx - cx) / nz
    this.target.y = wy - (my - cy) / nz
  }

  /** Initialise un pincement : mémorise distance, zoom et point monde saisi. */
  private beginPinch(): void {
    const pts = Array.from(this.pointers.values())
    const a = pts[0]
    const b = pts[1]
    if (!a || !b) return
    this.pinch.active = true
    this.pinch.startDist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
    this.pinch.startZoom = this.cam.zoom
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    this.pinch.worldX = this.cam.x + (mx - this.width / 2) / this.cam.zoom
    this.pinch.worldY = this.cam.y + (my - this.height / 2) / this.cam.zoom
    this.followId = null // interaction utilisateur → arrêt du suivi
  }

  /* ================================================================== */
  /* Hit-testing & sélection                                             */
  /* ================================================================== */

  /**
   * Cherche l'entité sous un point écran (px, repère canvas).
   * Les planètes ont la priorité (la plus proche gagne), puis les étoiles.
   * ⚠️ Retourne un objet réutilisé — ne pas conserver la référence.
   */
  private hitTest(sx: number, sy: number): HitResult {
    const zoom = this.cam.zoom
    const wx = this.cam.x + (sx - this.width / 2) / zoom
    const wy = this.cam.y + (sy - this.height / 2) / zoom
    const st = cosmosStore.getState()
    const result = this.hit
    result.kind = 'none'
    result.id = null

    // 1. Planètes (les filtrées par types ne sont pas cliquables).
    let bestD2 = Infinity
    let bestId: string | null = null
    const t = performance.now() / 1000
    for (const sys of layout.systems) {
      const ddx = wx - sys.x
      const ddy = wy - sys.y
      const reach = sys.radius + 24
      if (ddx * ddx + ddy * ddy > reach * reach) continue
      for (const slot of sys.slots) {
        const planet = planetById.get(slot.planetId)
        if (!planet || !st.isPlanetVisible(planet)) continue
        const angle = slot.angle0 + slot.angularSpeed * t
        const px = sys.x + Math.cos(angle) * slot.orbitRadius
        const py = sys.y + Math.sin(angle) * slot.orbitRadius
        const dx = wx - px
        const dy = wy - py
        const thr = Math.max(slot.size, 7 / zoom)
        const d2 = dx * dx + dy * dy
        if (d2 <= thr * thr && d2 < bestD2) {
          bestD2 = d2
          bestId = planet.id
        }
      }
    }
    if (bestId) {
      result.kind = 'planet'
      result.id = bestId
      return result
    }

    // 2. Étoiles.
    let bestStarD2 = Infinity
    let bestStar: string | null = null
    for (const sys of layout.systems) {
      const dx = wx - sys.x
      const dy = wy - sys.y
      const thr = Math.max(sys.starSize * 1.15, 16 / zoom)
      const d2 = dx * dx + dy * dy
      if (d2 <= thr * thr && d2 < bestStarD2) {
        bestStarD2 = d2
        bestStar = sys.categoryId
      }
    }
    if (bestStar) {
      result.kind = 'star'
      result.id = bestStar
    }
    return result
  }

  /** Clic / tap : sélection planète, étoile, ou désélection globale.
   *  En mode ambient, rien n'est cliquable — pas même une désélection. */
  private tapSelect(sx: number, sy: number): void {
    if (this.ambient) return // univers vide : le tap ne touche rien
    this.hitTest(sx, sy)
    const st = cosmosStore.getState()
    if (this.hit.kind === 'planet' && this.hit.id) {
      st.focusPlanet(this.hit.id)
    } else if (this.hit.kind === 'star' && this.hit.id) {
      st.focusCategory(this.hit.id)
    } else {
      st.selectCategory(null)
      st.setDetailOpen(false)
    }
  }

  /** Survol : met à jour hoveredId (si changé) et le curseur.
   *  En mode ambient, aucun survol possible — le curseur reste « grab ». */
  private updateHover(sx: number, sy: number): void {
    if (this.ambient) return
    this.hitTest(sx, sy)
    const st = cosmosStore.getState()
    const id = this.hit.kind === 'none' ? null : this.hit.id
    this.hoverFound = id !== null
    if (st.hoveredId !== id) st.setHovered(id)
    this.updateCursor()
  }

  /* ================================================================== */
  /* Curseur                                                             */
  /* ================================================================== */

  private updateCursor(): void {
    const canvas = this.canvas
    if (!canvas) return
    let cursor = 'grab'
    if (this.pinch.active || (this.gesture.active && this.gesture.dragging)) {
      cursor = 'grabbing'
    } else if (this.hoverFound) {
      cursor = 'pointer'
    }
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor
  }
}
