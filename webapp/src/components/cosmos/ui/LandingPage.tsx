'use client'

/**
 * COSMOS — LandingPage
 * ====================
 * Véritable page d'accueil DÉFILANTE — le contenu scrolle au-dessus de la
 * scène ambiante (léger voile sombre pour la lisibilité) :
 *
 *   • Hero pleine hauteur : ✦ or respirant, wordmark COSMOS dominant,
 *     décodeur discret « Contextual Object Storage & Memory Over
 *     Sessions », VRAIE description du produit, et UNE porte :
 *     « Démarrer la démo » — univers fictif (24 étoiles · 554 planètes)
 *     + indicateur « Explorer COSMOS » qui glisse vers la 1re section.
 *   • Cinq sections RÉVÉLÉES AU DÉFILEMENT (whileInView) : une GRANDE
 *     planète animée surgit d'un côté (glissement + mise à l'échelle +
 *     flou qui se dissout), le texte arrive en cascade de l'autre —
 *     mémoire persistante, 100 % local, recherche par sens, taxonomie
 *     vivante, graphe de liens : la vraie description de COSMOS.
 *   • Clôture + « Retour au sommet », puis crédits « ✦ Créé par Liam ✦ »
 *     en bas de page (zone sûre iOS).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp, ChevronDown, Sparkles } from 'lucide-react'

import { useCosmos } from '@/lib/cosmos/store'
import { rgba, shade } from '@/lib/cosmos/colors'
import { cn } from '@/lib/utils'
import { EASE } from './shared'

/**
 * L'écran-titre (2,1 s puis fondu de 1,1 s) se dissout pendant que la page
 * entre en scène : le stagger démarre juste avant sa fin pour que la
 * composition émerge AVEC la dissolution.
 */
const ENTER_BASE = 1.45

/** Base courte pour les retours ultérieurs au menu (plus de splash à attendre). */
const REENTER_BASE = 0.12

/** Ombre de lisibilité — le texte flotte sur le canvas ambiant. */
const TEXT_SHADOW = '0 1px 12px rgba(0, 0, 0, 0.8)'

/**
 * Voile sombre au-dessus de la scène ambiante : assombrit légèrement le
 * haut et le bas de l'écran (wordmark, crédits) et détache le contenu du
 * fond étoilé, sans jamais masquer la scène.
 */
const SCRIM =
  'linear-gradient(to bottom, rgba(5, 6, 10, 0.6) 0%, rgba(5, 6, 10, 0.12) 20%, ' +
  'rgba(5, 6, 10, 0.18) 50%, rgba(5, 6, 10, 0.12) 80%, rgba(5, 6, 10, 0.62) 100%)'

/* ------------------------------------------------------------------ */
/* Sections de présentation — grandes planètes révélées au défilement   */
/* ------------------------------------------------------------------ */

/** Une section = une facette de COSMOS, portée par une grande planète. */
interface FeatureDef {
  id: string
  /** Numéro + thème court, au-dessus du titre. */
  kicker: string
  title: string
  text: string
  /** Couleur d'accent de la planète (hex). */
  color: string
  /** Anneau planétaire. */
  ring: boolean
  /** Particules en orbite autour de la planète. */
  moons: number
  /** Faits concrets, en pastilles sous le texte. */
  chips: string[]
}

