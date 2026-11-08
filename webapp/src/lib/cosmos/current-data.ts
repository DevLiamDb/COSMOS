/**
 * COSMOS — DONNÉES ACTUELLES (source de la synchronisation)
 * =========================================================
 * Base de connaissances « réelle » persistée en base (Prisma/SQLite) :
 * c'est LA source que synchronise le bouton « Synchroniser les données
 * actuelles » de la page d'accueil. Contrairement au dataset de
 * démonstration (24 étoiles · 554 planètes fictives), il s'agit d'un
 * espace de travail authentique : 8 étoiles · 41 planètes, contenus
 * rédigés à la main, sessions datées.
 *
 * Ce module ne sert qu'à l'AMORÇAGE initial de la base (si elle est
 * vide) — ensuite, la base fait foi : toute donnée ajoutée directement
 * en base sera récupérée par la synchronisation.
 */

import type { CategoryNode, CosmosDataset, NodeType, PlanetNode, SessionInfo } from './types'
import { CATEGORY_PALETTE, hueShift } from './colors'

/** Dates ISO réelles (écrites à la main — pas de génération aléatoire). */
const SESSIONS: SessionInfo[] = [
  { id: 'sess-import', label: 'Import initial', date: '2025-01-12T09:30:00.000Z' },
  { id: 'sess-veille', label: 'Veille du jeudi', date: '2025-03-06T18:00:00.000Z' },
  { id: 'sess-cosmos', label: 'Atelier COSMOS n°3', date: '2025-04-17T14:00:00.000Z' },
  { id: 'sess-sprint', label: 'Revue de sprint 14', date: '2025-05-09T11:00:00.000Z' },
  { id: 'sess-perso', label: 'Session personnelle', date: '2025-06-07T20:30:00.000Z' },
]

/** Graine d'une planète (avant coloration / mise en forme). */
interface PlanetSeed {
  id: string
  type: NodeType
  title: string
  description: string
  content: string
  importance: number
  tags: string[]
  connections?: string[]
  statut?: string
  session: string
  /** Date ISO de création (la mise à jour = création + quelque jours). */
  created: string
}

/** Graine d'une catégorie avec ses planètes. */
interface CurrentCategorySeed {
  id: string
  name: string
  domain: string
  description: string
  tags: string[]
  /** Catégorie prioritaire — rechargée en début de conversation (COSMOS réel). */
  priority?: boolean
  /** Index dans CATEGORY_PALETTE. */
  paletteIndex: number
  planets: PlanetSeed[]
}

