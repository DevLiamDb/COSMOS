/**
 * COSMOS — Moteur de rendu 3D (Three.js)
 * ======================================
 *
 * Univers interactif : chaque catégorie est une étoile ✦ (sprite dont la
 * texture est rendue sur canvas : caractère U+2726 + halo radial dégradé),
 * entourée de ses planètes en orbite inclinée. Fond noir profond, champ
 * d'étoiles lointaines, brouillard exponentiel pour la profondeur.
 *
 * Univers vide (mode ambiant) : quand le layout n'a aucun système, le
 * moteur rend une scène d'attente centrée sur l'origine — nuage de
 * poussière primordiale en dérive interpolée (lerp ease entre cibles,
 * jamais de bruit), ✦ fantôme doré qui respire, ondes concentriques —
 * avec lente rotation automatique de la caméra, coupée à la première
 * interaction utilisateur.
 *
 * Architecture (contrats worklog Task 1) :
 *  - classe pure (aucun React) : constructeur(container), setActive(bool),
 *    destroy() ; boucle RAF interne qui saute le rendu si inactive ;
 *  - abonnement `cosmosStore` : commandes caméra identifiées par nonce,
 *    commande en attente traitée à l'activation ;
 *  - temps des orbites : performance.now() / 1000 ;
 *  - filtres : cosmosStore.getState().isPlanetVisible(planet).
 *
 * Performance : les 554 planètes sont UN InstancedMesh (1 draw call),
 * les orbites d'un système sont fusionnées en un LineSegments, les labels
 * sont des divs HTML repositionnés par transform (compositor only) et la
 * boucle de rendu n'alloue rien (vecteurs/matrices de travail réutilisés).
 *
 * SSR-safe : aucun accès à window/document au niveau du module.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { hashString, mulberry32, type Rng } from '@/lib/cosmos/rng'
import { hexToRgb } from '@/lib/cosmos/colors'
import { categoryById, cosmosStore, layout, planetById } from '@/lib/cosmos/store'
import type { CameraCommand, CosmosStore } from '@/lib/cosmos/store'
import type { CategoryNode, PlanetNode, PlanetSlot, SystemLayout } from '@/lib/cosmos/types'

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

const BG_COLOR = '#05060a'
const FOG_DENSITY = 0.000085
const STARFIELD_SEED = 4242
const STARFIELD_COUNT = 1800
const STARFIELD_BRIGHT_COUNT = 50
const ORBIT_SEGMENTS = 96
const TAU = Math.PI * 2
/** Rotation lente du sprite ✦ sur lui-même (rad/s) — donne du volume à un
 *  billboard plat sans casser le fait qu'il reste toujours face caméra.
 *  Les catégories prioritaires tournent un peu plus vite, comme un repère. */
const STAR_SPIN_SPEED = 0.16
const STAR_SPIN_SPEED_PRIORITY = 0.3
const LABEL_TEXT_COLOR = 'rgba(236,234,229,0.78)'
const PLANET_LABEL_COLOR = 'rgba(236,234,229,0.9)'
const LABEL_TEXT_SHADOW = '0 1px 10px rgba(0,0,0,0.9)'
/** Rayon (px écran) de la zone de picking des étoiles. */
const STAR_PICK_RADIUS_PX = 26
/** Rayon (px écran) de la zone de picking d'un anneau d'orbite — clic sur
 *  la ligne d'une orbite = focus direct sur sa planète, sans avoir à viser
 *  la sphère (utile pour les petites planètes / orbites serrées). */
const ORBIT_PICK_RADIUS_PX = 9
/** Points échantillonnés par anneau pour le picking (moins que
 *  ORBIT_SEGMENTS qui sert au rendu — suffisant pour une distance écran). */
const ORBIT_PICK_SAMPLES = 24
/** Déplacement (px) au-delà duquel un pointerdown→pointerup devient un drag. */
const CLICK_SLOP_PX = 6
/** Quaternion identité (jamais modifié — utilisé pour composer les matrices). */
const IDENTITY_QUAT = new THREE.Quaternion()

/* ------------------------------------------------------------------ */
/* Mode ambiant (univers vide)                                         */
/* ------------------------------------------------------------------ */

/** Seed déterministe du nuage de poussière primordiale. */
const AMBIENT_DUST_SEED = 9001
/** ~650 particules : mise à jour CPU triviale (typées, préallouées). */
const AMBIENT_DUST_COUNT = 650
/** Disque/Coquille autour de l'origine : rayon 80–750. */
const AMBIENT_DUST_MIN_R = 80
const AMBIENT_DUST_MAX_R = 750
/** Léger étalement vertical (±140). */
const AMBIENT_DUST_MAX_Y = 140
/** Durée de chaque vol interpolé (s) — retarget à l'échéance. */
const AMBIENT_DUST_MIN_DUR = 8
const AMBIENT_DUST_MAX_DUR = 18
/** Taille (unités monde, sizeAttenuation) des points de poussière. */
const AMBIENT_DUST_SIZE = 2.2
const AMBIENT_DUST_OPACITY = 0.85
/** Palette vertex : or chaud majoritaire, blanc doux, quelques braises. */
const AMBIENT_DUST_GOLD = '#e8c476'
const AMBIENT_DUST_WHITE = '#f2ede2'
const AMBIENT_DUST_EMBER = '#c88a5a'
/** ✦ fantôme doré à l'origine (même technique que les étoiles). */
const AMBIENT_GHOST_COLOR = '#d9b36a'
const AMBIENT_GHOST_SCALE = 130
/** Respiration lente : échelle 1 ± 0.06, opacité 0.55–0.8. */
const AMBIENT_GHOST_BREATH_SPEED = 0.5
const AMBIENT_GHOST_SCALE_AMP = 0.06
const AMBIENT_GHOST_OPACITY_MIN = 0.55
const AMBIENT_GHOST_OPACITY_MAX = 0.8
/** Ondes concentriques dans le plan XZ : cycle 7 s, décalage 3.5 s. */
const AMBIENT_RING_COUNT = 2
const AMBIENT_RING_PERIOD = 7
const AMBIENT_RING_DURATION = 6
const AMBIENT_RING_MAX_SCALE = 800
const AMBIENT_RING_MAX_OPACITY = 0.28
const AMBIENT_RING_COLOR = '#d9b36a'
/** Orbite automatique cinématique autour de l'univers vide. */
const AMBIENT_AUTO_ROTATE_SPEED = 0.45

/* ------------------------------------------------------------------ */
/* Helpers purs (aucun accès DOM)                                     */
/* ------------------------------------------------------------------ */

function easeInOutCubic(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
}

function easeOutCubic(k: number): number {
  return 1 - Math.pow(1 - k, 3)
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function clamp01(v: number): number {
  return clamp(v, 0, 1)
}

/** Distance au carré (px écran) entre un point et un segment [a, b]. */
function distSqToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  let t = lenSq > 1e-9 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0
  t = clamp01(t)
  const qx = ax + t * dx
  const qy = ay + t * dy
  const ex = px - qx
  const ey = py - qy
  return ex * ex + ey * ey
}

/**
 * Base orthonormée {u, v} du plan orbital d'un slot.
 * Le cercle local (cos·r, 0, sin·r) est tourné autour de X par tiltX puis
 * autour de Z par tiltZ : p = u·cos(θ)·r + v·sin(θ)·r, avec
 *   u = Rz(tiltZ)·Rx(tiltX)·(1,0,0) = (cos z, sin z, 0)
 *   v = Rz(tiltZ)·Rx(tiltX)·(0,0,1) = (sin x·sin z, -sin x·cos z, cos x)
 */
function orbitalBasis(tiltX: number, tiltZ: number): { u: THREE.Vector3; v: THREE.Vector3 } {
  const cx = Math.cos(tiltX)
  const sx = Math.sin(tiltX)
  const cz = Math.cos(tiltZ)
  const sz = Math.sin(tiltZ)
  return {
    u: new THREE.Vector3(cz, sz, 0),
    v: new THREE.Vector3(sx * sz, -sx * cz, cx),
  }
}

/* ------------------------------------------------------------------ */
/* Textures canvas (appelées uniquement côté client, dans les méthodes) */
/* ------------------------------------------------------------------ */

/**
 * Texture d'étoile ✦ (128 px) : halo radial dégradé dans la couleur de la
 * catégorie, fin liseré, et caractère U+2726 réellement dessiné (fillText)
 * en blanc au centre, avec la police display de l'app.
 */