const FEATURES: FeatureDef[] = [
  {
    id: 'memoire',
    kicker: 'Le principe',
    title: 'Une mémoire qui ne s’efface pas',
    text: 'À la fin de chaque session, vos assistants IA oublient tout. COSMOS leur donne une mémoire externe permanente : branché comme un serveur MCP — Claude et les autres —, il transforme chaque note, idée ou décision en objet stocké, prêt à être rappelé à la session suivante.',
    color: '#e8c476',
    ring: true,
    moons: 1,
    chips: ['Serveur MCP', 'Objets persistants', 'Mémoire entre sessions'],
  },
  {
    id: 'local',
    kicker: 'Confidentialité',
    title: '100 % local, cosmos.db',
    text: 'Tout vit dans une base SQLite sur votre machine — cosmos.db. Aucun cloud, aucun envoi : vos souvenirs restent chez vous, lisibles et exportables à tout moment.',
    color: '#7fc98f',
    ring: false,
    moons: 2,
    chips: ['SQLite local', 'Zéro cloud', 'cosmos.db'],
  },
  {
    id: 'sens',
    kicker: 'Recherche',
    title: 'Retrouver par le sens',
    text: 'Chaque souvenir devient un vecteur sémantique via fastembed, calculé en local. Demandez « ce que j’avais dit sur les embeddings » : COSMOS retrouve l’idée par sa signification, pas par ses mots-clés.',
    color: '#5cccbd',
    ring: false,
    moons: 3,
    chips: ['fastembed', 'Vecteurs locaux', 'Recherche sémantique'],
  },
  {
    id: 'taxonomie',
    kicker: 'Organisation',
    title: 'Une taxonomie vivante',
    text: 'Pas de liste figée : les catégories s’apprennent et se créent au fil de l’usage. Les catégories prioritaires se rechargent en un seul appel léger, prêtes à guider la suite.',
    color: '#e07bc2',
    ring: true,
    moons: 2,
    chips: ['Catégories auto-apprises', 'Priorités rechargeables', 'Un seul appel'],
  },
  {
    id: 'graphe',
    kicker: 'Connexions',
    title: 'Un graphe de liens',
    text: 'Des connexions se tissent automatiquement entre souvenirs proches ou successifs. Parcourez le graphe, suivez un lien, rappelez le texte complet d’un souvenir précis.',
    color: '#a181da',
    ring: true,
    moons: 4,
    chips: ['Liens automatiques', 'Graphe parcourable', 'Texte intégral'],
  },
]

/** Variantes du texte : apparaît en remontant, le flou se dissout. */
const TEXT_VARIANTS = {
  hidden: { opacity: 0, y: 20, filter: 'blur(8px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)' },
} as const

/** Variantes d'une pastille-fait. */
const CHIP_VARIANTS = {
  hidden: { opacity: 0, y: 12, scale: 0.94 },
  show: { opacity: 1, y: 0, scale: 1 },
} as const

/**
 * Grande planète décorative d'une section — sphère en radial-gradient,
 * halo pulsé, anneau planétaire penché et particules en orbite. Tout est
 * en pourcentages du parent : la même planète s'adapte au mobile et au
 * desktop. Flottement d'altitude en continu (interpolation pure), posé
 * sur un conteneur de révélation séparé (glissement au défilement).
 */