const CATEGORY_SEEDS: CurrentCategorySeed[] = [
  {
    id: 'cur-cosmos',
    name: 'Projet COSMOS',
    domain: 'Projet personnel',
    description: 'Notes d’architecture et décisions du projet COSMOS — l’application elle-même vit dans son propre univers.',
    tags: ['cosmos', 'architecture', 'nextjs'],
    paletteIndex: 16, // or
    priority: true,
    planets: [
      {
        id: 'cp-store',
        type: 'technique',
        title: 'Architecture du store global',
        description: 'Zustand comme source de vérité unique, partagée par l’UI et les deux moteurs de rendu.',
        content: `## Choix

Un seul store Zustand pour toute l’application. Les moteurs 2D/3D s’y abonnent **hors React** via \`cosmosStore.subscribe()\` — aucun double état.

## Points clés

- La sélection est commune : choisir une planète en 2D la sélectionne aussi en 3D.
- Les commandes caméra portent un **nonce croissant** : un moteur inactif au moment de l’émission traite l’ordre à son réveil.
- Le dataset garde une **identité stable** : \`applyDataset()\` mute le contenu en place, \`dataVersion\` force le re-montage des vues.`,
        importance: 5,
        tags: ['zustand', 'état', 'architecture'],
        connections: ['cp-engine2d', 'cp-engine3d'],
        session: 'sess-cosmos',
        created: '2025-04-17T14:10:00.000Z',
      },
      {
        id: 'cp-engine2d',
        type: 'technique',
        title: 'Moteur 2D — Canvas',
        description: 'Rendu Canvas plein écran : sprites pré-rendus, culling écran, zéro allocation par frame.',
        content: `Une seule boucle \`requestAnimationFrame\`, suspendue quand la vue 2D est inactive.

**Perf** : les glyphes ✦ sont dessinés une fois dans des sprites offscreen ; les poussières et orbites sont culled hors écran ; aucun objet alloué dans la boucle (tableaux typés préalloués, styles module-level).

Mesuré : 60 fps vsync sur le dataset complet, ~16,5 ms par frame.`,
        importance: 4,
        tags: ['canvas', 'perf', '2d'],
        connections: ['cp-store'],
        session: 'sess-cosmos',
        created: '2025-04-17T14:40:00.000Z',
      },
      {
        id: 'cp-engine3d',
        type: 'technique',
        title: 'Moteur 3D — Three.js',
        description: 'Instancing des planètes, labels projetés, OrbitControls avec damping.',
        content: `Une seule géométrie sphérique instanciée pour toutes les planètes ; les labels sont des sprites projetés en 2D écran avec test d’occlusion.

Le picking passe par un \`Raycaster\` sur l’instance — la sélection survit à la bascule 2D ↔ 3D parce qu’elle vit dans le store.`,
        importance: 4,
        tags: ['three', 'webgl', '3d'],
        connections: ['cp-store'],
        session: 'sess-cosmos',
        created: '2025-04-17T15:05:00.000Z',
      },
      {
        id: 'cp-search',
        type: 'document',
        title: 'Recherche multi-jetons',
        description: 'Scoring par champ (titre > description > type > session > contenu), insensible aux accents.',
        content: `Chaque requête est découpée en jetons ; un document doit contenir **tous** les jetons (AND) pour remonter.

Pondération : titre ×8, description ×4, type ×3, session ×2, contenu ×1. Les accents sont normalisés à l’indexation (NFD + retrait des diacritiques), donc « theoreme » trouve « théorème ».`,
        importance: 4,
        tags: ['recherche', 'index', 'scoring'],
        connections: ['ia-copilote'],
        session: 'sess-cosmos',
        created: '2025-04-17T15:30:00.000Z',
      },
      {
        id: 'cp-roadmap',
        type: 'tache',
        title: 'Roadmap v2',
        description: 'Démarrage sur univers vide, scène ambiante, page d’accueil, synchronisation des données.',
        content: `- [x] Univers vide par défaut + scène ambiante interpolée (2D & 3D)
- [x] Page d’accueil type landing avec crédits
- [x] Synchronisation avec les données actuelles (API + Prisma)
- [ ] Import de notes Markdown locales
- [ ] Édition en place d’une planète`,
        importance: 4,
        tags: ['roadmap', 'v2'],
        statut: 'en cours',
        connections: ['cp-decision-vide'],
        session: 'sess-sprint',
        created: '2025-05-09T11:15:00.000Z',
      },
      {
        id: 'cp-decision-vide',
        type: 'decision',
        title: 'Décision : démarrer sur un univers vide',
        description: 'La première impression de COSMOS est le vide — pas 554 fausses planètes.',
        content: `**Contexte** : v1 chargeait un gros jeu de données fictif au démarrage.

**Décision** : au lancement, l’univers est vide et respire (poussière dorée, ✦ fantôme, anneaux). Les données deviennent un **choix explicite** — démonstration ou synchronisation réelle — et non un bruit de fond.

**Conséquence** : le rechargement de page ramène toujours au menu principal.`,
        importance: 5,
        tags: ['décision', 'ux'],
        connections: ['cp-roadmap'],
        session: 'sess-cosmos',
        created: '2025-04-17T15:50:00.000Z',
      },
      {
        id: 'cp-palette',
        type: 'reference',
        title: 'Palette visuelle & thème',
        description: 'Fond quasi noir OKLCH, accent or chaud, panneaux en verre dépoli.',
        content: `- Fond : \`oklch(0.145 0.012 265)\` — bleu nuit à peine perceptible
- Accent : or chaud \`oklch(0.8 0.115 82)\` réservé au logo ✦, aux CTA et aux états actifs
- Panneaux : verre dépoli (\`.cosmos-glass\`), grain subtil par-dessus le canvas
- Titres : Space Grotesk ; corps : Inter`,
        importance: 3,
        tags: ['design', 'couleurs', 'oklch'],
        session: 'sess-perso',
        created: '2025-06-07T20:35:00.000Z',
      },
    ],
  },
  {
    id: 'cur-dev',
    name: 'Développement Web',
    domain: 'Ingénierie front',
    description: 'Notes techniques sur l’écosystème JavaScript/TypeScript : framework, patterns, outils.',
    tags: ['web', 'typescript', 'nextjs'],
    paletteIndex: 7, // azur
    planets: [
      {
        id: 'dw-next',
        type: 'note',
        title: 'Next.js App Router — notes',
        description: 'Ce qui change vraiment par rapport au Pages Router.',
        content: `Les composants serveur sont la **réponse par défaut** ; \`'use client'\` se pose au plus près des feuilles interactives.

Les route handlers (\`app/api/**/route.ts\`) remplacent les pages API. Attention : un \`GET\` sans dynamisme explicite peut être mis en cache — \`force-dynamic\` quand il lit une base.`,
        importance: 4,
        tags: ['nextjs', 'app-router'],
        connections: ['dw-rsc'],
        session: 'sess-veille',
        created: '2025-03-06T18:10:00.000Z',
      },
      {
        id: 'dw-rsc',
        type: 'concept',
        title: 'React Server Components',
        description: 'Le rendu côté serveur comme défaut, l’hydratation comme exception.',
        content: `Un composant serveur **ne descend jamais** vers le client : son HTML est figé dans le payload. L’état et les effets vivent dans les îlots clients.

Le piège classique : importer un composant avec \`useState\` depuis un composant serveur → il faut déplacer la frontière \`'use client'\` plus bas, ou passer des props sérialisables.`,
        importance: 4,
        tags: ['react', 'rsc'],
        connections: ['dw-next'],
        session: 'sess-veille',
        created: '2025-03-06T18:35:00.000Z',
      },
      {
        id: 'dw-prisma',
        type: 'technique',
        title: 'Prisma + SQLite en dev',
        description: 'Itérer vite sur le schéma sans écrire de migration.',
        content: `\`prisma db push --accept-data-loss\` synchronise le schéma en ~20 ms — parfait pour explorer.

En production : \`prisma migrate dev\` puis \`migrate deploy\`, uniquement des migrations rejouables. Le client se régénère à chaque push.`,
        importance: 3,
        tags: ['prisma', 'sqlite', 'bdd'],
        session: 'sess-sprint',
        created: '2025-05-09T11:40:00.000Z',
      },
      {
        id: 'dw-zustand',
        type: 'document',
        title: 'Zustand vs Context',
        description: 'Quand le Context React suffit, et quand il devient le goulot.',
        content: `Le Context re-rend **tous** les consommateurs à chaque changement de valeur ; Zustand permet des sélecteurs fins (\`useStore(s => s.x)\`) — seul le composant qui lit \`x\` re-rend.

Règle retenue : Context pour la configuration statique (thème, i18n), Zustand pour l’état vivant (sélection, caméra, données).`,
        importance: 3,
        tags: ['zustand', 'context', 'perf'],
        connections: ['cp-store'],
        session: 'sess-veille',
        created: '2025-03-06T19:00:00.000Z',
      },
      {
        id: 'dw-ws',
        type: 'technique',
        title: 'WebSockets derrière la gateway',
        description: 'Un seul port exposé : le routage passe par un paramètre d’URL.',
        content: `La gateway n’expose qu’un port : les services internes (socket.io, mini-services) sont atteints via \`/?XTransformPort=3030\`.

**Jamais** de port en dur côté client — ni \`fetch('http://localhost:3030/…')\`, ni \`io('http://…')\`. Toujours des chemins relatifs + le paramètre de routage.`,
        importance: 2,
        tags: ['websocket', 'gateway', 'socket-io'],
        session: 'sess-sprint',
        created: '2025-05-09T12:05:00.000Z',
      },
      {
        id: 'dw-tailwind',
        type: 'technique',
        title: 'Tailwind 4 — @theme',
        description: 'Les tokens de design deviennent des variables CSS natives.',
        content: `Avec Tailwind 4, \`@theme\` déclare les tokens (\`--font-display\`, \`--color-primary\`…) directement en CSS — plus besoin de \`tailwind.config\` pour la plupart des usages.

Bonus : \`var(--font-display)\` devient utilisable comme classe utilitaire générée (\`font-display\`).`,
        importance: 3,
        tags: ['tailwind', 'css', 'design-tokens'],
        connections: ['cp-palette'],
        session: 'sess-perso',
        created: '2025-06-07T21:00:00.000Z',
      },
    ],
  },
  {
    id: 'cur-ia',
    name: 'IA & Automatisation',
    domain: 'Modèles & agents',
    description: 'Veille et expérimentations autour des LLM, du RAG et des agents.',
    tags: ['ia', 'llm', 'rag'],
    paletteIndex: 3, // magenta doux
    priority: true,
    planets: [
      {
        id: 'ia-prompt',
        type: 'recherche',
        title: 'Prompting — ce qui tient dans le temps',
        description: 'Trois pratiques qui survivent aux changements de modèles.',
        content: `1. **Instructions en tête**, exemples ensuite — jamais l’inverse.
2. Décrire le **format de sortie** attendu avec un exemple court.
3. Donner au modèle une porte de sortie honnête (« réponds "inconnu" si… ») : ça réduit les hallucinations plus que n’importe quelle menace.`,
        importance: 4,
        tags: ['prompt', 'llm'],
        session: 'sess-veille',
        created: '2025-03-06T18:20:00.000Z',
      },
      {
        id: 'ia-rag',
        type: 'recherche',
        title: 'RAG : chunking sémantique',
        description: 'Découper sur la structure plutôt que sur un nombre de tokens.',
        content: `Le découpage naïf (N tokens glissants) coupe les idées en deux. Mieux : couper sur les titres Markdown, puis re-couper les sections trop longues avec un chevauchement de 10-15 %.

Résultat mesuré sur mon corpus : +9 % de rappel top-5, coûts d’indexation inchangés.`,
        importance: 4,
        tags: ['rag', 'chunking', 'embeddings'],
        connections: ['le-lost'],
        session: 'sess-veille',
        created: '2025-03-06T18:50:00.000Z',
      },
      {
        id: 'ia-agents',
        type: 'concept',
        title: 'Agents : boucles d’outils',
        description: 'Un agent = un LLM + des outils + une boucle avec budget d’étapes.',
        content: `Le motif qui marche : planifier → appeler un outil → **observer le résultat** → replanifier, avec un budget maximal d’étapes et un critère d’arrêt explicite.

Sans budget, l’agent boucle ; sans observation réelle du résultat, il invente. Le cœur du travail est là, pas dans le prompt système.`,
        importance: 3,
        tags: ['agents', 'tools'],
        connections: ['pr-veille-auto'],
        session: 'sess-veille',
        created: '2025-03-06T19:15:00.000Z',
      },
      {
        id: 'ia-couts',
        type: 'note',
        title: 'Coûts d’inférence — suivi',
        description: 'Trois leviers qui ont réellement divisé la facture.',
        content: `- Passer les tâches simples (classification, extraction) sur un petit modèle : **−70 %** du volume.
- Mettre en cache les préfixes stables (system + few-shots).
- Limiter le contexte au nécessaire : chaque token inutile se paie deux fois (entrée + sortie si recopié).`,
        importance: 2,
        tags: ['coûts', 'inférence'],
        session: 'sess-sprint',
        created: '2025-05-09T11:55:00.000Z',
      },
      {
        id: 'ia-copilote',
        type: 'idee',
        title: 'Idée : copilote de recherche dans COSMOS',
        description: 'Poser une question en langage naturel et recevoir les planètes pertinentes.',
        content: `Réutiliser l’index de recherche existant comme source de rappel : le copilote reformule la question, interroge \`searchCosmos()\`, puis résume les 5 planètes les mieux scorées avec liens de saut.

Avantage : zéro nouvelle indexation, et les réponses restent ancrées dans des données vérifiables.`,
        importance: 3,
        tags: ['idée', 'copilote', 'cosmos'],
        connections: ['cp-search'],
        session: 'sess-perso',
        created: '2025-06-07T20:50:00.000Z',
      },
    ],
  },
  {
    id: 'cur-design',
    name: 'Design & Interfaces',
    domain: 'Design produit',
    description: 'Réflexions sur la couleur, le mouvement et la lisibilité des interfaces sombres.',
    tags: ['design', 'ui', 'motion'],
    paletteIndex: 18, // corail
    planets: [
      {
        id: 'de-dark',
        type: 'technique',
        title: 'Dark mode en OKLCH',
        description: 'Pourquoi OKLCH rend les gris sombres plus justes.',
        content: `En OKLCH, la **clarté perçue** est uniforme : \`oklch(0.145 …)\` et \`oklch(0.20 …)\` sont perçues aussi éloignées l’une de l’autre que deux clartés hautes équivalentes. Fini les « gris qui semblent sales » du HSL.

Règle pratique : garder une chrominance très faible (≤ 0.02) pour les surfaces, la réserver aux accents.`,
        importance: 4,
        tags: ['oklch', 'dark-mode', 'couleur'],
        connections: ['cp-palette'],
        session: 'sess-perso',
        created: '2025-06-07T20:40:00.000Z',
      },
      {
        id: 'de-motion',
        type: 'concept',
        title: 'Micro-interactions : doser',
        description: 'Le mouvement doit expliquer, jamais décorer.',
        content: `Une transition doit répondre à une question : *d’où vient cet élément, où va-t-il ?* Si elle n’apporte pas cette continuité, elle est du bruit.

Budget retenu : 150-250 ms pour le feedback local, 400-700 ms pour les changements de scène, une seule courbe signature (cubic-bezier(0.22, 1, 0.36, 1)).`,
        importance: 3,
        tags: ['motion', 'animation'],
        session: 'sess-veille',
        created: '2025-03-06T19:30:00.000Z',
      },
      {
        id: 'de-typo',
        type: 'note',
        title: 'Typographie : Space Grotesk + Inter',
        description: 'Un duo display/Texte qui tient sur fond étoilé.',
        content: `Space Grotesk pour le wordmark et les titres (le ✦ et « COSMOS » partagent sa géométrie) ; Inter pour tout le reste, particulièrement lisible en petites tailles.

Astuce : \`text-shadow\` léger (noir 0.8, blur 12 px) quand le texte flotte directement sur le canvas animé.`,
        importance: 3,
        tags: ['typographie', 'fonts'],
        connections: ['cp-palette'],
        session: 'sess-perso',
        created: '2025-06-07T21:10:00.000Z',
      },
      {
        id: 'de-a11y',
        type: 'reference',
        title: 'Accessibilité : cibles ≥ 44px',
        description: 'La règle des 44 px, appliquée au chrome flottant.',
        content: `Chaque bouton du chrome (topbar, contrôles, CTA) fait au minimum 44 px de haut — y compris les boutons « invisibles » (conteneur pointer-events-none, cible pointer-events-auto).

Vérifier aussi : focus visible (\`focus-visible:ring-2\`), \`aria-label\` sur les boutons icônes, \`aria-live\` pour les changements de contexte.`,
        importance: 4,
        tags: ['a11y', 'mobile'],
        session: 'sess-sprint',
        created: '2025-05-09T12:20:00.000Z',
      },
      {
        id: 'de-obsidian',
        type: 'reference',
        title: 'Inspiration : graphe d’Obsidian',
        description: 'Ce que COSMOS garde — et ce qu’il laisse tomber.',
        content: `À garder : la lecture relationnelle (les connexions entre notes deviennent des trajectoires visibles), la couleur par domaine.

À laisser : la fouillis de nœuds. Dans COSMOS, une planète n’existe que **dans l’orbite de sa catégorie** — la hiérarchie impose une première lecture avant la liberté.`,
        importance: 3,
        tags: ['obsidian', 'graphe', 'référence'],
        connections: ['cp-engine2d', 'cp-engine3d'],
        session: 'sess-import',
        created: '2025-01-12T09:45:00.000Z',
      },
    ],
  },
  {
    id: 'cur-outils',
    name: 'Outils & Environnement',
    domain: 'Poste de travail',
    description: 'Réglages du poste : runtime, versioning, linters.',
    tags: ['outils', 'bun', 'git'],
    paletteIndex: 9, // turquoise
    planets: [
      {
        id: 'ou-bun',
        type: 'note',
        title: 'Bun comme runtime',
        description: 'Installations et scripts nettement plus rapides — quelques réserves.',
        content: `\`bun install\` et \`bun --hot\` (redémarrage à chaud sans perte d’état) changent la journée type.

Réserve : vérifier les binaires natifs occasionnels mal supportés ; garder Node comme roue de secours dans les CI.`,
        importance: 3,
        tags: ['bun', 'runtime'],
        session: 'sess-sprint',
        created: '2025-05-09T11:25:00.000Z',
      },
      {
        id: 'ou-git',
        type: 'document',
        title: 'Conventions de commit',
        description: 'Format court, type + périmètre, à l’impératif.',
        content: `\`feat(cosmos): ajoute la recherche multi-jetons\`

- type : feat / fix / docs / refactor / perf / chore
- périmètre entre parenthèses quand le projet est multi-modules
- à l’impératif, sans point final, ≤ 72 caractères`,
        importance: 2,
        tags: ['git', 'conventions'],
        session: 'sess-import',
        created: '2025-01-12T10:05:00.000Z',
      },
      {
        id: 'ou-eslint',
        type: 'technique',
        title: 'ESLint strict — réglages',
        description: 'Les règles qui attrapent vraiment des bugs.',
        content: `Activer en priorité : \`no-floating-promises\` (TS), \`react-hooks/exhaustive-deps\`, \`@next/next\` (images, liens).

Relâcher sans culpabilité : \`no-unused-vars\` pour les abonnements « signal seul » (\`useStore(s => s.version)\`).`,
        importance: 2,
        tags: ['eslint', 'qualité'],
        session: 'sess-sprint',
        created: '2025-05-09T12:35:00.000Z',
      },
      {
        id: 'ou-vscode',
        type: 'reference',
        title: 'VS Code — extensions 2025',
        description: 'La courte liste qui survit aux nettoyages annuels.',
        content: `ESLint, Tailwind IntelliSense, Prisma, Error Lens, Pretty TS Errors.

Raccourci préféré : « Reveal Definition Side » (\`⌘K ⌘\`)\` — lire une définition sans perdre le fichier courant.`,
        importance: 1,
        tags: ['vscode', 'éditeur'],
        session: 'sess-perso',
        created: '2025-06-07T21:20:00.000Z',
      },
    ],
  },
  {
    id: 'cur-lectures',
    name: 'Lectures & Concepts',
    domain: 'Culture générale',
    description: 'Livres et concepts qui nourrissent la façon de penser les connaissances.',
    tags: ['lectures', 'concepts', 'méthode'],
    paletteIndex: 5, // lavande
    planets: [
      {
        id: 'le-bsob',
        type: 'reference',
        title: 'Building a Second Brain',
        description: 'Tiago Forte — capturer, organiser, distiller, exprimer.',
        content: `La méthode CODE : **C**apture (garde ce qui résonne), **O**rganise (par projet, pas par sujet), **D**istille (des notes de plus en plus denses), **E**xprime (crée à partir des notes).

Le point qui m’a le plus servi : organiser **par actionnabilité**. Une note « sur » un sujet mort ne sert jamais personne.`,
        importance: 4,
        tags: ['livre', 'méthode', 'pkm'],
        connections: ['le-zettel'],
        session: 'sess-perso',
        created: '2025-06-07T20:15:00.000Z',
      },
      {
        id: 'le-zettel',
        type: 'concept',
        title: 'Zettelkasten',
        description: 'Notes atomiques, liées, écrites avec ses propres mots.',
        content: `Trois règles : une idée par note ; chaque note écrite **dans ses propres mots** (comprendre ≠ recopier) ; chaque note nouvelle doit rencontrer au moins une ancienne.

C’est exactement le modèle de COSMOS : la planète (note atomique) n’existe que reliée à son étoile et à ses connexions.`,
        importance: 4,
        tags: ['zettelkasten', 'pkm', 'notes'],
        connections: ['le-bsob', 'le-serendipite'],
        session: 'sess-perso',
        created: '2025-06-07T20:25:00.000Z',
      },
      {
        id: 'le-lost',
        type: 'recherche',
        title: 'Lost in the middle',
        description: 'Les LLM lisent mieux le début et la fin d’un contexte long.',
        content: `Étude (Liu et al., 2023) : la précision de réponse enfoncée quand l’information clé se trouve **au milieu** d’un long contexte — courbe en U.

Conséquence pratique : placer les éléments décisifs en tête de prompt, ou découper pour que chaque appel reste court.`,
        importance: 3,
        tags: ['llm', 'contexte', 'papier'],
        connections: ['ia-rag'],
        session: 'sess-veille',
        created: '2025-03-06T19:45:00.000Z',
      },
      {
        id: 'le-kahneman',
        type: 'concept',
        title: 'Système 1 / Système 2',
        description: 'Kahneman — pensée rapide et automatique vs lente et coûteuse.',
        content: `Le Système 1 (intuitif) répond toujours **quelque chose** ; le Système 2 (réfléchi) est paresseux et ne s’allume que sous contrainte.

Application interface : plus une UI demande de Système 2 (champs ambigus, hiérarchie cachée), plus l’utilisateur se trompe vite. D’où le chrome minimal de COSMOS.`,
        importance: 3,
        tags: ['cognition', 'kahneman'],
        session: 'sess-perso',
        created: '2025-06-07T21:30:00.000Z',
      },
      {
        id: 'le-serendipite',
        type: 'idee',
        title: 'Sérendipité voulue',
        description: 'Organiser les notes pour tomber dessus par hasard — à dessein.',
        content: `Le classement parfait rend les notes introuvables sauf si on sait déjà ce qu’on cherche. Garder des croisements « gratuits » : tags transverses, connexions manuelles invraisemblables, revue mensuelle aléatoire de 5 vieilles planètes.`,
        importance: 2,
        tags: ['sérendipité', 'méthode'],
        connections: ['le-zettel'],
        session: 'sess-perso',
        created: '2025-06-07T21:40:00.000Z',
      },
    ],
  },
  {
    id: 'cur-projets',
    name: 'Projets & Idées',
    domain: 'Idées en attente',
    description: 'La nursery : projets en cours et idées qui attendent leur étoile.',
    tags: ['projets', 'idées'],
    paletteIndex: 11, // émeraude
    planets: [
      {
        id: 'pr-jardin',
        type: 'idee',
        title: 'Idée : jardin de notes public',
        description: 'Publier les notes assez mûres, avec leurs liens, sous forme de graphe navigable.',
        content: `Étendre COSMOS avec un mode lecture public : mêmes orbites, interactions réduites, contenus marqués « publics ».

La valeur : voir la **structure** de la pensée d’un autre, pas seulement ses articles finis.`,
        importance: 3,
        tags: ['idée', 'public', 'web'],
        connections: ['pr-carte'],
        session: 'sess-perso',
        created: '2025-06-07T20:55:00.000Z',
      },
      {
        id: 'pr-portfolio',
        type: 'projet',
        title: 'Portfolio v3',
        description: 'Refonte sobre : trois études de cas, aucun carousel.',
        content: `**Statut** : wireframes faits, rédaction en cours.

Structure retenue : une page par étude de cas (contexte → décisions → résultat chiffré), une page « maintenant » vivante (ce que j’apprends cette semaine), aucun CV téléchargeable.`,
        importance: 4,
        tags: ['portfolio', 'refonte'],
        statut: 'en cours',
        session: 'sess-sprint',
        created: '2025-05-09T12:45:00.000Z',
      },
      {
        id: 'pr-veille-auto',
        type: 'idee',
        title: 'Idée : veille hebdo automatisée',
        description: 'Un agent qui collecte, trie et résume la veille du jeudi.',
        content: `Pipeline : collecte (flux + sources manuelles) → dédoublonnage → score d’intérêt par similarité avec mes notes récentes → digest d’une page le jeudi matin.

Le score d’intérêt est la pièce centrale : sans lui, c’est un lecteur RSS de plus.`,
        importance: 2,
        tags: ['idée', 'automatisation', 'veille'],
        connections: ['ia-agents'],
        session: 'sess-veille',
        created: '2025-03-06T20:00:00.000Z',
      },
      {
        id: 'pr-kanban',
        type: 'tache',
        title: 'Kanban personnel',
        description: 'Trois colonnes, une règle de WIP.',
        content: `Colonnes : *cette semaine* (max 5) / *en cours* (max 2) / *fait* (vidée chaque dimanche).

La règle de WIP est la seule qui compte : quand « en cours » est plein, rien n’y entre tant que rien n’en sort.`,
        importance: 2,
        tags: ['kanban', 'organisation'],
        statut: 'à faire',
        session: 'sess-import',
        created: '2025-01-12T10:20:00.000Z',
      },
      {
        id: 'pr-carte',
        type: 'idee',
        title: 'Idée : carte des compétences',
        description: 'Visualiser ses compétences comme des systèmes solaires en expansion.',
        content: `Chaque domaine = une étoile ; les compétences = des planètes dont l’orbite s’élargit avec la pratique. Rejouer la carte chaque trimestre et regarder **quelles orbites ont grandi**.

Détail : une compétence non pratiquée voit son orbite décroître — le graphe raconte l’oubli.`,
        importance: 2,
        tags: ['idée', 'compétences', 'dataviz'],
        connections: ['pr-jardin'],
        session: 'sess-perso',
        created: '2025-06-07T22:00:00.000Z',
      },
    ],
  },
  {
    id: 'cur-orga',
    name: 'Organisation & Vie',
    domain: 'Équilibre',
    description: 'Rituels, énergie et concentration — le carburant du reste.',
    tags: ['productivité', 'santé', 'rituels'],
    paletteIndex: 0, // ambre
    priority: true,
    planets: [
      {
        id: 'or-lundi',
        type: 'tache',
        title: 'Rituel du lundi',
        description: '45 minutes pour transformer une semaine subie en semaine choisie.',
        content: `1. Vider la boîte de réception jusqu’à zéro décision en attente (les réponses longues deviennent des tâches).
2. Revoir le kanban : ce qui a traîné deux semaines sort ou meurt.
3. Choisir **une** chose qui, si elle seule était faite, rendrait la semaine bonne.`,
        importance: 4,
        tags: ['rituel', 'semaine'],
        statut: 'chaque semaine',
        session: 'sess-import',
        created: '2025-01-12T09:35:00.000Z',
      },
      {
        id: 'or-pomodoro',
        type: 'note',
        title: 'Pomodoro — bilan après 3 mois',
        description: 'Ce que 25/5 apporte vraiment (et ce qu’il n’apporte pas).',
        content: `Apporte : un **démarreur** — commencer reste la partie la plus dure, et la promesse « juste 25 min » la contourne.

N’apporte pas : la profondeur. Les meilleures sessions sont celles où la sonnerie retentit et qu’on repousse **une fois** — pas trois.`,
        importance: 3,
        tags: ['focus', 'pomodoro'],
        session: 'sess-perso',
        created: '2025-06-07T20:10:00.000Z',
      },
      {
        id: 'or-sommeil',
        type: 'note',
        title: 'Sommeil et concentration',
        description: 'Corrélation simple, observée sur trois mois de journal.',
        content: `Sous 6 h 30 de sommeil, les tâches Système 2 (debug, architecture, rédaction) prennent 40 à 60 % de plus ; les tâches routinières, elles, sont à peine affectées.

Conclusion pragmatique : planifier le **travail difficile** selon la nuit d’avant, pas selon le calendrier.`,
        importance: 3,
        tags: ['sommeil', 'énergie'],
        connections: ['le-kahneman'],
        session: 'sess-perso',
        created: '2025-06-07T21:50:00.000Z',
      },
      {
        id: 'or-inbox',
        type: 'conversation',
        title: 'Inbox zéro, vraiment ?',
        description: 'Débat du jeudi : discipline ou théâtre de la productivité ?',
        content: `Pour : une boîte vide est une **décision** par message — rien ne pourrit.

Contre : vider n’est pas traiter ; l’inbox zéro peut devenir une excuse à ne jamais penser long terme.

Accord final : inbox zéro le lundi, tolérance zéro sur les décisions en attente, indifférence totale sur le reste.`,
        importance: 2,
        tags: ['inbox', 'débat'],
        session: 'sess-veille',
        created: '2025-03-06T20:15:00.000Z',
      },
    ],
  },
]