function drawStarGlyph(
  canvas: HTMLCanvasElement,
  colorHex: string,
  fontDisplay: string,
  priority = false,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, 128, 128)
  const { r, g, b } = hexToRgb(colorHex)

  // Halo radial (dégradé du centre vers l'extérieur, discret) -- une
  // catégorie prioritaire (voir layout.ts::starSize, deja plus grande) a
  // en plus un halo plus intense pour se distinguer meme a distance.
  const boost = priority ? 1.4 : 1
  const halo = ctx.createRadialGradient(64, 64, 0, 64, 64, 62)
  halo.addColorStop(0, `rgba(${r},${g},${b},${Math.min(1, 0.9 * boost)})`)
  halo.addColorStop(0.22, `rgba(${r},${g},${b},${Math.min(0.5, 0.32 * boost)})`)
  halo.addColorStop(0.55, `rgba(${r},${g},${b},${Math.min(0.2, 0.08 * boost)})`)
  halo.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, 128, 128)

  // Fin liseré dans la couleur de la catégorie
  ctx.strokeStyle = `rgba(${r},${g},${b},0.5)`
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(64, 64, 44, 0, TAU)
  ctx.stroke()

  // Caractère ✦ (U+2726) en blanc — vrai fillText
  ctx.font = `600 64px ${fontDisplay}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  ctx.fillText('\u2726', 64, 65)
}

/** Texture d'anneau (cercle blanc strié) pour sélection / highlight. */
function createRingTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'
    ctx.lineWidth = 7
    ctx.beginPath()
    ctx.arc(64, 64, 54, 0, TAU)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(64, 64, 54, 0, TAU)
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/* ------------------------------------------------------------------ */
/* Types internes                                                      */
/* ------------------------------------------------------------------ */

/** Une planète prête à animer : base du plan orbital + position courante. */
interface PlanetEntry {
  slot: PlanetSlot
  planet: PlanetNode
  system: StarSystem
  /** Vecteur u du plan orbital (direction θ = 0). */
  u: THREE.Vector3
  /** Vecteur v du plan orbital (direction θ = π/2). */
  v: THREE.Vector3
  /** Position monde courante (mise à jour chaque frame). */
  pos: THREE.Vector3
  /** Couleur de base (avant atténuation par dimF). */
  baseColor: THREE.Color
  /** Index dans l'InstancedMesh global. */
  instanceIndex: number
}

/** Un système solaire : étoile, orbites, planètes, label, atténuation. */
interface StarSystem {
  sys: SystemLayout
  category: CategoryNode
  /** Centre monde (x, sysY, y→z). */
  center: THREE.Vector3
  entries: PlanetEntry[]
  /** Facteur d'atténuation lissé (1 = normal, 0.3 = atténué). */
  dimF: number
  /** Dernière valeur appliquée (évite les mises à jour inutiles). */
  appliedDimF: number
  sprite: THREE.Sprite
  spriteMat: THREE.SpriteMaterial
  starCanvas: HTMLCanvasElement
  starTexture: THREE.CanvasTexture
  orbitLines: THREE.LineSegments
  orbitMat: THREE.LineBasicMaterial
  label: HTMLDivElement
  labelVisible: boolean
  /** Dernières valeurs écrites dans le DOM (anti-réécriture inutile). */
  lastLX: number
  lastLY: number
  lastLO: number
}

/** Tween caméra (position + cible, easing, callbacks optionnels). */
interface CameraTween {
  fromPos: THREE.Vector3
  fromTarget: THREE.Vector3
  toPos: THREE.Vector3
  toTarget: THREE.Vector3
  startTime: number
  duration: number
  easing: (k: number) => number
  /** Recalcule toPos/toTarget chaque frame (cibles mobiles : planètes). */
  refresh?: (tween: CameraTween) => void
  onDone?: () => void
}

interface PickResult {
  planetId: string | null
  categoryId: string | null
}

/**
 * Scène du mode ambiant (univers vide) : nuage de poussière primordiale
 * animé par interpolation, ✦ fantôme doré à l'origine et ondes
 * concentriques lentes. Tout est préalloué — la boucle n'alloue rien.
 */
interface AmbientScene {
  /* Nuage de poussière (dérive interpolée start → cible) */
  dust: THREE.Points
  dustGeo: THREE.BufferGeometry
  dustMat: THREE.PointsMaterial
  dustPosAttr: THREE.BufferAttribute
  dustPos: Float32Array
  dustStart: Float32Array
  dustTarget: Float32Array
  /** Instants de départ des vols (s). */
  dustT0: Float32Array
  /** Durées des vols (s). */
  dustDur: Float32Array
  /** rng déterministe (nouvelles cibles au retarget). */
  rng: Rng
  /* ✦ fantôme */
  ghost: THREE.Sprite
  ghostMat: THREE.SpriteMaterial
  ghostCanvas: HTMLCanvasElement
  ghostTexture: THREE.CanvasTexture
  /* Ondes : géométrie partagée, un matériau par anneau (opacités distinctes) */
  ringGeo: THREE.RingGeometry
  rings: THREE.Mesh[]
  ringMats: THREE.MeshBasicMaterial[]
  /** Naissance des ondes (s) — phases ancrées à la construction. */
  ringT0: number
}

/* ------------------------------------------------------------------ */
/* Moteur                                                              */
/* ------------------------------------------------------------------ */

export class Engine3D {
  /* --- DOM / rendu ------------------------------------------------- */
  private readonly container: HTMLElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly resizeObserver: ResizeObserver
  private readonly labelOverlay: HTMLDivElement
  private readonly planetLabel: HTMLDivElement

  /* --- contenu 3D --------------------------------------------------- */
  private readonly starfield: THREE.Group
  private readonly starfieldGeos: THREE.BufferGeometry[] = []
  private readonly starfieldMats: THREE.PointsMaterial[] = []
  private readonly systems: StarSystem[] = []
  private readonly systemByCategoryId = new Map<string, StarSystem>()
  private readonly entryByPlanetId = new Map<string, PlanetEntry>()
  private readonly planetIdByInstance: string[] = []
  private readonly planetMesh: THREE.InstancedMesh
  private readonly planetGeo: THREE.SphereGeometry
  private readonly planetMat: THREE.MeshLambertMaterial
  private readonly ringTexture: THREE.CanvasTexture
  private readonly selRing: THREE.Sprite
  private readonly selRingMat: THREE.SpriteMaterial
  private readonly hlRing: THREE.Sprite
  private readonly hlRingMat: THREE.SpriteMaterial

  /* --- mode ambiant (univers vide) ----------------------------------- */
  /** Vrai ssi l'univers est vide à la construction (détection unique). */
  private readonly ambientEmpty: boolean
  private readonly ambient: AmbientScene | null = null

  /* --- caméra / état ------------------------------------------------ */
  private readonly globalCamPos = new THREE.Vector3()
  private readonly globalTarget = new THREE.Vector3()
  private readonly followPrev = new THREE.Vector3()
  private tween: CameraTween | null = null
  private followId: string | null = null
  private lastCameraNonce = 0

  /* --- objets de travail (aucune allocation dans la boucle) --------- */
  private readonly sVecA = new THREE.Vector3()
  private readonly sVecB = new THREE.Vector3()
  private readonly sVecC = new THREE.Vector3()
  private readonly sMat = new THREE.Matrix4()
  private readonly sScale = new THREE.Vector3()
  private readonly sColor = new THREE.Color()
  private readonly sNdc = new THREE.Vector2()
  private readonly raycaster = new THREE.Raycaster()
  private readonly pickResult: PickResult = { planetId: null, categoryId: null }

  /* --- divers -------------------------------------------------------- */
  private fontDisplay = 'sans-serif'
  private readonly unsubscribe: () => void
  private raf = 0
  private active = false
  private destroyed = false
  private lastTime = 0
  private width = 1
  private height = 1
  private selRingPlanetId: string | null = null
  private hlPlanetId: string | null = null
  private planetLabelPlanetId: string | null = null
  private planetLabelVisible = false
  private hoveredId: string | null = null

  /* --- pointeur ------------------------------------------------------ */
  private pointerActive = 0
  private pointerDown = false
  private pointerDragging = false
  private downX = 0
  private downY = 0

  constructor(container: HTMLElement) {
    this.container = container
    this.fontDisplay = this.resolveDisplayFont()

    /* Renderer ------------------------------------------------------- */
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.domElement.style.display = 'block'
    container.appendChild(this.renderer.domElement)

    /* Scène, caméra, lumières ---------------------------------------- */
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(BG_COLOR)
    this.scene.fog = new THREE.FogExp2(BG_COLOR, FOG_DENSITY)

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.5, 14000)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const sun = new THREE.DirectionalLight(0xfff3e0, 1.0)
    sun.position.set(400, 900, 250)
    this.scene.add(sun)

    /* Champ d'étoiles -------------------------------------------------- */
    // Un seul rng seedé (4242), consommé séquentiellement par les deux
    // couches : déterministe et sans recouvrement des positions.
    const starfieldRng = mulberry32(STARFIELD_SEED)
    this.starfield = new THREE.Group()
    this.starfield.add(this.createStarLayer(starfieldRng, STARFIELD_COUNT, 1.7, 0.8, false))
    this.starfield.add(this.createStarLayer(starfieldRng, STARFIELD_BRIGHT_COUNT, 3, 0.35, true))
    this.scene.add(this.starfield)

    /* Planètes : InstancedMesh global ---------------------------------- */
    this.ambientEmpty = layout.systems.length === 0
    this.planetGeo = new THREE.SphereGeometry(1, 18, 12)
    this.planetMat = new THREE.MeshLambertMaterial({ color: 0xffffff })
    let total = 0
    for (const sys of layout.systems) {
      for (const slot of sys.slots) if (planetById.has(slot.planetId)) total++
    }
    this.planetMesh = new THREE.InstancedMesh(this.planetGeo, this.planetMat, Math.max(1, total))
    this.planetMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.planetMesh.frustumCulled = false // instances mobiles, bounds gérés manuellement
    // Univers vide : l'instance de remplacement (count ≥ 1) ne doit pas
    // rendre de sphère parasite à l'origine.
    this.planetMesh.visible = total > 0
    this.scene.add(this.planetMesh)

    /* Anneaux sélection / highlight ------------------------------------ */
    this.ringTexture = createRingTexture()
    this.selRingMat = new THREE.SpriteMaterial({
      map: this.ringTexture,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    })
    this.selRing = new THREE.Sprite(this.selRingMat)
    this.selRing.visible = false
    this.scene.add(this.selRing)
    this.hlRingMat = new THREE.SpriteMaterial({
      map: this.ringTexture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    this.hlRing = new THREE.Sprite(this.hlRingMat)
    this.hlRing.visible = false
    this.scene.add(this.hlRing)

    /* Calque de labels HTML -------------------------------------------- */
    this.labelOverlay = document.createElement('div')
    this.labelOverlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;'
    this.planetLabel = document.createElement('div')
    this.planetLabel.style.cssText =
      'position:absolute;left:0;top:0;pointer-events:none;white-space:nowrap;' +
      'font-family:var(--font-sans);font-size:11px;letter-spacing:0.02em;' +
      `color:${PLANET_LABEL_COLOR};text-shadow:${LABEL_TEXT_SHADOW};` +
      'will-change:transform,opacity;opacity:0;visibility:hidden;'
    this.labelOverlay.appendChild(this.planetLabel)
    container.appendChild(this.labelOverlay)

    /* Systèmes solaires ------------------------------------------------ */
    this.buildSystems()

    /* Univers vide : scène ambiante à la place (poussière, ✦, ondes) ---- */
    if (this.ambientEmpty) {
      this.ambient = this.buildAmbient(performance.now() / 1000)
    }

    /* Contrôles --------------------------------------------------------- */
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.07
    this.controls.rotateSpeed = 0.55
    this.controls.zoomSpeed = 0.9
    this.controls.screenSpacePanning = false
    this.controls.minDistance = 10
    this.controls.maxDistance = 9000
    this.controls.minPolarAngle = Math.PI * 0.06
    this.controls.maxPolarAngle = Math.PI * 0.94
    this.controls.addEventListener('start', this.onUserInteract)

    /* Mode ambiant : lente orbite cinématique autour du vide ------------ */
    if (this.ambientEmpty) {
      this.controls.autoRotate = true
      this.controls.autoRotateSpeed = AMBIENT_AUTO_ROTATE_SPEED
    }

    /* Caméra initiale : cadrage global + ouverture cinématique ---------- */
    this.computeGlobalCamera(this.globalCamPos, this.globalTarget)
    this.controls.target.copy(this.globalTarget)
    this.camera.position
      .copy(this.globalCamPos)
      .sub(this.globalTarget)
      .multiplyScalar(1.25)
      .add(this.globalTarget)
    this.camera.lookAt(this.globalTarget)
    this.animateCamera(this.globalCamPos, this.globalTarget, 2400, easeOutCubic)

    /* Interactions (listeners non bloquants, OrbitControls intact) ------ */
    const dom = this.renderer.domElement
    dom.addEventListener('pointerdown', this.onPointerDown, { passive: true })
    dom.addEventListener('pointermove', this.onPointerMove, { passive: true })
    dom.addEventListener('pointerup', this.onPointerUp, { passive: true })
    dom.addEventListener('pointerleave', this.onPointerLeave, { passive: true })

    /* Resize ------------------------------------------------------------- */
    this.resizeObserver = new ResizeObserver(() => this.onResize())
    this.resizeObserver.observe(container)
    this.onResize()

    /* Store : commandes caméra ------------------------------------------- */
    this.unsubscribe = cosmosStore.subscribe((s, prev) => {
      // Inactif : la commande reste en attente (traitée à l'activation).
      if (s.camera.nonce !== prev.camera.nonce && this.active) {
        this.processCameraCommand(s.camera)
      }
    })

    /* Webfonts : régénérer les textures ✦ une fois la police chargée ----- */
    if (typeof document !== 'undefined' && document.fonts) {
      void document.fonts.ready.then(() => {
        if (!this.destroyed) this.refreshStarTextures()
      })
    }

    /* Boucle RAF ---------------------------------------------------------- */
    this.lastTime = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  /* ------------------------------------------------------------------ */
  /* Cycle de vie                                                        */
  /* ------------------------------------------------------------------ */

  setActive(active: boolean): void {
    if (this.destroyed || this.active === active) {
      if (!this.destroyed && active) this.processPendingCamera()
      return
    }
    this.active = active
    if (!active) return

    this.lastTime = performance.now()

    // Tween en cours créé pendant l'inactivité : on le rejoue depuis l'état
    // courant (l'ouverture d'intro ne doit pas être « sautée »).
    if (this.tween) {
      this.tween.fromPos.copy(this.camera.position)
      this.tween.fromTarget.copy(this.controls.target)
      this.tween.startTime = performance.now()
    }

    // Re-synchroniser le suivi de planète (les orbites ont continué à tourner).
    if (this.followId) {
      const entry = this.entryByPlanetId.get(this.followId)
      if (entry) {
        this.planetPositionAt(entry, performance.now() / 1000, this.followPrev)
      } else {
        this.followId = null
      }
    }

    this.processPendingCamera()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    this.unsubscribe()

    const dom = this.renderer.domElement
    dom.removeEventListener('pointerdown', this.onPointerDown)
    dom.removeEventListener('pointermove', this.onPointerMove)
    dom.removeEventListener('pointerup', this.onPointerUp)
    dom.removeEventListener('pointerleave', this.onPointerLeave)
    this.controls.removeEventListener('start', this.onUserInteract)
    this.controls.dispose()

    // Géométries, matériaux, textures
    this.planetGeo.dispose()
    this.planetMat.dispose()
    for (const sys of this.systems) {
      sys.orbitLines.geometry.dispose()
      sys.orbitMat.dispose()
      sys.spriteMat.dispose()
      sys.starTexture.dispose()
    }
    // Mode ambiant : même rigueur (géométries, matériaux, texture).
    if (this.ambient) {
      this.ambient.dustGeo.dispose()
      this.ambient.dustMat.dispose()
      this.ambient.ghostTexture.dispose()
      this.ambient.ghostMat.dispose()
      this.ambient.ringGeo.dispose()
      for (const mat of this.ambient.ringMats) mat.dispose()
    }
    for (const geo of this.starfieldGeos) geo.dispose()
    for (const mat of this.starfieldMats) mat.dispose()
    this.ringTexture.dispose()
    this.selRingMat.dispose()
    this.hlRingMat.dispose()

    this.renderer.dispose()
    this.renderer.forceContextLoss()

    // Retrait du DOM
    if (dom.parentNode === this.container) this.container.removeChild(dom)
    if (this.labelOverlay.parentNode === this.container) {
      this.container.removeChild(this.labelOverlay)
    }
    this.scene.clear()
  }

  /* ------------------------------------------------------------------ */
  /* Boucle de rendu                                                     */
  /* ------------------------------------------------------------------ */

  private readonly tick = (): void => {
    if (this.destroyed) return
    this.raf = requestAnimationFrame(this.tick)

    const now = performance.now()
    const dt = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000))
    this.lastTime = now
    if (!this.active) return

    const t = now / 1000
    const state = cosmosStore.getState()

    // 1. Caméra : tween (contrôles désactivés) OU contrôles utilisateur.
    //    dt transmis à update() : vitesse d'autoRotate indépendante du
    //    refresh rate (le damping, lui, reste strictement identique).
    if (this.tween) this.updateTween(now)
    else this.controls.update(dt)

    // 2. Positions des planètes + matrices d'instances.
    this.updatePlanets(state, t)

    // 3. Suivi de planète (delta appliqué à caméra et cible).
    if (!this.tween && this.followId) {
      const entry = this.entryByPlanetId.get(this.followId)
      if (entry) {
        this.sVecA.copy(entry.pos).sub(this.followPrev)
        if (this.sVecA.lengthSq() > 0) {
          this.camera.position.add(this.sVecA)
          this.controls.target.add(this.sVecA)
        }
        this.followPrev.copy(entry.pos)
      } else {
        this.followId = null
      }
    }

    // 4. Atténuation par système + LOD des orbites.
    this.updateDimming(state, dt)

    // 5. Rotation très lente du champ d'étoiles.
    this.starfield.rotation.y += dt * 0.0035

    // 6. Mode ambiant : poussière interpolée, ✦ fantôme, ondes.
    if (this.ambient) this.updateAmbient(t)

    // 7. Anneaux de sélection / highlight.
    this.updateRings(state, t, now)

    // 8. Rendu (met à jour les matrices de la caméra).
    this.renderer.render(this.scene, this.camera)

    // 9. Labels HTML (après le rendu : projections à jour).
    this.updateLabels(state, now)
  }

  private updateTween(now: number): void {
    const tw = this.tween
    if (!tw) return
    if (tw.refresh) tw.refresh(tw)
    const k = clamp((now - tw.startTime) / tw.duration, 0, 1)
    const e = tw.easing(k)
    this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e)
    this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e)
    this.camera.lookAt(this.controls.target)
    if (k >= 1) {
      this.tween = null
      this.controls.enabled = true
      if (tw.onDone) tw.onDone()
    }
  }

  /* ------------------------------------------------------------------ */
  /* Construction du contenu                                             */
  /* ------------------------------------------------------------------ */

  private buildSystems(): void {
    const bgColor = new THREE.Color(BG_COLOR)
    const orbitColor = new THREE.Color()
    let instanceIndex = 0

    for (const sys of layout.systems) {
      const category = categoryById.get(sys.categoryId)
      if (!category) continue

      // Élévation 3D déterministe par catégorie (±130 max).
      const sysY = ((hashString(sys.categoryId) % 2048) / 2048 - 0.5) * 260
      const center = new THREE.Vector3(sys.x, sysY, sys.y)

      /* Étoile ✦ : sprite texte pré-rendu ------------------------------ */
      const starCanvas = document.createElement('canvas')
      starCanvas.width = 128
      starCanvas.height = 128
      drawStarGlyph(starCanvas, category.color, this.fontDisplay, category.priority)
      const starTexture = new THREE.CanvasTexture(starCanvas)
      starTexture.colorSpace = THREE.SRGBColorSpace
      const spriteMat = new THREE.SpriteMaterial({
        map: starTexture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.92,
      })
      const sprite = new THREE.Sprite(spriteMat)
      sprite.position.copy(center)
      const starScale = sys.starSize * 2.4
      sprite.scale.set(starScale, starScale, 1)
      this.scene.add(sprite)

      /* Label HTML de l'étoile ------------------------------------------ */
      const label = document.createElement('div')
      label.style.cssText =
        'position:absolute;left:0;top:0;pointer-events:none;white-space:nowrap;text-align:center;' +
        'font-family:var(--font-display);font-size:11px;letter-spacing:0.1em;' +
        `color:${LABEL_TEXT_COLOR};text-shadow:${LABEL_TEXT_SHADOW};` +
        'will-change:transform,opacity;opacity:0;visibility:hidden;'
      label.appendChild(document.createTextNode(category.name))
      const sub = document.createElement('span')
      sub.style.cssText = 'display:block;font-size:9.5px;letter-spacing:0.08em;opacity:0.52;margin-top:1px;'
      sub.textContent = sys.slots.length > 1 ? `${sys.slots.length} planètes` : '1 planète'
      label.appendChild(sub)
      this.labelOverlay.appendChild(label)

      /* Orbites : un seul LineSegments fusionné pour tout le système ---- */
      const segTotal = sys.slots.length * ORBIT_SEGMENTS
      const linePos = new Float32Array(segTotal * 6)
      const lineCol = new Float32Array(segTotal * 6)
      let w = 0
      const entries: PlanetEntry[] = []

      const system: StarSystem = {
        sys,
        category,
        center,
        entries,
        dimF: 1,
        appliedDimF: 1,
        sprite,
        spriteMat,
        starCanvas,
        starTexture,
        orbitLines: null as unknown as THREE.LineSegments,
        orbitMat: null as unknown as THREE.LineBasicMaterial,
        label,
        labelVisible: false,
        lastLX: -1e9,
        lastLY: -1e9,
        lastLO: -1,
      }

      for (const slot of sys.slots) {
        const basis = orbitalBasis(slot.tiltX, slot.tiltZ)
        const r = slot.orbitRadius
        // Cercle de 96 segments dans le plan orbital incliné.
        for (let k = 0; k < ORBIT_SEGMENTS; k++) {
          const a0 = (k / ORBIT_SEGMENTS) * TAU
          const a1 = ((k + 1) / ORBIT_SEGMENTS) * TAU
          const c0 = Math.cos(a0) * r
          const s0 = Math.sin(a0) * r
          const c1 = Math.cos(a1) * r
          const s1 = Math.sin(a1) * r
          linePos[w] = center.x + basis.u.x * c0 + basis.v.x * s0
          linePos[w + 1] = center.y + basis.u.y * c0 + basis.v.y * s0
          linePos[w + 2] = center.z + basis.u.z * c0 + basis.v.z * s0
          linePos[w + 3] = center.x + basis.u.x * c1 + basis.v.x * s1
          linePos[w + 4] = center.y + basis.u.y * c1 + basis.v.y * s1
          linePos[w + 5] = center.z + basis.u.z * c1 + basis.v.z * s1
          w += 6
        }

        const planet = planetById.get(slot.planetId)
        if (!planet) continue
        const entry: PlanetEntry = {
          slot,
          planet,
          system,
          u: basis.u,
          v: basis.v,
          pos: new THREE.Vector3(),
          baseColor: new THREE.Color(planet.color),
          instanceIndex: instanceIndex++,
        }
        this.planetMesh.setColorAt(entry.instanceIndex, entry.baseColor)
        this.planetIdByInstance[entry.instanceIndex] = slot.planetId
        this.entryByPlanetId.set(slot.planetId, entry)
        entries.push(entry)
      }

      // Couleur des vertex : couleur catégorie mélangée au fond (ratio 0.16).
      orbitColor.set(category.color).lerp(bgColor, 0.16)
      for (let i = 0; i < segTotal * 2; i++) {
        lineCol[i * 3] = orbitColor.r
        lineCol[i * 3 + 1] = orbitColor.g
        lineCol[i * 3 + 2] = orbitColor.b
      }

      const lineGeo = new THREE.BufferGeometry()
      lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3))
      lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3))
      const orbitMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 })
      const orbitLines = new THREE.LineSegments(lineGeo, orbitMat)
      this.scene.add(orbitLines)
      system.orbitLines = orbitLines
      system.orbitMat = orbitMat

      this.systems.push(system)
      this.systemByCategoryId.set(sys.categoryId, system)
    }

    if (this.planetMesh.instanceColor) {
      this.planetMesh.instanceColor.needsUpdate = true
    }
    // Matrices initiales : échelle 0 partout (remplacées à la première frame).
    const zero = new THREE.Matrix4().makeScale(0, 0, 0)
    for (let i = 0; i < this.planetMesh.count; i++) this.planetMesh.setMatrixAt(i, zero)
    this.planetMesh.instanceMatrix.needsUpdate = true
  }

  /** Une couche du champ d'étoiles (coquille sphérique 2800–5800). */
  private createStarLayer(
    rng: Rng,
    count: number,
    size: number,
    opacity: number,
    bright: boolean,
  ): THREE.Points {
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const cosTheta = rng.float(-1, 1)
      const phi = rng.float(0, Math.PI * 2)
      const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta))
      const radius = rng.float(2800, 5800)
      positions[i * 3] = sinTheta * Math.cos(phi) * radius
      positions[i * 3 + 1] = cosTheta * radius
      positions[i * 3 + 2] = sinTheta * Math.sin(phi) * radius
      // Blanc cassé avec variations chaudes / froides subtiles.
      const base = bright ? 0.82 + rng.next() * 0.18 : 0.38 + rng.next() * 0.58
      const temp = (rng.next() - 0.5) * (bright ? 0.5 : 0.4)
      colors[i * 3] = clamp01(base * (1 + temp * 0.32))
      colors[i * 3 + 1] = clamp01(base * (1 - Math.abs(temp) * 0.06))
      colors[i * 3 + 2] = clamp01(base * (1 - temp * 0.32))
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const mat = new THREE.PointsMaterial({
      size,
      sizeAttenuation: false,
      transparent: true,
      opacity,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.starfieldGeos.push(geo)
    this.starfieldMats.push(mat)
    return new THREE.Points(geo, mat)
  }

  /* ------------------------------------------------------------------ */
  /* Mode ambiant (univers vide)                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Construit la scène ambiante rendue à la place des systèmes quand
   * l'univers est vide : nuage de poussière primordiale en dérive
   * interpolée (aucun bruit — uniquement des lerps eases entre cibles),
   * ✦ fantôme doré qui respire à l'origine, ondes concentriques.
   */
  private buildAmbient(nowSec: number): AmbientScene {
    /* Nuage de poussière ----------------------------------------------- */
    const rng = mulberry32(AMBIENT_DUST_SEED)
    const count = AMBIENT_DUST_COUNT
    const pos = new Float32Array(count * 3)
    const start = new Float32Array(count * 3)
    const target = new Float32Array(count * 3)
    const t0 = new Float32Array(count)
    const dur = new Float32Array(count)
    const colors = new Float32Array(count * 3)
    const gold = new THREE.Color(AMBIENT_DUST_GOLD)
    const white = new THREE.Color(AMBIENT_DUST_WHITE)
    const ember = new THREE.Color(AMBIENT_DUST_EMBER)
    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      this.ambientDustPoint(rng, start, i3)
      this.ambientDustPoint(rng, target, i3)
      dur[i] = rng.float(AMBIENT_DUST_MIN_DUR, AMBIENT_DUST_MAX_DUR)
      // Vols déjà entamés : le nuage est vivant dès la première frame.
      t0[i] = nowSec - rng.float(0, dur[i])
      // Majorité or chaud, puis blanc doux, quelques braises — plus une
      // légère variation de luminosité pour la profondeur.
      const roll = rng.next()
      const c = roll < 0.7 ? gold : roll < 0.92 ? white : ember
      const shade = 0.85 + rng.next() * 0.3
      colors[i3] = clamp01(c.r * shade)
      colors[i3 + 1] = clamp01(c.g * shade)
      colors[i3 + 2] = clamp01(c.b * shade)
      pos[i3] = start[i3]
      pos[i3 + 1] = start[i3 + 1]
      pos[i3 + 2] = start[i3 + 2]
    }
    const dustGeo = new THREE.BufferGeometry()
    const dustPosAttr = new THREE.BufferAttribute(pos, 3)
    dustPosAttr.setUsage(THREE.DynamicDrawUsage)
    dustGeo.setAttribute('position', dustPosAttr)
    dustGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const dustMat = new THREE.PointsMaterial({
      size: AMBIENT_DUST_SIZE,
      sizeAttenuation: true,
      transparent: true,
      opacity: AMBIENT_DUST_OPACITY,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const dust = new THREE.Points(dustGeo, dustMat)
    dust.frustumCulled = false // positions animées chaque frame
    this.scene.add(dust)

    /* ✦ fantôme à l'origine -------------------------------------------- */
    const ghostCanvas = document.createElement('canvas')
    ghostCanvas.width = 128
    ghostCanvas.height = 128
    drawStarGlyph(ghostCanvas, AMBIENT_GHOST_COLOR, this.fontDisplay)
    const ghostTexture = new THREE.CanvasTexture(ghostCanvas)
    ghostTexture.colorSpace = THREE.SRGBColorSpace
    const ghostMat = new THREE.SpriteMaterial({
      map: ghostTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: (AMBIENT_GHOST_OPACITY_MIN + AMBIENT_GHOST_OPACITY_MAX) / 2,
    })
    const ghost = new THREE.Sprite(ghostMat)
    ghost.scale.set(AMBIENT_GHOST_SCALE, AMBIENT_GHOST_SCALE, 1)
    this.scene.add(ghost)

    /* Ondes concentriques (à plat dans le plan XZ, y = 0) --------------- */
    const ringGeo = new THREE.RingGeometry(0.96, 1.0, 128)
    const rings: THREE.Mesh[] = []
    const ringMats: THREE.MeshBasicMaterial[] = []
    for (let i = 0; i < AMBIENT_RING_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: AMBIENT_RING_COLOR,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      const ring = new THREE.Mesh(ringGeo, mat)
      ring.rotation.x = -Math.PI / 2
      ring.visible = false
      this.scene.add(ring)
      rings.push(ring)
      ringMats.push(mat)
    }

    return {
      dust,
      dustGeo,
      dustMat,
      dustPosAttr,
      dustPos: pos,
      dustStart: start,
      dustTarget: target,
      dustT0: t0,
      dustDur: dur,
      rng,
      ghost,
      ghostMat,
      ghostCanvas,
      ghostTexture,
      ringGeo,
      rings,
      ringMats,
      ringT0: nowSec,
    }
  }

  /** Écrit une position du nuage (coquille/disque autour de l'origine) dans arr[i…i+2]. */
  private ambientDustPoint(rng: Rng, arr: Float32Array, i: number): void {
    const angle = rng.float(0, TAU)
    // Racine carrée : densité surfacique homogène du centre vers le bord.
    const r = Math.sqrt(
      rng.float(AMBIENT_DUST_MIN_R * AMBIENT_DUST_MIN_R, AMBIENT_DUST_MAX_R * AMBIENT_DUST_MAX_R),
    )
    arr[i] = Math.cos(angle) * r
    arr[i + 1] = rng.float(-AMBIENT_DUST_MAX_Y, AMBIENT_DUST_MAX_Y)
    arr[i + 2] = Math.sin(angle) * r
  }

  /**
   * Animation du mode ambiant — 100 % interpolation, zéro jitter :
   *  - poussière : position = lerp(start, cible, easeInOutCubic(p)) ;
   *    à p ≥ 1, l'ancienne cible devient le nouveau départ et une nouvelle
   *    cible déterministe est tirée (durée 8–18 s) ;
   *  - ✦ fantôme : respiration lente (échelle ±6 %, opacité 0.55–0.8) ;
   *  - ondes : expansion 0 → max en easeOutCubic, opacité (1−p)·max,
   *    cycles décalés (période 7 s, second anneau décalé de 3.5 s).
   */
  private updateAmbient(t: number): void {
    const a = this.ambient
    if (!a) return

    /* Poussière primordiale -------------------------------------------- */
    const pos = a.dustPos
    const start = a.dustStart
    const target = a.dustTarget
    const t0 = a.dustT0
    const dur = a.dustDur
    const rng = a.rng
    for (let i = 0; i < AMBIENT_DUST_COUNT; i++) {
      const i3 = i * 3
      let p = (t - t0[i]) / dur[i]
      if (p >= 1) {
        // Vol terminé : la cible devient le départ, nouvelle cible tirée.
        start[i3] = target[i3]
        start[i3 + 1] = target[i3 + 1]
        start[i3 + 2] = target[i3 + 2]
        this.ambientDustPoint(rng, target, i3)
        t0[i] = t
        dur[i] = rng.float(AMBIENT_DUST_MIN_DUR, AMBIENT_DUST_MAX_DUR)
        p = 0
      } else if (p < 0) {
        p = 0
      }
      const e = easeInOutCubic(p)
      pos[i3] = start[i3] + (target[i3] - start[i3]) * e
      pos[i3 + 1] = start[i3 + 1] + (target[i3 + 1] - start[i3 + 1]) * e
      pos[i3 + 2] = start[i3 + 2] + (target[i3 + 2] - start[i3 + 2]) * e
    }
    a.dustPosAttr.needsUpdate = true

    /* ✦ fantôme : respiration + rotation lente --------------------------- */
    const breath = Math.sin(t * AMBIENT_GHOST_BREATH_SPEED)
    const gs = AMBIENT_GHOST_SCALE * (1 + AMBIENT_GHOST_SCALE_AMP * breath)
    a.ghost.scale.set(gs, gs, 1)
    a.ghostMat.rotation = t * STAR_SPIN_SPEED
    const oMid = (AMBIENT_GHOST_OPACITY_MIN + AMBIENT_GHOST_OPACITY_MAX) / 2
    const oAmp = (AMBIENT_GHOST_OPACITY_MAX - AMBIENT_GHOST_OPACITY_MIN) / 2
    a.ghostMat.opacity = oMid + oAmp * breath

    /* Ondes concentriques ----------------------------------------------- */
    for (let i = 0; i < a.rings.length; i++) {
      const offset = (i * AMBIENT_RING_PERIOD) / a.rings.length
      let phase = (t - a.ringT0 - offset) % AMBIENT_RING_PERIOD
      if (phase < 0) phase += AMBIENT_RING_PERIOD
      const k = phase / AMBIENT_RING_DURATION
      const ring = a.rings[i]
      if (k >= 1) {
        // Onde éteinte jusqu'au prochain cycle.
        if (ring.visible) ring.visible = false
        continue
      }
      const s = AMBIENT_RING_MAX_SCALE * easeOutCubic(k)
      ring.scale.set(s, s, s)
      ring.visible = true
      a.ringMats[i].opacity = (1 - k) * AMBIENT_RING_MAX_OPACITY
    }
  }

  /* ------------------------------------------------------------------ */
  /* Polices / textures d'étoiles                                        */
  /* ------------------------------------------------------------------ */

  /** Résout var(--font-display) en une famille utilisable par canvas. */
  private resolveDisplayFont(): string {
    try {
      const raw = getComputedStyle(this.container).getPropertyValue('--font-display').trim()
      if (!raw) return 'sans-serif'
      const families = raw
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean)
        .map((f) => `"${f.replace(/["']/g, '')}"`)
      return families.length > 0 ? families.join(', ') : 'sans-serif'
    } catch {
      return 'sans-serif'
    }
  }

  /** Redessine les textures ✦ (après chargement des webfonts). */
  private refreshStarTextures(): void {
    this.fontDisplay = this.resolveDisplayFont()
    for (const sys of this.systems) {
      drawStarGlyph(sys.starCanvas, sys.category.color, this.fontDisplay, sys.category.priority)
      sys.starTexture.needsUpdate = true
    }
    // Mode ambiant : le ✦ fantôme profite du même rafraîchissement.
    if (this.ambient) {
      drawStarGlyph(this.ambient.ghostCanvas, AMBIENT_GHOST_COLOR, this.fontDisplay)
      this.ambient.ghostTexture.needsUpdate = true
    }
  }

  /* ------------------------------------------------------------------ */
  /* Commandes caméra                                                    */
  /* ------------------------------------------------------------------ */

  private processPendingCamera(): void {
    const s = cosmosStore.getState()
    if (s.camera.nonce !== this.lastCameraNonce) {
      this.processCameraCommand(s.camera)
    }
  }

  /**
   * Cadre l'univers entier : R = sphère englobante des bounds (+ rayon du
   * plus grand système), d = R / tan(fov/2) × 1.12. La distance est bornée
   * par maxDistance d'OrbitControls (contrainte de la spec) — le cadrage
   * reste directionnellement identique.
   */
  private computeGlobalCamera(outPos: THREE.Vector3, outTarget: THREE.Vector3): void {
    const b = layout.bounds
    const halfW = (b.maxX - b.minX) / 2
    const halfH = (b.maxY - b.minY) / 2
    let maxRadius = 0
    for (const sys of layout.systems) maxRadius = Math.max(maxRadius, sys.radius)
    const R = Math.hypot(halfW, halfH) + maxRadius
    const d = (R / Math.tan(((this.camera.fov * Math.PI) / 180) / 2)) * 1.12
    outTarget.set(0, 0, 0)
    outPos.set(0, d * 0.62, d * 0.83)
    const len = outPos.length()
    const maxLen = this.controls.maxDistance * 0.985
    if (len > maxLen) outPos.multiplyScalar(maxLen / len)
  }

  /**
   * Démarre un tween caméra. Une nouvelle commande pendant un tween
   * redémarre depuis l'état courant (fromPos = position actuelle).
   */
  private animateCamera(
    toPos: THREE.Vector3,
    toTarget: THREE.Vector3,
    durationMs: number,
    easing: (k: number) => number = easeInOutCubic,
    opts?: { refresh?: (tween: CameraTween) => void; onDone?: () => void },
  ): CameraTween {
    const tween: CameraTween = {
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: toPos.clone(),
      toTarget: toTarget.clone(),
      startTime: performance.now(),
      duration: Math.max(1, durationMs),
      easing,
      refresh: opts?.refresh,
      onDone: opts?.onDone,
    }
    this.tween = tween
    this.controls.enabled = false
    return tween
  }

  private processCameraCommand(cmd: CameraCommand): void {
    this.lastCameraNonce = cmd.nonce

    /* Zoom incrémental : petit tween 320 ms, conserve le suivi éventuel -- */
    if (cmd.kind === 'zoom-in' || cmd.kind === 'zoom-out') {
      const factor = cmd.kind === 'zoom-in' ? 0.72 : 1.35
      const followEntry = this.followId ? this.entryByPlanetId.get(this.followId) : undefined
      const offset = this.camera.position.clone().sub(this.controls.target)
      let len = offset.length()
      if (len < 1e-6) {
        offset.set(0.4, 0.3, 0.86)
        len = 1
      }
      const targetLen = clamp(len * factor, this.controls.minDistance, this.controls.maxDistance)
      offset.multiplyScalar(targetLen / len)
      const toTarget = this.controls.target.clone()
      const toPos = toTarget.clone().add(offset)
      this.animateCamera(toPos, toTarget, 320, easeInOutCubic, followEntry
        ? {
            refresh: (tw) => {
              this.planetPositionAt(followEntry, performance.now() / 1000, this.sVecB)
              tw.toTarget.copy(this.sVecB)
              tw.toPos.copy(this.sVecB).add(offset)
            },
            onDone: () => {
              this.followPrev.copy(followEntry.pos)
            },
          }
        : undefined)
      return
    }

    this.followId = null

    if (cmd.kind === 'global') {
      this.animateCamera(this.globalCamPos, this.globalTarget, 1600)
      return
    }

    if (cmd.kind === 'category') {
      const target = cmd.targetId ? this.systemByCategoryId.get(cmd.targetId) : undefined
      if (!target) return
      const d = target.sys.radius * 2.7
      const toTarget = target.center.clone()
      const toPos = new THREE.Vector3(
        target.center.x + d * 0.3,
        target.center.y + d * 0.5,
        target.center.z + d * 0.85,
      )
      this.animateCamera(toPos, toTarget, 1000)
      return
    }

    if (cmd.kind === 'pan') {
      // Clic sur la mini-carte : translation du couple caméra/cible, même
      // décalage conservé (zoom et angle inchangés) -- convention 2D→3D du
      // layout (x→x, y→z), l'élévation courante (y) n'est pas modifiée.
      if (!cmd.world) return
      const offset = this.camera.position.clone().sub(this.controls.target)
      const toTarget = new THREE.Vector3(cmd.world.x, this.controls.target.y, cmd.world.y)
      const toPos = toTarget.clone().add(offset)
      this.animateCamera(toPos, toTarget, 700)
      return
    }

    if (cmd.kind === 'planet') {
      const planetId = cmd.targetId
      const entry = planetId ? this.entryByPlanetId.get(planetId) : undefined
      if (!entry || !planetId) return
      const dir = this.camera.position.clone().sub(this.controls.target)
      if (dir.lengthSq() < 1e-6) dir.set(0.5, 0.35, 0.8)
      dir.normalize()
      const dist = Math.max(30, entry.slot.size * 10)
      const toPos = new THREE.Vector3()
      const toTarget = new THREE.Vector3()
      // La planète continue d'orbiter pendant le tween : cible recalculée.
      const refresh = (tw: CameraTween): void => {
        this.planetPositionAt(entry, performance.now() / 1000, toTarget)
        toPos.copy(toTarget).addScaledVector(dir, dist)
        tw.toPos.copy(toPos)
        tw.toTarget.copy(toTarget)
      }
      const tw = this.animateCamera(toPos, toTarget, 950, easeInOutCubic, {
        refresh,
        onDone: () => {
          this.followId = planetId
          this.planetPositionAt(entry, performance.now() / 1000, this.followPrev)
        },
      })
      refresh(tw)
    }
  }

  /** Position monde d'une planète à l'instant t (sans allocation). */
  private planetPositionAt(entry: PlanetEntry, t: number, out: THREE.Vector3): THREE.Vector3 {
    const angle = entry.slot.angle0 + entry.slot.angularSpeed * t
    const r = entry.slot.orbitRadius
    return out
      .copy(entry.u)
      .multiplyScalar(Math.cos(angle) * r)
      .addScaledVector(entry.v, Math.sin(angle) * r)
      .add(entry.system.center)
  }

  /* ------------------------------------------------------------------ */
  /* Mises à jour par frame                                              */
  /* ------------------------------------------------------------------ */

  private updatePlanets(state: CosmosStore, t: number): void {
    const mesh = this.planetMesh
    for (let si = 0; si < this.systems.length; si++) {
      const sys = this.systems[si]
      // Légère réduction d'échelle des planètes des systèmes atténués.
      const dimScale = 0.75 + 0.25 * sys.dimF
      const entries = sys.entries
      for (let ei = 0; ei < entries.length; ei++) {
        const e = entries[ei]
        const angle = e.slot.angle0 + e.slot.angularSpeed * t
        const r = e.slot.orbitRadius
        e.pos
          .copy(e.u)
          .multiplyScalar(Math.cos(angle) * r)
          .addScaledVector(e.v, Math.sin(angle) * r)
          .add(sys.center)
        const visible = state.isPlanetVisible(e.planet)
        const s = visible ? e.slot.size * dimScale : 0
        this.sMat.compose(e.pos, IDENTITY_QUAT, this.sScale.set(s, s, s))
        mesh.setMatrixAt(e.instanceIndex, this.sMat)
      }
    }
    mesh.instanceMatrix.needsUpdate = true
  }

  private updateDimming(state: CosmosStore, dt: number): void {
    const k = Math.min(1, dt * 4.2)
    const camPos = this.camera.position
    for (let si = 0; si < this.systems.length; si++) {
      const sys = this.systems[si]
      const selected = state.selectedCategoryId === sys.category.id
      const target = state.selectedCategoryId === null || selected ? 1 : 0.3
      sys.dimF += (target - sys.dimF) * k
      if (Math.abs(sys.dimF - sys.appliedDimF) > 0.004) this.applyDim(sys)
      // Spin lent du sprite ✦ — billboard toujours face caméra mais qui
      // tourne sur lui-même, pour donner une impression de volume 3D.
      sys.spriteMat.rotation += dt * (sys.category.priority ? STAR_SPIN_SPEED_PRIORITY : STAR_SPIN_SPEED)
      // LOD : orbites visibles si système sélectionné ou caméra assez proche.
      const dist = this.sVecA.copy(sys.center).sub(camPos).length()
      sys.orbitLines.visible = selected || dist < sys.sys.radius * 3.2 + 420
    }
  }

  /** Applique l'atténuation du système (sprite, orbites, couleurs d'instances). */
  private applyDim(sys: StarSystem): void {
    sys.appliedDimF = sys.dimF
    sys.spriteMat.opacity = 0.92 * sys.dimF
    sys.orbitMat.opacity = 0.55 * sys.dimF
    const f = 0.35 + 0.65 * sys.dimF
    const entries = sys.entries
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      this.sColor.copy(e.baseColor).multiplyScalar(f)
      this.planetMesh.setColorAt(e.instanceIndex, this.sColor)
    }
    if (this.planetMesh.instanceColor) this.planetMesh.instanceColor.needsUpdate = true
  }

  private updateRings(state: CosmosStore, t: number, now: number): void {
    /* Anneau de sélection ---------------------------------------------- */
    const selId = state.selectedPlanetId
    const selEntry = selId ? this.entryByPlanetId.get(selId) : undefined
    if (selEntry && selId && state.isPlanetVisible(selEntry.planet)) {
      if (this.selRingPlanetId !== selId) {
        this.selRingPlanetId = selId
        this.selRingMat.color.set(selEntry.planet.color)
      }
      this.selRing.position.copy(selEntry.pos)
      const s = selEntry.slot.size * 3
      this.selRing.scale.set(s, s, 1)
      this.selRingMat.opacity = 0.5
      this.selRing.visible = true
    } else {
      this.selRing.visible = false
      this.selRingPlanetId = null
    }

    /* Anneau de highlight (recherche) : pulsation puis fondu ------------ */
    const hl = state.highlight
    const hlEntry = hl ? this.entryByPlanetId.get(hl.planetId) : undefined
    if (hl && hlEntry) {
      const remaining = hl.until - now
      if (remaining > 0) {
        if (this.hlPlanetId !== hl.planetId) {
          this.hlPlanetId = hl.planetId
          this.hlRingMat.color.set(hlEntry.planet.color)
        }
        const pulse = 0.5 + 0.5 * Math.sin(t * 5)
        const s = hlEntry.slot.size * (2.2 + 1.4 * pulse)
        this.hlRing.scale.set(s, s, 1)
        this.hlRing.position.copy(hlEntry.pos)
        this.hlRingMat.opacity = 0.3 + 0.45 * clamp01(remaining / 5200)
        this.hlRing.visible = state.isPlanetVisible(hlEntry.planet)
      } else if (remaining > -450 && this.hlPlanetId === hl.planetId) {
        // Expiration : disparition en fondu (~450 ms).
        this.hlRing.position.copy(hlEntry.pos)
        this.hlRingMat.opacity = 0.3 * (1 + remaining / 450)
        this.hlRing.visible = true
      } else {
        this.hlRing.visible = false
        this.hlPlanetId = null
      }
    } else {
      this.hlRing.visible = false
      this.hlPlanetId = null
    }
  }

  private updateLabels(state: CosmosStore, now: number): void {
    const w = this.width
    const h = this.height
    const halfTan = Math.tan(((this.camera.fov * Math.PI) / 180) / 2)
    const halfH = h / 2
    const camInv = this.camera.matrixWorldInverse

    /* Labels d'étoiles --------------------------------------------------- */
    for (let si = 0; si < this.systems.length; si++) {
      const sys = this.systems[si]
      this.sVecA.copy(sys.center).applyMatrix4(camInv)
      if (this.sVecA.z > -this.camera.near) {
        // Derrière la caméra → masqué.
        if (sys.labelVisible) {
          sys.labelVisible = false
          sys.label.style.visibility = 'hidden'
          sys.lastLX = -1e9
        }
        continue
      }
      const dist = -this.sVecA.z
      this.sVecB.copy(sys.center).project(this.camera)
      const sx = (this.sVecB.x * 0.5 + 0.5) * w
      const sy = (-this.sVecB.y * 0.5 + 0.5) * h
      // Fondu quand la caméra entre dans le système (label gênant).
      const nearFade = clamp01((dist - sys.sys.radius * 1.15) / (sys.sys.radius * 1.05))
      const starR = (sys.sys.starSize * 1.2 * halfH) / (dist * halfTan)
      const y = sy - starR - 10
      const op = sys.dimF < 0.5 ? 0 : sys.dimF * nearFade

      if (!sys.labelVisible) {
        sys.labelVisible = true
        sys.label.style.visibility = 'visible'
        sys.lastLX = -1e9
      }
      if (
        Math.abs(sx - sys.lastLX) > 0.2 ||
        Math.abs(y - sys.lastLY) > 0.2 ||
        Math.abs(op - sys.lastLO) > 0.01
      ) {
        sys.lastLX = sx
        sys.lastLY = y
        sys.lastLO = op
        sys.label.style.transform = `translate3d(${sx.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`
        sys.label.style.opacity = op.toFixed(3)
      }
    }

    /* Label de planète (hover > sélection > highlight) ------------------- */
    let pid = state.hoveredId
    if (!pid) pid = state.selectedPlanetId
    if (!pid && state.highlight && state.highlight.until > now) pid = state.highlight.planetId
    const entry = pid ? this.entryByPlanetId.get(pid) : undefined
    if (entry && pid && state.isPlanetVisible(entry.planet)) {
      this.sVecA.copy(entry.pos).applyMatrix4(camInv)
      const inFront = this.sVecA.z < -this.camera.near
      if (inFront) {
        const dist = -this.sVecA.z
        this.sVecB.copy(entry.pos).project(this.camera)
        const sx = (this.sVecB.x * 0.5 + 0.5) * w
        const sy = (-this.sVecB.y * 0.5 + 0.5) * h
        const pr = (entry.slot.size * halfH) / (dist * halfTan)
        const y = sy + pr + 8
        if (this.planetLabelPlanetId !== pid) {
          this.planetLabelPlanetId = pid
          this.planetLabel.textContent = entry.planet.title
        }
        if (!this.planetLabelVisible) {
          this.planetLabelVisible = true
          this.planetLabel.style.visibility = 'visible'
        }
        this.planetLabel.style.transform = `translate3d(${sx.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, 0)`
        this.planetLabel.style.opacity = '0.9'
      } else {
        this.setPlanetLabelHidden()
      }
    } else {
      this.setPlanetLabelHidden()
    }
  }

  private setPlanetLabelHidden(): void {
    this.planetLabelPlanetId = null
    if (this.planetLabelVisible) {
      this.planetLabelVisible = false
      this.planetLabel.style.visibility = 'hidden'
      this.planetLabel.style.opacity = '0'
    }
  }

  /* ------------------------------------------------------------------ */
  /* Picking & interactions                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Picking : raycast sur l'InstancedMesh (planètes) puis, à défaut,
   * picking écran des étoiles (< 26 px). Priorité à la planète touchée.
   */
  private pick(clientX: number, clientY: number): PickResult {
    const res = this.pickResult
    res.planetId = null
    res.categoryId = null
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return res

    this.sNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.sNdc, this.camera)

    const state = cosmosStore.getState()
    const hits = this.raycaster.intersectObject(this.planetMesh, false)
    for (let i = 0; i < hits.length; i++) {
      const instanceId = hits[i].instanceId
      if (instanceId === undefined) continue
      const pid = this.planetIdByInstance[instanceId]
      if (!pid) continue
      const entry = this.entryByPlanetId.get(pid)
      if (!entry || !state.isPlanetVisible(entry.planet)) continue
      res.planetId = pid
      return res
    }

    const px = clientX - rect.left
    const py = clientY - rect.top
    const camInv = this.camera.matrixWorldInverse

    // Orbites : clic/survol à proximité d'un anneau → planète de cet anneau,
    // sans avoir à viser précisément sa sphère (limité aux systèmes dont les
    // orbites sont actuellement affichées, cf. updateDimming()).
    const orbitR2 = ORBIT_PICK_RADIUS_PX * ORBIT_PICK_RADIUS_PX
    let bestOrbitD2 = orbitR2
    let bestOrbitPlanetId: string | null = null
    for (const sys of this.systems) {
      if (!sys.orbitLines.visible) continue
      for (const entry of sys.entries) {
        if (!state.isPlanetVisible(entry.planet)) continue
        const r = entry.slot.orbitRadius
        let prevSx = 0
        let prevSy = 0
        let havePrev = false
        for (let k = 0; k <= ORBIT_PICK_SAMPLES; k++) {
          const a = (k / ORBIT_PICK_SAMPLES) * TAU
          const cos = Math.cos(a) * r
          const sin = Math.sin(a) * r
          this.sVecC.set(
            sys.center.x + entry.u.x * cos + entry.v.x * sin,
            sys.center.y + entry.u.y * cos + entry.v.y * sin,
            sys.center.z + entry.u.z * cos + entry.v.z * sin,
          )
          this.sVecA.copy(this.sVecC).applyMatrix4(camInv)
          if (this.sVecA.z > -this.camera.near) {
            havePrev = false
            continue
          }
          this.sVecB.copy(this.sVecC).project(this.camera)
          const sx = (this.sVecB.x * 0.5 + 0.5) * rect.width
          const sy = (-this.sVecB.y * 0.5 + 0.5) * rect.height
          if (havePrev) {
            const d2 = distSqToSegment(px, py, prevSx, prevSy, sx, sy)
            if (d2 < bestOrbitD2) {
              bestOrbitD2 = d2
              bestOrbitPlanetId = entry.planet.id
            }
          }
          prevSx = sx
          prevSy = sy
          havePrev = true
        }
      }
    }
    if (bestOrbitPlanetId) {
      res.planetId = bestOrbitPlanetId
      return res
    }

    // Étoiles : distance écran à la projection du centre (< 26 px).
    const r2 = STAR_PICK_RADIUS_PX * STAR_PICK_RADIUS_PX
    let bestD2 = r2
    for (let si = 0; si < this.systems.length; si++) {
      const sys = this.systems[si]
      this.sVecA.copy(sys.center).applyMatrix4(camInv)
      if (this.sVecA.z > -this.camera.near) continue
      this.sVecB.copy(sys.center).project(this.camera)
      const sx = (this.sVecB.x * 0.5 + 0.5) * rect.width
      const sy = (-this.sVecB.y * 0.5 + 0.5) * rect.height
      const dx = sx - px
      const dy = sy - py
      const d2 = dx * dx + dy * dy
      if (d2 < bestD2) {
        bestD2 = d2
        res.categoryId = sys.category.id
      }
    }
    return res
  }

  private updateHover(clientX: number, clientY: number): void {
    const hit = this.pick(clientX, clientY)
    const id = hit.planetId ?? hit.categoryId ?? null
    if (id !== this.hoveredId) {
      this.hoveredId = id
      cosmosStore.getState().setHovered(id)
    }
    this.renderer.domElement.style.cursor = id ? 'pointer' : ''
  }

  private handleClick(clientX: number, clientY: number): void {
    const hit = this.pick(clientX, clientY)
    const store = cosmosStore.getState()
    if (hit.planetId) {
      store.focusPlanet(hit.planetId)
    } else if (hit.categoryId) {
      store.focusCategory(hit.categoryId)
    } else {
      store.selectCategory(null)
      store.setDetailOpen(false)
    }
  }

  private readonly onUserInteract = (): void => {
    // Toute interaction utilisateur annule le suivi de planète.
    this.followId = null
    // … et la rotation automatique du mode ambiant, définitivement :
    // l'utilisateur prend la main sur la caméra.
    if (this.controls.autoRotate) this.controls.autoRotate = false
  }

  private readonly onPointerDown = (ev: PointerEvent): void => {
    this.pointerActive++
    this.pointerDown = true
    this.pointerDragging = this.pointerActive > 1
    this.downX = ev.clientX
    this.downY = ev.clientY
  }

  private readonly onPointerMove = (ev: PointerEvent): void => {
    if (!this.active) return
    if (this.pointerDown) {
      const dx = ev.clientX - this.downX
      const dy = ev.clientY - this.downY
      if (dx * dx + dy * dy > CLICK_SLOP_PX * CLICK_SLOP_PX) this.pointerDragging = true
    }
    if (this.pointerDragging) return
    this.updateHover(ev.clientX, ev.clientY)
  }

  private readonly onPointerUp = (ev: PointerEvent): void => {
    this.pointerActive = Math.max(0, this.pointerActive - 1)
    if (this.active && this.pointerDown && !this.pointerDragging) {
      const dx = ev.clientX - this.downX
      const dy = ev.clientY - this.downY
      if (dx * dx + dy * dy < CLICK_SLOP_PX * CLICK_SLOP_PX) {
        this.handleClick(ev.clientX, ev.clientY)
      }
    }
    if (this.pointerActive === 0) {
      this.pointerDown = false
      this.pointerDragging = false
    }
  }

  private readonly onPointerLeave = (): void => {
    if (this.hoveredId !== null) {
      this.hoveredId = null
      cosmosStore.getState().setHovered(null)
    }
    this.renderer.domElement.style.cursor = ''
  }

  /* ------------------------------------------------------------------ */
  /* Resize                                                              */
  /* ------------------------------------------------------------------ */

  private onResize(): void {
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    if (w === this.width && h === this.height) return
    this.width = w
    this.height = h
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }
}