function FeaturePlanet({ feature }: { feature: FeatureDef }) {
  const { color, ring, moons } = feature
  return (
    <motion.div
      className="pointer-events-none relative aspect-square w-36 shrink-0 sm:w-52 lg:w-60 xl:w-64"
      animate={{ y: [0, -10, 0] }}
      transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
    >
      {/* Halo pulsé */}
      <motion.div
        className="absolute inset-[-32%] rounded-full"
        style={{ background: `radial-gradient(circle, ${rgba(color, 0.24)} 0%, transparent 65%)` }}
        animate={{ opacity: [0.5, 0.95, 0.5] }}
        transition={{ duration: 4.4, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Anneau planétaire — ellipse penchée derrière/devant la sphère */}
      {ring && (
        <div
          className="absolute left-1/2 top-1/2 rounded-[50%] border-2"
          style={{
            width: '176%',
            height: '72%',
            borderColor: rgba(color, 0.5),
            transform: 'translate(-50%, -50%) rotate(-17deg)',
            boxShadow: `0 0 16px ${rgba(color, 0.16)}`,
          }}
        />
      )}

      {/* Particules en orbite (une par « lune », durées et phases étalées) */}
      {Array.from({ length: moons }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute inset-[-16%]"
          initial={{ rotate: i * (360 / Math.max(1, moons)) }}
          animate={{ rotate: i * (360 / Math.max(1, moons)) + 360 }}
          transition={{ duration: 9 + i * 3.5, repeat: Infinity, ease: 'linear' }}
        >
          <span
            className="absolute left-1/2 top-0 block h-1.5 w-1.5 -translate-x-1/2 rounded-full"
            style={{ background: shade(color, 0.3), boxShadow: `0 0 8px ${rgba(color, 0.85)}` }}
          />
        </motion.div>
      ))}

      {/* Sphère — volume par dégradé radial, ombre interne pour le limbe */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle at 32% 28%, ${shade(color, 0.38)} 0%, ${color} 42%, ${shade(color, -0.58)} 100%)`,
          boxShadow: `0 0 48px ${rgba(color, 0.3)}, inset -10px -8px 20px rgba(0, 0, 0, 0.55)`,
        }}
      />
    </motion.div>
  )
}

/**
 * Section de présentation : la planète surgit de son côté (glissement +
 * grandissement + flou) pendant que le texte arrive en cascade du côté
 * opposé — déclenchés par l'entrée dans le viewport (une seule fois).
 * Alternance gauche/droite d'une section à l'autre ; empilé sur mobile.
 */
function FeatureSection({ feature, index }: { feature: FeatureDef; index: number }) {
  const flip = index % 2 === 1
  return (
    <section
      id={`cosmos-feature-${feature.id}`}
      aria-label={`${feature.kicker} — ${feature.title}`}
      className="relative flex min-h-[82svh] items-center justify-center px-6 py-14 sm:px-10"
    >
      <div
        className={cn(
          'mx-auto flex w-full max-w-5xl flex-col items-center gap-9 text-center sm:gap-12 lg:flex-row lg:items-center lg:gap-16',
          flip && 'lg:flex-row-reverse',
        )}
      >
        {/* Planète — surgit de son côté en grandissant */}
        <motion.div
          initial={{ opacity: 0, x: flip ? 96 : -96, scale: 0.6, rotate: flip ? 7 : -7, filter: 'blur(12px)' }}
          whileInView={{ opacity: 1, x: 0, scale: 1, rotate: 0, filter: 'blur(0px)' }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.95, ease: EASE }}
          className="flex shrink-0 justify-center"
        >
          <FeaturePlanet feature={feature} />
        </motion.div>

        {/* Texte — cascade depuis le flou (kicker → titre → texte → faits) */}
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.4 }}
          className="min-w-0 text-center lg:max-w-md lg:text-left"
        >
          <motion.p
            variants={TEXT_VARIANTS}
            transition={{ duration: 0.55, ease: EASE, delay: 0.05 }}
            className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground/80 sm:text-[11px]"
            style={{ textShadow: TEXT_SHADOW }}
          >
            <span style={{ color: feature.color }}>{String(index + 1).padStart(2, '0')}</span>
            {' — '}
            {feature.kicker}
          </motion.p>

          <motion.h3
            variants={TEXT_VARIANTS}
            transition={{ duration: 0.65, ease: EASE, delay: 0.13 }}
            className="font-display mt-2 text-2xl text-foreground sm:text-3xl"
            style={{ textShadow: TEXT_SHADOW }}
          >
            {feature.title}
          </motion.h3>

          <motion.p
            variants={TEXT_VARIANTS}
            transition={{ duration: 0.7, ease: EASE, delay: 0.21 }}
            className="mt-3 text-[13px] leading-relaxed text-muted-foreground sm:text-[15px]"
            style={{ textShadow: TEXT_SHADOW }}
          >
            {feature.text}
          </motion.p>

          <ul className="mt-5 flex flex-wrap justify-center gap-2 lg:justify-start">
            {feature.chips.map((chip, ci) => (
              <motion.li
                key={chip}
                variants={CHIP_VARIANTS}
                transition={{ duration: 0.5, ease: EASE, delay: 0.3 + ci * 0.07 }}
                className="cosmos-glass flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium text-muted-foreground"
                style={{ textShadow: TEXT_SHADOW }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: feature.color, boxShadow: `0 0 6px ${rgba(feature.color, 0.6)}` }}
                  aria-hidden="true"
                />
                {chip}
              </motion.li>
            ))}
          </ul>
        </motion.div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Page d'accueil                                                      */
/* ------------------------------------------------------------------ */

export function LandingPage() {
  const atLanding = useCosmos((s) => s.atLanding)
  const loadDemoData = useCosmos((s) => s.loadDemoData)
  const loadCurrentData = useCosmos((s) => s.loadCurrentData)
  const syncStatus = useCosmos((s) => s.syncStatus)

  // Conteneur défilant — « Retour au sommet » l'y ramène en douceur.
  const scrollRef = useRef<HTMLDivElement>(null)

  // Longue intro (coordination avec le splash) uniquement au PREMIER
  // affichage ; les retours au menu entrent sans délai d'attente.
  const [longIntro, setLongIntro] = useState(true)

  // Dès le premier départ vers un univers, l'intro « splash » ne se
  // rejouera plus.
  useEffect(
    () =>
      useCosmos.subscribe((s, prev) => {
        if (prev.atLanding && !s.atLanding) setLongIntro(false)
      }),
    [],
  )

  /** Glisse la page vers la première section de présentation. */
  const scrollToFirstFeature = useCallback(() => {
    document
      .getElementById('cosmos-feature-memoire')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  /** Ramène la page au héros, en douceur. */
  const backToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const base = longIntro ? ENTER_BASE : REENTER_BASE
  const visible = atLanding

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="landing-page"
          className="pointer-events-none fixed inset-0 z-30"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.3, ease: EASE } }}
          exit={{
            opacity: 0,
            scale: 0.97,
            filter: 'blur(8px)',
            transition: { duration: 0.45, ease: EASE },
          }}
        >
          {/* Voile de lisibilité — détache le contenu de la scène ambiante */}
          <div className="absolute inset-0" style={{ background: SCRIM }} aria-hidden="true" />

          {/* --- Contenu défilant -------------------------------------- */}
          <div
            ref={scrollRef}
            tabIndex={-1}
            className="cosmos-scroll pointer-events-auto absolute inset-0 overflow-y-auto overscroll-contain outline-none"
          >
            {/* --- Hero : pleine hauteur --------------------------------- */}
            <section
              aria-label="COSMOS — accueil"
              className="relative flex min-h-svh flex-col items-center justify-center px-6 pb-24 pt-16 text-center sm:pt-20"
            >
              <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center">
                {/* ✦ or — respiration continue */}
                <motion.div
                  initial={{ opacity: 0, y: 16, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ duration: 0.9, delay: base, ease: EASE }}
                >
                  <motion.span
                    aria-hidden="true"
                    className="block text-[2rem] leading-none text-primary sm:text-[2.4rem]"
                    style={{ textShadow: '0 0 28px rgba(231, 190, 102, 0.35)' }}
                    animate={{ scale: [1, 1.12, 1], opacity: [0.85, 1, 0.85] }}
                    transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    ✦
                  </motion.span>
                </motion.div>

                {/* Wordmark — la pièce maîtresse */}
                <motion.h1
                  className="cosmos-wordmark mt-4 text-5xl text-foreground sm:text-6xl"
                  style={{ textShadow: TEXT_SHADOW }}
                  initial={{ opacity: 0, y: 14, filter: 'blur(8px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ duration: 0.75, delay: base + 0.08, ease: EASE }}
                >
                  COSMOS
                </motion.h1>

                {/* Décodeur — discret, sous le wordmark */}
                <motion.p
                  className="mt-2.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60 sm:text-[11px]"
                  style={{ textShadow: TEXT_SHADOW }}
                  initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ duration: 0.7, delay: base + 0.14, ease: EASE }}
                >
                  Contextual Object Storage &amp; Memory Over Sessions
                </motion.p>

                {/* Vraie description du produit */}
                <motion.p
                  className="mt-5 max-w-xl text-balance text-[13.5px] leading-relaxed text-muted-foreground sm:text-[15px]"
                  style={{ textShadow: TEXT_SHADOW }}
                  initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ duration: 0.7, delay: base + 0.16, ease: EASE }}
                >
                  Une mémoire externe, persistante et locale pour vos
                  assistants IA. Branchée comme un serveur MCP, elle
                  transforme chaque idée, chaque note et chaque décision en
                  objet stocké, compris et relié — sur votre machine, jamais
                  ailleurs.
                </motion.p>

                {/* --- Porte unique : la démonstration --------------------- */}
                <motion.div
                  className="mt-6 w-full"
                  initial={{ opacity: 0, y: 12, filter: 'blur(8px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ duration: 0.45, delay: base + 0.2, ease: EASE }}
                >
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={loadDemoData}
                      aria-label="Démarrer la démo — univers fictif de 24 étoiles et 554 planètes"
                      className="pointer-events-auto flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-primary px-6 text-sm font-medium text-primary-foreground shadow-[0_8px_32px_-6px_rgba(231,190,102,0.45),0_2px_10px_rgba(0,0,0,0.45)] transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0"
                    >
                      <Sparkles size={16} strokeWidth={1.75} aria-hidden="true" />
                      Démarrer la démo
                    </button>
                  </div>

                  {/* Légende */}
                  <p
                    className="mt-3 text-[11px] text-muted-foreground/70"
                    style={{ textShadow: TEXT_SHADOW }}
                  >
                    Univers fictif — 24 étoiles · 554 planètes
                  </p>

                  {/* Porte secondaire, discrète : les vraies données COSMOS
                      (cosmos.db, via le serveur MCP) plutôt que la démo. */}
                  <p
                    className="mt-2 text-[11px]"
                    style={{ textShadow: TEXT_SHADOW }}
                  >
                    <button
                      type="button"
                      onClick={loadCurrentData}
                      disabled={syncStatus === 'syncing'}
                      aria-label="Charger mes vraies données COSMOS"
                      className="pointer-events-auto text-muted-foreground/60 underline decoration-dotted underline-offset-2 transition hover:text-foreground/80 disabled:pointer-events-none disabled:opacity-60"
                    >
                      {syncStatus === 'syncing'
                        ? 'Synchronisation…'
                        : syncStatus === 'error'
                          ? 'Échec — réessayer'
                          : 'Ou charger mes vraies données'}
                    </button>
                  </p>
                </motion.div>
              </div>

              {/* Indicateur de défilement — glisse vers la présentation */}
              <motion.button
                type="button"
                onClick={scrollToFirstFeature}
                aria-label="Explorer COSMOS — défiler vers la présentation"
                className="pointer-events-auto absolute bottom-[calc(env(safe-area-inset-bottom)+1.1rem)] left-1/2 flex -translate-x-1/2 flex-col items-center gap-0.5 text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                style={{ textShadow: TEXT_SHADOW }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.7, delay: base + 0.45, ease: EASE }}
              >
                <span className="text-[10px] font-medium uppercase tracking-[0.22em]">
                  Explorer COSMOS
                </span>
                <motion.span
                  aria-hidden="true"
                  animate={{ y: [0, 6, 0] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <ChevronDown size={18} strokeWidth={1.75} />
                </motion.span>
              </motion.button>
            </section>

            {/* --- Sections : les planètes apparaissent au défilement --- */}
            {FEATURES.map((feature, i) => (
              <FeatureSection key={feature.id} feature={feature} index={i} />
            ))}

            {/* --- Clôture + retour au sommet --------------------------- */}
            <section
              aria-label="Conclusion"
              className="relative flex min-h-[62svh] flex-col items-center justify-center gap-4 px-6 py-16 text-center"
            >
              <motion.span
                aria-hidden="true"
                className="text-xl text-primary"
                style={{ textShadow: '0 0 22px rgba(231, 190, 102, 0.4)' }}
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, amount: 0.6 }}
                transition={{ duration: 0.7, ease: EASE }}
              >
                ✦
              </motion.span>

              <motion.h3
                className="font-display max-w-md text-2xl text-foreground sm:text-3xl"
                style={{ textShadow: TEXT_SHADOW }}
                initial={{ opacity: 0, y: 16, filter: 'blur(8px)' }}
                whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                viewport={{ once: true, amount: 0.6 }}
                transition={{ duration: 0.7, ease: EASE, delay: 0.08 }}
              >
                Chaque souvenir a sa place dans l’univers.
              </motion.h3>

              <motion.p
                className="max-w-md text-[13px] leading-relaxed text-muted-foreground sm:text-sm"
                style={{ textShadow: TEXT_SHADOW }}
                initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
                whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                viewport={{ once: true, amount: 0.6 }}
                transition={{ duration: 0.7, ease: EASE, delay: 0.16 }}
              >
                Catégories en étoiles, données en planètes — entrez,
                explorez, reliez, retrouvez.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.6 }}
                transition={{ duration: 0.6, ease: EASE, delay: 0.24 }}
                className="mt-2"
              >
                <button
                  type="button"
                  onClick={backToTop}
                  aria-label="Revenir en haut de la page"
                  className="cosmos-glass pointer-events-auto flex h-10 items-center gap-2 rounded-xl px-4 text-xs font-medium text-foreground/85 transition-all duration-200 hover:-translate-y-0.5 hover:brightness-[1.13] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <ArrowUp size={14} strokeWidth={1.75} aria-hidden="true" />
                  Retour au sommet
                </button>
              </motion.div>
            </section>

            {/* --- Crédits — bas de page, zone sûre iOS ------------------ */}
            <footer className="relative flex flex-col items-center gap-1 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-4 text-center">
              <p className="text-xs text-muted-foreground/70" style={{ textShadow: TEXT_SHADOW }}>
                <span className="text-primary" aria-hidden="true">✦</span>{' '}
                Créé par Liam{' '}
                <span className="text-primary" aria-hidden="true">✦</span>
              </p>
              <p
                className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50"
                style={{ textShadow: TEXT_SHADOW }}
              >
                COSMOS · 2025
              </p>
            </footer>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