/* ------------------------------------------------------------------ */
/* Construction du dataset                                             */
/* ------------------------------------------------------------------ */

/** Écart de mise à jour (heures) — purement déterministe, par planète. */
const UPDATE_LAG_HOURS = [26, 51, 74, 122, 190, 263, 337]

/**
 * Construit le dataset « données actuelles » — déterministe, contenu
 * rédigé à la main. Sert à amorcer la base lors de la première
 * synchronisation ; ensuite la base fait foi.
 */
export function buildCurrentDataset(): CosmosDataset {
  const categories: CategoryNode[] = []
  const planets: PlanetNode[] = []

  CATEGORY_SEEDS.forEach((seed, catIndex) => {
    const color = CATEGORY_PALETTE[seed.paletteIndex % CATEGORY_PALETTE.length]
    categories.push({
      id: seed.id,
      kind: 'category',
      name: seed.name,
      color,
      description: seed.description,
      ...(seed.priority ? { priority: true } : {}),
      metadata: {
        tags: seed.tags,
        domain: seed.domain,
      },
    })

    seed.planets.forEach((p, i) => {
      const created = new Date(p.created)
      const updated = new Date(created.getTime() + UPDATE_LAG_HOURS[(i + catIndex) % UPDATE_LAG_HOURS.length] * 3_600_000)
      // Teinte dérivée de l'étoile : variation douce (±14° comme la démo)
      // pour que chaque planète reste visuellement fille de son étoile.
      const dh = ((i * 37) % 29) - 14
      const dl = ((i * 53) % 17) * 0.01 - 0.06
      planets.push({
        id: p.id,
        kind: 'planet',
        category_id: seed.id,
        session_id: p.session,
        node_type: p.type,
        title: p.title,
        short_description: p.description,
        content: p.content,
        created_at: created.toISOString(),
        updated_at: updated.toISOString(),
        color: hueShift(color, dh, dl),
        metadata: {
          importance: p.importance,
          tags: p.tags,
          connections: p.connections ?? [],
          ...(p.statut ? { statut: p.statut } : {}),
        },
      })
    })
  })

  return {
    categories,
    planets,
    sessions: [...SESSIONS],
    generatedAt: new Date('2025-06-14T09:00:00.000Z').toISOString(),
    isDemo: false,
  }
}
