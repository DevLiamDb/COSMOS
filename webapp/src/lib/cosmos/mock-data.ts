/**
 * COSMOS — DONNÉES DE DÉMONSTRATION (MOCK DATA)
 * =============================================
 * ⚠️  Tout ce fichier génère un jeu de fausses données réaliste et déterministe.
 *     Aucune donnée réelle n'est utilisée. Pour brancher un vrai back-end,
 *     il suffit de construire un CosmosDataset équivalent ailleurs.
 *
 * - 24 catégories (= étoiles ✦), de 10 à 42 planètes chacune (~550 planètes).
 * - 14 types de nœuds : notes, idées, décisions, événements, personnes, tâches,
 *   documents, conversations, recherches, concepts, infos techniques, références,
 *   sessions, contextes projet.
 * - Contenus de longueurs variées (de la note d'une ligne au document structuré).
 * - Génération 100 % déterministe (seed fixe) : 2D et 3D voient le même univers.
 */

import type { CategoryNode, CosmosDataset, NodeType, PlanetNode, SessionInfo } from './types'
import { CATEGORY_PALETTE, hueShift } from './colors'
import { hashString, mulberry32, type Rng } from './rng'

/** « Maintenant » fictif et fixe — garantit un dataset stable entre les rechargements. */
const REFERENCE_NOW = new Date('2025-06-18T10:00:00Z').getTime()
const DAY = 86_400_000

/* ------------------------------------------------------------------ */
/* Pools globaux                                                       */
/* ------------------------------------------------------------------ */

const PEOPLE = [
  'Camille Roussel', 'Théo Nakamura', 'Inès Bergström', 'Marc Lefèvre', 'Sofia Andrade',
  'Jonas Weber', 'Léa Fontaine', 'Amir Haddad', 'Clara Vidal', 'Hugo Mercier',
  'Yuki Tanaka', 'Nadia Belkacem', 'Felix Ostrowski', 'Zoé Marchand', 'Karim Nasser',
  'Elena Petrova', 'Bastien Girard', 'Maya Lindqvist', 'Raphaël Kaddour', 'Lucie Aubert',
  'Dmitri Sokolov', 'Awa Diallo', 'Paulo Ferreira', 'Selma Haddouche', 'Noé Berthelot',
  'Jade Legrand', 'Anton Reznik', 'Fatou Ndiaye', 'Étienne Charbonneau', 'Mira Kovač',
]

const TOOLS = [
  'Figma', 'Linear', 'Notion', 'Obsidian', 'Excalidraw', 'PostgreSQL', 'Redis',
  'S3', 'GitHub Actions', 'Loom', 'Slack', 'Miro', 'Playwright', 'Grafana',
]

const LIEUX = [
  'au studio', 'en salle Kepler', 'au labo', 'en visio', 'à la bibliothèque',
  'au café d’en bas', 'en salle Galilée', 'pendant la rétrospective', 'au whiteboard du 3e',
]

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

/* ------------------------------------------------------------------ */
/* Définition des catégories                                           */
/* ------------------------------------------------------------------ */

interface CategorySeed {
  id: string
  name: string
  domain: string
  description: string
  tags: string[]
  planetCount: number
  /** Catégorie prioritaire — chargée en début de conversation (COSMOS réel). */
  priority?: boolean
  /** Sujets réalistes servant à produire titres et contenus. */
  subjects: string[]
  /** Mélange de types de nœuds (poids relatifs). */
  typeMix: Partial<Record<NodeType, number>>
  /** Vocabulaire spécifique injecté dans les contenus. */
  flavor: { outils?: string[]; extra?: string[] }
  /** 1-2 entrées longues écrites à la main (mise en avant à l’ouverture). */
  featured?: { title: string; type: NodeType; description: string; content: string }[]
}

const CATEGORY_SEEDS: CategorySeed[] = [
  {
    id: 'cat-ia',
    name: 'Intelligence Artificielle',
    domain: 'IA & modèles de langage',
    description: 'Veille, expérimentations et retours d’expérience autour des modèles de langage et des systèmes d’IA.',
    tags: ['ia', 'llm', 'ml', 'recherche'],
    planetCount: 34,
    priority: true,
    subjects: [
      'fenêtres de contexte', 'fine-tuning de petits modèles', 'RAG hybride', 'agents autonomes',
      'embeddings spécialisés', 'prompt engineering', 'évaluation des modèles', 'distillation de connaissances',
      'hallucinations', 'modèles multimodaux', 'inférence locale', 'sécurité des LLM', 'garde-fous',
      'mixture-of-experts', 'mémoire long terme', 'tool calling', 'structured outputs', 'costs d’inférence',
      'embedding caches', 'reranking', 'observabilité des traces', 'jeux d’évaluation', 'petits modèles en edge',
      'alignement des intentions', 'génération augmentée de graphes',
    ],
    typeMix: { recherche: 6, technique: 5, concept: 4, note: 4, reference: 3, idee: 3, conversation: 2, document: 2 },
    flavor: { outils: ['vLLM', 'LlamaIndex', 'Weaviate', 'pgvector', 'Ollama', 'Hugging Face', 'LiteLLM'] },
    featured: [
      {
        title: 'Notes de synthèse — fenêtres de contexte et mémoire',
        type: 'document',
        description: 'Synthèse interne sur la façon dont nous gérons le contexte long dans nos chaînes d’IA.',
        content: `## Le problème

Nos chaînes RAG dépassent régulièrement les 32k tokens de contexte utile. Au-delà, la qualité des réponses se dégrade : le modèle « oublie » les instructions du système, multiplie les répétitions et invente des sources.

## Ce que l’on observe

- La précision chute d’environ 12 % quand le contexte dépasse la moitié de la fenêtre.
- Les instructions placées en tête sont mieux respectées que celles noyées au milieu (« lost in the middle »).
- Un reranking agressif (top-4 au lieu de top-20) bat systématiquement le « tout mettre ».

## Décisions

1. Compacter le contexte avant injection : résumés hiérarchiques plutôt que chunks bruts.
2. Réserver les fenêtres longues à la synthèse documentaire, pas à la question-réponse.
3. Mesurer, pour chaque flux, le coût marginal d’un token de contexte supplémentaire.

## Pistes

Explorer une mémoire persistante par utilisateur : les échanges récents dans la fenêtre, le reste dans un index vectoriel avec politique d’expiration.`,
      },
    ],
  },
  {
    id: 'cat-design',
    name: 'Design & Expérience',
    domain: 'Design produit',
    description: 'Réflexions sur l’interface, la typographie, les micro-interactions et la lisibilité.',
    tags: ['design', 'ux', 'ui', 'typographie'],
    planetCount: 26,
    subjects: [
      'typographie modulaire', 'hiérarchie visuelle', 'micro-interactions', 'design tokens',
      'modes sombres', 'accessibilité des contrastes', 'navigation spatiale', 'onboarding progressif',
      'vitesse perçue', 'espaces de respiration', 'iconographie fine', 'motion design discret',
      'design system', 'recherche utilisateur', 'prototypage rapide', 'états vides', 'messages d’erreur',
      'denses vs aérés', 'grilles fluides', 'focus visible', 'mise en échelle du texte', 'thèmes de couleur',
    ],
    typeMix: { note: 5, idee: 5, concept: 3, document: 3, decision: 2, conversation: 2, recherche: 2, reference: 2, tache: 1 },
    flavor: { outils: ['Figma', 'Excalidraw', 'Miro'] },
    featured: [
      {
        title: 'Charte visuelle — silence et lumière',
        type: 'document',
        description: 'Les principes qui gouvernent l’interface : fond sombre, accents rares, contrastes maîtrisés.',
        content: `## Principes

Une interface de connaissance doit disparaître derrière le contenu. Trois règles suffisent :

1. **Le fond ne bouge jamais.** Les surfaces s’empilent avec des différences de luminosité de 2 à 4 %, jamais plus.
2. **La lumière est un langage.** Un halo signale une étoile, un point lumineux une donnée. Aucun autre élément ne brille.
3. **Le mouvement raconte.** Chaque transition a une durée et une raison : 150 ms pour un survol, 600 ms pour un recentrage caméra.

## Typographie

- Titres : Space Grotesk, graisse moyenne, interlettrage léger.
- Corps : Inter, 15-16 px, interligne 1,65 pour la lecture longue.
- Données techniques : mono, 12 px, opacité réduite.

## Couleur

Une couleur = une catégorie, choisie dans une palette de 24 teintes calibrées pour le fond quasi noir. Les composants d’interface restent neutres (blanc translucide) : la couleur appartient aux données, pas au chrome.`,
      },
    ],
  },
  {
    id: 'cat-archi',
    name: 'Architecture Logicielle',
    domain: 'Ingénierie',
    description: 'Choix structurels, patterns et arbitrages techniques de la plateforme.',
    tags: ['archi', 'patterns', 'backend'],
    planetCount: 30,
    subjects: [
      'architecture hexagonale', 'event sourcing', 'CQRS', 'frontends modulaires', 'composition d’API',
      'frontières de services', 'idempotence', 'files de messages', 'cache multicouche', 'sharding',
      'observabilité', 'strangler fig', 'transactions distribuées', 'bounded contexts', 'contrats d’API',
      'monorepo vs polyrepo', 'websockets de bout en bout', 'rendu hybride', 'migrations sans coupure',
      'tests de contract', 'backpressure', 'jobs idempotents', 'schémas évolutifs', 'profiling à froid',
    ],
    typeMix: { technique: 6, decision: 4, document: 3, note: 3, concept: 3, recherche: 2, conversation: 2, reference: 2, idee: 2, tache: 2 },
    flavor: { outils: ['PostgreSQL', 'Redis', 'Kafka', 'Temporal', 'Bun', 'Docker'] },
    featured: [
      {
        title: 'ADR-012 — une seule base, des frontières nettes',
        type: 'decision',
        description: 'Arbitrage : garder une base unique avec des frontières logiques plutôt que des microservices prématurés.',
        content: `## Contexte

L’équipe grandit (6 → 12). Deux voix s’élèvent : découper en microservices « maintenant, tant que c’est petit » ou garder un monolithe modéré.

## Décision

Une seule application, une seule base, mais avec des frontières internes strictes : modules isolés, schémas SQL séparés par domaine, aucune requête SQL croisée. Les frontières sont logiques d’abord, physiques le jour où une donnée l’exige.

## Justification

- Le coût opérationnel des microservices (déploiement, traçage, cohérence) est disproportionné à notre taille.
- Les frontières logiques se déplacent à peu de frais ; les frontières physiques, jamais.
- L’event sourcing sur deux flux clés (activités, annotations) prépare un éventuel découpage sans l’imposer.

## Conséquences

- Revue de code systématique sur les imports inter-modules.
- Un ADR obligatoire pour toute exception aux frontières.
- Réexamen dans 12 mois ou lors du passage à 20 personnes.`,
      },
    ],
  },
  {
    id: 'cat-atlas',
    name: 'Projet Atlas',
    domain: 'Produit — fil rouge',
    description: 'Le fil rouge du produit : vision, jalons, risques et décisions de gouvernance.',
    tags: ['produit', 'roadmap', 'atlas'],
    planetCount: 42,
    priority: true,
    subjects: [
      'vision produit', 'personas cibles', 'périmètre du MVP', 'jalon M1', 'jalon M2', 'rétrospective de sprint',
      'registre des risques', 'budget prévisionnel', 'plan de recrutement', 'architecture cible', 'plan de tests',
      'déploiement pilote', 'retours des pilotes', 'roadmap T3', 'comité de pilotage', 'communication interne',
      'stratégie d’onboarding', 'critères de succès', 'concurrence', 'pricing de lancement', 'nom du produit',
      'identité visuelle', 'stratégie mobile', 'partenariats', 'migration des données', 'documentation publique',
      'campagne bêta', 'support utilisateur', 'SLA internes', 'fin du programme pilote',
    ],
    typeMix: { projet: 8, tache: 7, decision: 5, conversation: 4, document: 4, evenement: 4, note: 3, personne: 2, idee: 2, recherche: 2, reference: 1 },
    flavor: { outils: ['Linear', 'Slack', 'Loom', 'Notion'] },
    featured: [
      {
        title: 'Vision — une carte vivante du savoir de l’équipe',
        type: 'projet',
        description: 'Le document fondateur du projet Atlas : pourquoi une représentation spatiale des connaissances.',
        content: `## Le constat

Nos connaissances existent, mais éclatées : documents, fils de discussion, têtes. Chaque recherche repart de zéro. Les nouveaux passent six mois à reconstituer ce que les anciens savent déjà.

## L’hypothèse

Une **représentation spatiale** — des domaines comme des systèmes solaires, des notes comme des planètes — rend la structure du savoir perceptible d’un coup d’œil. On ne cherche plus un fichier : on se déplace dans un paysage familier.

## Ce que doit prouver le pilote

1. Des utilisateurs retrouvent une note vue une seule fois, deux semaines plus tard.
2. Le nombre de questions « où est-ce qu’on en est sur X » diminue en moitié.
3. La carte devient un rituel : ouverte en début de réunion, comme un plan de ville.

## Non-objectifs

Ni messagerie, ni base de données relationnelle, ni wiki. Une carte. Le texte reste le texte ; Atlas donne le relief.`,
      },
    ],
  },
  {
    id: 'cat-recherche',
    name: 'Recherche & Systèmes complexes',
    domain: 'Recherche fondamentale',
    description: 'Explorations sur les systèmes complexes, réseaux et dynamiques émergentes.',
    tags: ['recherche', 'systèmes', 'réseaux'],
    planetCount: 22,
    subjects: [
      'émergence', 'réseaux petit monde', 'dynamiques non linéaires', 'théorie de l’information',
      'auto-organisation', 'boucles de feedback', 'criticalité auto-organisée', 'modèles à base d’agents',
      'systèmes adaptatifs complexes', 'entropie et information', 'réseaux bayésiens', 'théorie des graphes',
      'synchronisation', 'modes de défaillance en cascade', 'optimisation par essaim', 'fractales urbaines',
      'équilibres de Nash', 'redondance gracile', 'loi de puissance', 'mémoire collective',
    ],
    typeMix: { recherche: 7, concept: 6, note: 3, reference: 3, idee: 2, conversation: 1 },
    flavor: { outils: ['NetLogo', 'NetworkX', 'SciPy'] },
  },
  {
    id: 'cat-lectures',
    name: 'Notes de lecture',
    domain: 'Lectures',
    description: 'Extraits, résumés et réflexions issus de livres et d’essais.',
    tags: ['lecture', 'livres', 'synthèse'],
    planetCount: 28,
    subjects: [
      'Thinking in Systems (Meadows)', 'How to Take Smart Notes (Ahrens)', 'The Timeless Way of Building (Alexander)',
      'Deep Work (Newport)', 'The Pragmatic Programmer', 'Shape Up', 'Seeing Like a State (Scott)',
      'The Beginning of Infinity (Deutsch)', 'L’Antifragile (Taleb)', 'Creative Selection (Kocienda)',
      'The Design of Everyday Things (Norman)', 'Range (Epstein)', 'Super Thinking (Weinberg)',
      'Wabi-sabi pour designers', 'L’Art de la simplicité (Loreau)', 'Humankind (Bregman)',
      'The Extended Mind', 'Surfaces and Essences (Hofstadter)', 'La Semaine de 4 heures (Ferriss)',
      'Décider dans l’incertitude (Jaeger)', 'Mémoires d’un marchand de thé', 'Les Lois du Chaos (Gleick)', 'Sapiens (Harari)',
      'L’Esprit du Zen', 'Borges — Fictions', 'La Chambre claire (Barthes)', 'Séminal : As We May Think (Bush)',
    ],
    typeMix: { note: 8, reference: 6, concept: 4, document: 4, idee: 3, recherche: 2, conversation: 1 },
    flavor: {},
    featured: [
      {
        title: 'How to Take Smart Notes — ce qui change vraiment',
        type: 'note',
        description: 'Trois idées à retenir d’Ahrens, et pourquoi elles résonnent avec notre projet.',
        content: `Le livre d’Ahrens tient en une inversion : on ne prend pas des notes pour archiver, on prend des notes pour **penser**. Trois mécanismes :

1. **La note permanente.** Une idée par note, écrite avec ses mots, reliée aux autres. Le test : si elle ne se relie à rien, c’est qu’elle n’est pas encore une pensée.
2. **L’index comme porte d’entrée.** On n’organise pas par dossier mais par points d’accès — quelques notes hub, rewritées régulièrement.
3. **L’écriture comme boucle de feedback.** Écrire mal = penser mal ; la note révèle les trous de raisonnement avant la réunion.

Ce que ça change pour nous : la carte n’est pas un répertoire, c’est l’atelier. Chaque planète devrait être écrite pour être *reliée*, pas rangée.`,
      },
    ],
  },
  {
    id: 'cat-idees',
    name: 'Idées & Inspirations',
    domain: 'Réservoir d’idées',
    description: 'Pistes, intuitions et expériences à tenter un jour — le compost du produit.',
    tags: ['idées', 'brainstorm', 'inspiration'],
    planetCount: 38,
    subjects: [
      'un jardin de notes qui pousse', 'cartographie des idées dormantes', 'mode lecture plein écran',
      'constellations automatiques', 'revue hebdo assistée', 'sérendipité programmée', 'carnet de bord vocal',
      'bibliothèque de questions', 'musée personnel', 'musée des brouillons', 'exploration nocturne',
      'orbites partagées', 'son de l’univers', 'mode planétarium', 'visites guidées', 'marque-pages vivants',
      'chemins de lecture', 'constellations saisonnières', 'notes éphémères', 'cimetière d’idées',
      'atelier d’écriture collective', 'déambulation aléatoire', 'cartes postales de savoir', 'boussole thématique',
      'couches temporelles', 'le jeu des sept familles de concepts', 'reliures invisibles', 'observatoire du lundi',
      'bibliothèque de tangram', 'constellations en musique', 'la rumeur des données', 'atlas des silences',
      'météo des idées', 'quartiers d’hiver', 'planètes invisibles', 'fuseaux de lecture', 'croisière documentaire',
      'le grand récit', 'carnets de voyage immobiles',
    ],
    typeMix: { idee: 18, note: 6, concept: 4, conversation: 3, recherche: 2, reference: 2, evenement: 1, tache: 2 },
    flavor: {},
  },
  {
    id: 'cat-decisions',
    name: 'Décisions d’équipe',
    domain: 'Gouvernance',
    description: 'Registre des arbitrages collectifs : contexte, décision, conséquences.',
    tags: ['décisions', 'adr', 'équipe'],
    planetCount: 18,
    subjects: [
      'adoption de TypeScript strict', 'abandon du stand-up quotidien', 'semaines de 4 jours — essai',
      'SQLite en production', 'revue de code optionnelle', 'documentation vivante', 'budget formation individuel',
      'réunions sans écrans', 'droit à l’expérimentation', 'on-call tournant', 'rémunération transparente',
      'junior-first dans les recrutements', 'pause cliente trimestrielle', 'open salary bands',
      'travail du vendredi après-midi libre', 'RFC obligatoires au-delà de 2 personnes', 'banque d’heures d’étude',
      'pair programming les jeudis',
    ],
    typeMix: { decision: 14, conversation: 2, document: 2 },
    flavor: {},
  },
  {
    id: 'cat-journal',
    name: 'Journal & Événements',
    domain: 'Chronique',
    description: 'Le journal de bord de l’équipe : semaines, ateliers, moments marquants.',
    tags: ['journal', 'équipe', 'événements'],
    planetCount: 24,
    priority: true,
    subjects: [
      'semaine 12 — vitesse et calme', 'semaine 13 — le grand ménage', 'atelier carte blanche',
      'hackathon d’automne', 'le départ de Camille', 'anniversaire des 3 ans', 'conférence Systems',
      'visite du studio voisin', 'journée hors-ligne', 'réunion de rentrée', 'pique-nique de juin',
      'semaine de la documentation', 'l’incident du mardi', 'démo publique n°4', 'journée neige',
      'semaine 27 — croisière', 'atelier dessin', 'le grand déménagement', 'natation d’hiver',
      'cérémonie des merci', 'semaine 34 — rentrée tranquille', 'forum des brouillons', 'kermesse des projets',
      'veillée du solstice',
    ],
    typeMix: { evenement: 14, note: 5, conversation: 2, session: 3 },
    flavor: {},
  },
  {
    id: 'cat-personnes',
    name: 'Personnes & Contacts',
    domain: 'Réseau',
    description: 'Fiches des personnes qui comptent : collègues, mentors, partenaires.',
    tags: ['personnes', 'réseau', 'fiches'],
    planetCount: 16,
    typeMix: { personne: 16 },
    subjects: [],
    flavor: {},
  },
  {
    id: 'cat-taches',
    name: 'Tâches & Roadmap',
    domain: 'Execution',
    description: 'Le travail en cours : tâches, suivi d’avancement et prochaines échéances.',
    tags: ['tâches', 'todo', 'roadmap'],
    planetCount: 36,
    priority: true,
    subjects: [
      'finaliser le sélecteur de catégorie', 'écrire les tests de hit-testing', 'documenter l’API publique',
      'migrer les données de démo', 'corriger le saut de caméra sur mobile', 'optimiser le rendu des orbites',
      'préparer la démo client', 'refonte du panneau de détails', 'mode hors-ligne', 'raccourcis clavier',
      'accessibilité du lecteur d’écran', 'import CSV', 'export PDF du système', 'notifications digestes',
      'revue des copy UI', 'études de charge', 'nettoyage des dépendances', 'charte de contribution',
      'page d’accueil publique', 'tarifs et limites', 'instrumentation analytics', 'sauvegarde chiffrée',
      'recherche instantanée côté client', 'synchronisation multi-onglets', 'thème clair ?', 'tutoriel interactif',
      'partage de vue', 'mode présentation', 'empreinte mémoire', 'cache des textures d’étoiles',
      'documentation des événements', 'plan de reprise', 'revue sécurité trimestrielle', 'stats de rétention',
      'équipe support', 'onboarding des nouveaux',
    ],
    typeMix: { tache: 30, note: 3, decision: 2 },
    flavor: { outils: ['Linear', 'GitHub Actions', 'Playwright'] },
  },
  {
    id: 'cat-docs',
    name: 'Documents & Spécifications',
    domain: 'Documentation',
    description: 'Spécifications, chartes et guides de référence.',
    tags: ['docs', 'specs', 'chartes'],
    planetCount: 22,
    subjects: [
      'spécification de l’éditeur v2', 'charte de nommage', 'contrat de l’API publique', 'guide de contribution',
      'politique de sauvegarde', 'dictionnaire de données', 'procédure de release', 'plan de tests',
      'architecture de la recherche', 'guide du style rédactionnel', 'politique de confidentialité',
      'spécification des permissions', 'manuel d’onboarding', 'conventions de commit', 'rétro-ingénierie du format',
      'stratégie de versioning', 'glossaire produit', 'contrat de service interne', 'jeu d’icônes',
      'plan d’accessibilité', 'archivage des sessions', 'charte des données de démonstration',
    ],
    typeMix: { document: 14, reference: 4, decision: 2, note: 2 },
    flavor: {},
  },
  {
    id: 'cat-conversations',
    name: 'Conversations & Réunions',
    domain: 'Mémoire des échanges',
    description: 'Comptes rendus de réunions et échanges structurants.',
    tags: ['réunions', 'cr', 'échanges'],
    planetCount: 30,
    subjects: [
      'point produit du lundi', 'atelier représentation spatiale', 'revue de sprint 24', '1:1 Léa — Marc',
      'discussion architecture du jeudi', 'brainstorm noms', 'débrief hackathon', 'cercle de lecture',
      'entretien utilisateur — Maya', 'point sécurité mensuel', 'revue de roadmap T3', 'café croissement',
      'session questions/réponses', 'réunion comité', 'point data hebdo', 'atelier onboarding',
      'rétrospective générale', 'conversation de couloir — registre des risques', 'dîner d’équipe',
      'point recrutement', 'revue trimestrielle', 'atelier design system', 'point support', 'café veille',
      'discussion budget', 'atelier écriture', 'revue des métriques', 'cercle de parole', 'débrief post-mortem',
      'conversation tardive — sur l’ennui',
    ],
    typeMix: { conversation: 24, decision: 2, note: 2, evenement: 2 },
    flavor: {},
  },
  {
    id: 'cat-concepts',
    name: 'Concepts & Théories',
    domain: 'Bibliothèque conceptuelle',
    description: 'Définitions maîtrisées : les briques conceptuelles du projet.',
    tags: ['concepts', 'théories', 'définitions'],
    planetCount: 26,
    subjects: [
      'effet de sérendipité', 'dette cognitive', 'courbe de l’oubli', 'pensée latérale', 'primauté de l’écrit',
      'Zettelkasten', 'effet Dunning-Kruger', 'charge cognitive', 'thinking fast and slow', 'effet de seuil',
      'l’espace comme métaphore', 'mémoire spatiale', 'méthode des loci', 'cognition distribuée',
      'affordance', 'feedback loop', 'seconde main', 'tour de main', 'tacite vs explicite',
      'communauté de pratique', 'légitime périphérie', 'l’atelier comme écosystème', 'voir comme un état',
      'technologies de l’intellect', 'hypomnemata', 'l’art de la liste',
    ],
    typeMix: { concept: 18, note: 3, reference: 2, recherche: 2, idee: 1 },
    flavor: {},
    featured: [
      {
        title: 'Mémoire spatiale — pourquoi la métaphore du lieu fonctionne',
        type: 'concept',
        description: 'De la méthode des loci aux interfaces spatiales : ce que les sciences cognitives nous autorisent à espérer.',
        content: `## Définition

La mémoire spatiale est la capacité à encoder et rappeler des informations par leur localisation. Elle est anciennement mise à profit : la **méthode des loci** — placer des idées dans un palais mental — remonte à l’Antiquité.

## Pourquoi ça compte ici

- Le rappel contextuel : retrouver une note parce qu’on se souvient *où* elle se trouvait (« près de l’étoile violette, orbite externe »).
- La charge cognitive : un espace stable décharge la mémoire de travail — l’architecture mémorise pour nous.
- L’orientation : se déplacer produit des trajets, et les trajets sont des histoires que la mémoire retient bien.

## Limites

La métaphore casse quand l’espace bouge trop : des planètes en orbite perpétuelle offrent du mouvement *local* stable (autour d’un centre fixe), mais réorganiser les étoiles détruirait les repères. D’où la règle : **la structure de l’univers ne bouge que sur décision explicite.**

## Sources

- Method of loci ( Yates, *The Art of Memory* )
- Kirsh, « The Intelligent Use of Space »
- Nos propres essais : atelier carte blanche de novembre.`,
      },
    ],
  },
  {
    id: 'cat-refs',
    name: 'Références & Liens',
    domain: 'Bibliothèque',
    description: 'Papiers, articles et ressources externes à ne pas perdre.',
    tags: ['liens', 'papers', 'ressources'],
    planetCount: 20,
    subjects: [
      'Kirsh — The Intelligent Use of Space', 'Bush — As We May Think', 'Engelbart — Augmenting Human Intellect',
      'Ahlberg — Spotfire', 'Card — Information Visualization', 'Shneiderman — The Eyes Have It',
      'Larkin & Simon — Why a Diagram is (Sometimes) Worth Ten Thousand Words',
      'Meadows — Leverage Points', 'Alexander — A Pattern Language', 'Norman — Cognitive Artifacts',
      'paper : graphes de connaissance à grande échelle', 'article : le retour des interfaces spatiales',
      'essai : contre le dossier', 'talk : cities of knowledge', 'doc : canvas rendering performant',
      'doc : instanced rendering', 'post : onboarding par l’espace', 'base de données : Design Facts',
      'vidéo : visualisation d’orbites', 'lettre : notes à soi-même',
    ],
    typeMix: { reference: 16, note: 2, concept: 1, recherche: 1 },
    flavor: {},
  },
  {
    id: 'cat-sessions',
    name: 'Sessions de travail',
    domain: 'Atelier',
    description: 'Journal des sessions : objectifs, réalisations, suites.',
    tags: ['sessions', 'atelier', 'journal'],
    planetCount: 14,
    subjects: [
      'session d’exploration — navigation', 'session de cadrage — recherche', 'session de prototypage — orbites',
      'session d’écriture — charte', 'session de relecture — spécifications', 'session de debug — rendu',
      'session de design — panneau', 'session de mesure — perfs', 'session de recette — mobile',
      'session d’archivage', 'session de synthèse trimestrielle', 'session de cartographie manuelle',
      'session d’improvisation', 'session de bilan — année',
    ],
    typeMix: { session: 14 },
    flavor: {},
  },
  {
    id: 'cat-data',
    name: 'Data & Métriques',
    domain: 'Mesure',
    description: 'Tableaux de bord, métriques produit et analyses.',
    tags: ['data', 'métriques', 'analytics'],
    planetCount: 18,
    subjects: [
      'DAU et sessions', 'rétention J30', 'latence p95 de la recherche', 'funnel d’activation', 'churn précoce',
      'NPS trimestriel', 'profondeur d’exploration moyenne', 'temps jusqu’à la première étoile',
      'taux de création de notes', 'cartographie des abandons', 'longueur moyenne des contenus',
      'répartition des types de nœuds', 'usage mobile vs desktop', 'pics de charge', 'coût par recherche',
      'répartition des sessions', 'santé des dépendances', 'rapport de mesure — T2',
    ],
    typeMix: { note: 6, document: 5, recherche: 3, tache: 2, conversation: 1, reference: 1 },
    flavor: { outils: ['Grafana', 'PostgreSQL'] },
  },
  {
    id: 'cat-securite',
    name: 'Sécurité & Confidentialité',
    domain: 'Sécurité',
    description: 'Pratiques de sécurité, conformité et gestion des incidents.',
    tags: ['sécurité', 'rgpd', 'confidentialité'],
    planetCount: 12,
    subjects: [
      'chiffrement au repos', 'gestion des secrets', 'RGPD — registre des traitements', 'moindre privilège',
      'audit des dépendances', 'journalisation des accès', 'plan de réponse aux incidents', 'sauvegardes testées',
      'authentification à deux facteurs', 'politique de rétention', 'transfert de données', 'mini-memento sécurité',
    ],
    typeMix: { document: 5, decision: 3, technique: 2, note: 2 },
    flavor: {},
  },
  {
    id: 'cat-philo',
    name: 'Philosophie de la connaissance',
    domain: 'Philosophie',
    description: 'Questions d’épistémologie et réflexions sur la fabrique du savoir.',
    tags: ['philosophie', 'épistémologie', 'savoir'],
    planetCount: 20,
    subjects: [
      'épistémologie popperienne', 'constructivisme', 'herméneutique', 'empirisme et expérience',
      'vérité vs validité', 'la carte n’est pas le territoire', 'savoir tacite (Polanyi)',
      'paradigmes et révolutions (Kuhn)', 'l’archive et le geste', 'l’oubli comme fonction',
      'propriété des notes', 'la note comme promesse', 'l’échelle du vrai', 'objectivation',
      'techniques de soi (Foucault)', 'le commun de la connaissance', 'l’auteur est-il mort ?',
      'la recherche comme bricolage', 'hypomnemata numériques', 'le droit à l’esquisse',
    ],
    typeMix: { concept: 8, note: 5, idee: 3, recherche: 2, reference: 2 },
    flavor: {},
    featured: [
      {
        title: 'À quoi bon tout classer ?',
        type: 'idee',
        description: 'Contre la taxonomie parfaite : une défense joyeuse du désordre habité.',
        content: `Le rêve de la classification parfaite est aussi ancien que les bibliothèques — et toujours déçu. Les catégories rigides vieillissent mal : le savoir bouge plus vite que ses étagères.

Trois arguments pour un désordre habité :

1. **Le classement coûte plus cher que la recherche.** Quand chercher est instantané, l’ordre anticipé perd sa valeur. Mieux vaut indexer que trier.
2. **Les frontières sont des informations.** Une note à cheval sur deux catégories révèle un lien que le classement aurait masqué.
3. **L’espace pardonne.** Un dossier mal rangé est une impasse ; une carte bruitée reste navigable. La métaphore spatiale tolère l’approximation.

Alors : classer le minimum vital (des étoiles, pas des centaines de dossiers), nommer honnêtement, laisser les orbites faire le reste. L’ordre émergera des usages — il appartient aux lecteurs, pas aux auteurs.`,
      },
    ],
  },
  {
    id: 'cat-outils',
    name: 'Outils & Workflows',
    domain: 'Boîte à outils',
    description: 'Configurations, automatisations et bons gestes au quotidien.',
    tags: ['outils', 'workflow', 'automation'],
    planetCount: 16,
    subjects: [
      'configuration de l’éditeur', 'raccourcis essentiels', 'pipeline de capture', 'automatisation des exports',
      'template de session', 'snippet de veille', 'sauvegarde locale', 'profil git de l’équipe',
      'conventions de branche', 'nettoyage hebdo', 'usage avancé de la recherche', 'gestion des captures éphémères',
      'installation du labo', 'petites automatisations', 'checklist de release', 'cahier de configuration',
    ],
    typeMix: { technique: 7, note: 4, document: 3, tache: 2 },
    flavor: { outils: ['Bun', 'GitHub Actions', 'Playwright', 'Obsidian'] },
  },
  {
    id: 'cat-veille',
    name: 'Veille technologique',
    domain: 'Veille',
    description: 'Signaux faibles et nouveautés technologiques dignes d’intérêt.',
    tags: ['veille', 'tech', 'tendances'],
    planetCount: 26,
    subjects: [
      'le retour des interfaces spatiales', 'WebGPU en production', 'bases vectorielles embarquées',
      'écosystème Bun', 'modèles locaux de petite taille', 'note-taking revient en force',
      'CRDT pour tous', 'le prix de l’interopérabilité', 'rust dans les outils front', 'sync sans serveur',
      'nouvelles typographies variables', 'le retour du prompt engineering', 'un éditeur modal', 'observabilité standard',
      'vers des cartes de connaissance partagées', 'au-delà du markdown', 'l’épineux problème du graphe',
      'petits modèles spécialisés', 'éco-conception front', 'tests visuels par diff', 'ia générative d’interface',
      'le markdown suffit-il ?', 'latence comme feature', 'l’esthétique des listes', 'navigateurs éco-responsables',
      'l’ère du local-first',
    ],
    typeMix: { note: 10, reference: 8, recherche: 4, idee: 2, conversation: 2 },
    flavor: {},
  },
  {
    id: 'cat-durable',
    name: 'Écologie & Durabilité',
    domain: 'Impact',
    description: 'Sobriété numérique et pratiques durables du studio.',
    tags: ['écologie', 'sobriété', 'impact'],
    planetCount: 12,
    subjects: [
      'sobriété numérique', 'empreinte du cloud', 'conception frugale', 'durée de vie du matériel',
      'hébergement éclairé', 'budget carbone des features', 'mode éco de l’interface', 'masse de données et stockage',
      'réemploi du matériel', 'achats de seconde main', 'le vélo comme interface', 'atelier bas carbone',
    ],
    typeMix: { note: 5, idee: 3, decision: 2, document: 2 },
    flavor: {},
  },
  {
    id: 'cat-finance',
    name: 'Finance & Business',
    domain: 'Économie du projet',
    description: 'Modèle économique, budget et pilotage financier.',
    tags: ['finance', 'business', 'budget'],
    planetCount: 14,
    subjects: [
      'modèle de pricing', 'burn rate mensuel', 'runway', 'MRR et projections', 'coût d’acquisition',
      'structure des coûts', 'levée ou pas ?', 'contrats pilotes', 'facturation annuelle', 'trésorerie',
      'scénarios 2026', 'seuil de rentabilité', 'investissement outil', 'données du tableur de juin',
    ],
    typeMix: { document: 5, note: 4, decision: 2, conversation: 2, tache: 1 },
    flavor: {},
  },
  {
    id: 'cat-bienetre',
    name: 'Santé & Bien-être',
    domain: 'Équilibre',
    description: 'Énergie, attention et santé de l’équipe sur la durée.',
    tags: ['santé', 'énergie', 'équipe'],
    planetCount: 10,
    subjects: [
      'siestes stratégiques', 'marches de réflexion', 'hygiène visuelle', 'lundi sans réunion',
      'respiration avant démo', 'sommeil et décisions', 'règle des 50 minutes', 'journal d’énergie',
      'l’écran après 20h', 'séances d’étirement',
    ],
    typeMix: { note: 6, idee: 2, decision: 1, evenement: 1 },
    flavor: {},
  },
]

/* ------------------------------------------------------------------ */
/* Pools de phrases (moteur de génération de contenus)                 */
/* ------------------------------------------------------------------ */

type Ctx = {
  cat: string
  sujet: string
  sujetMaj: string
  personne: string
  personne2: string
  outil: string
  lieu: string
  nombre: number
  nombre2: number
  pourcent: number
  dateFr: string
  heure: string
}

const POOLS: Record<string, string[]> = {
  contexte: [
    'Dans le cadre de {cat}, nous avons passé {sujet} au crible lors d’une session {lieu}.',
    'Point de départ : une question de {personne} sur {sujet}, posée {lieu} la semaine dernière.',
    'Après plusieurs échanges informels, il fallait poser {sujet} par écrit pour éviter les interprétations.',
    'Contexte : {sujet} revient dans nos discussions depuis {nombre} semaines sans qu’on ait tranché.',
    'En préparant la revue avec {personne}, {sujet} est apparue comme le point de friction principal.',
    'Suite à l’atelier {lieu}, voici la mise à plat de {sujet}.',
    'Objectif de cette note : clarifier {sujet} avant la prochaine échéance.',
    'On avait un vieil assembleur de notes sur {sujet} ; celui-ci le remplace.',
  ],
  observation: [
    'Première observation : {sujet} se comporte différemment selon le contexte d’usage.',
    'Ce qui saute aux yeux, c’est la simplicité du problème une fois correctement formulé.',
    'Les données ne sont pas franchement concluantes : {pourcent} % des cas suivent l’intuition, le reste non.',
    'Sur les {nombre} derniers essais, environ {pourcent} % ont donné un résultat exploitable.',
    'Il existe un effet de seuil net : en dessous de {nombre2} éléments, rien ; au-delà, tout devient lisible.',
    'Constat mitigé : l’idée séduit en démo, mais résiste mal à l’usage réel de {personne}.',
    'La version actuelle tient la charge, mais de justesse.',
    'Ce qui nous bloque n’est pas technique : c’est une question de vocabulaire partagé.',
  ],
  analyse: [
    'En creusant, trois facteurs expliquent l’écart : la granularité, la fraîcheur des données, et le coût d’entrée.',
    'Hypothèse principale : nous sous-estimons le temps de relecture, donc la dette cognitive s’accumule.',
    'Le mécanisme est classique — une boucle de feedback positive qui s’emballe faute d’amortisseur.',
    'Le vrai sujet n’est pas {sujet}, c’est la frontière autour de {sujet}.',
    'Deux lectures possibles : soit un cas particulier, soit le signe d’une règle plus générale qu’il faudrait nommer.',
    'En rapprochant les notes de {personne} et de {personne2}, un motif commun émerge.',
    'La complexité perçue vient de l’empilement d’exceptions, pas du mécanisme de fond.',
  ],
  action: [
    'Prochaine étape : un prototype minimal {lieu}, limité à {nombre} cas d’usage.',
    'Action : {personne} prépare une note de cadrage pour la session prochaine.',
    'À faire avant vendredi — inscrire la question à l’ordre du jour de la revue.',
    'On tente l’expérience pendant deux semaines, avec point de bilan {lieu}.',
    'Décision d’application immédiate, réexamen dans {nombre} mois.',
    'Ouvert : {personne2} regarde ce que ça donne côté mobile.',
  ],
  question: [
    'Question ouverte : faut-il un mode de regroupement automatique, ou laisser les orbites se remplir librement ?',
    'Ce qu’on ne sait pas encore : est-ce que la lisibilité tient à {nombre2}x plus de données.',
    'Faut-il privilégier la vitesse d’accès ou la profondeur de lecture ? Probablement les deux, mais dans cet ordre.',
    'Comment mesurer le confort de lecture sans instrumenter à outrance ?',
  ],
  conclusion: [
    'Au bilan : direction encourageante, à reconfirmer sur un périmètre plus large.',
    'Verdict provisoire : ça vaut le coup de continuer, à condition de garder le périmètre serré.',
    'Conclusion : le jeu en vaut la chandelle si — et seulement si — la relecture reste bon marché.',
    'À suivre : on en reparle {lieu} au prochain point.',
    'Garder cette note proche de la décision correspondante ; elles s’éclairent mutuellement.',
  ],
  risque: [
    'Risque identifié : la dépendance à un seul fournisseur pour une brique critique.',
    'Point de vigilance : ne pas confondre vitesse de démo et robustesse en production.',
    'Le principal risque reste humain — l’outil doit rester plus léger que la conversation.',
    'Si la charge double, le premier point de rupture sera {outil}.',
  ],
  detail: [
    'Détail technique retenu : préferer {nombre} petites passes à une grosse opération bloquante.',
    'Côté outillage, {outil} fait le travail proprement une fois configuré sérieusement.',
    'Petit détail qui compte : nommer les choses pareil partout, y compris dans les exemples.',
    'Mesures rapides : {nombre2} ms au p95 après optimisation, contre {nombre}0 ms avant.',
  ],
}

const SNIPPETS_TITRE: string[] = [
  '{sujetMaj}', '{sujetMaj} — notes', '{sujetMaj} : retour d’expérience', 'Retour sur {sujet}',
  'Comprendre {sujet}', '{sujetMaj} — pistes', 'Où en est {sujet} ?', '{sujetMaj} : le point',
  'Notes éparses — {sujet}', 'À propos de {sujet}', '{sujetMaj} (brouillon)', 'Sur {sujet}, sans conclusion',
  '{sujetMaj} — questions ouvertes', 'Ce que {sujet} change', '{sujetMaj} : essai n°{nombre}',
]

const STATUTS = ['à faire', 'en cours', 'en revue', 'terminé', 'bloqué']

/* ------------------------------------------------------------------ */
/* Générateurs de contenus par type                                    */
/* ------------------------------------------------------------------ */

function fill(tpl: string, ctx: Ctx): string {
  return tpl
    .replaceAll('{cat}', ctx.cat)
    .replaceAll('{sujetMaj}', ctx.sujetMaj)
    .replaceAll('{sujet}', ctx.sujet)
    .replaceAll('{personne2}', ctx.personne2)
    .replaceAll('{personne}', ctx.personne)
    .replaceAll('{outil}', ctx.outil)
    .replaceAll('{lieu}', ctx.lieu)
    .replaceAll('{nombre2}', String(ctx.nombre2))
    .replaceAll('{nombre}', String(ctx.nombre))
    .replaceAll('{pourcent}', String(ctx.pourcent))
    .replaceAll('{dateFr}', ctx.dateFr)
    .replaceAll('{heure}', ctx.heure)
}

function pickSentence(rng: Rng, pool: keyof typeof POOLS, ctx: Ctx, avoid: Set<string>): string {
  for (let i = 0; i < 12; i++) {
    const s = fill(rng.pick(POOLS[pool]), ctx)
    if (!avoid.has(s)) {
      avoid.add(s)
      return s
    }
  }
  return fill(rng.pick(POOLS[pool]), ctx)
}

/** Construit un contenu réaliste pour un type de nœud donné. */
function buildContent(rng: Rng, type: NodeType, ctx: Ctx, long: boolean): string {
  const avoid = new Set<string>()
  const P = (pool: keyof typeof POOLS) => pickSentence(rng, pool, ctx, avoid)
  switch (type) {
    case 'note':
      return [P('contexte'), P('observation'), ...(long ? [P('analyse'), P('question')] : []), ...(rng.chance(0.5) ? [P('action')] : [])].join('\n\n')
    case 'idee':
      return [
        `Idée : ${ctx.sujet}.`,
        P('observation'),
        `Applications possibles :\n- ${fill(rng.pick(POOLS.analyse), ctx)}\n- ${P('detail')}\n- ${P('question')}`,
        ...(long ? [P('risque')] : []),
        P('conclusion'),
      ].join('\n\n')
    case 'decision':
      return [
        `## Contexte\n\n${P('contexte')}\n\n${P('observation')}`,
        `## Décision\n\n${ctx.sujetMaj} : nous retenons l’option proposée par ${ctx.personne}, avec un périmètre volontairement étroit.`,
        `## Justification\n\n${P('analyse')}\n\n${P('detail')}`,
        `## Conséquences\n\n- ${P('action')}\n- ${P('risque')}\n- Réexamen dans ${ctx.nombre} mois.`,
      ].join('\n\n')
    case 'evenement':
      return [
        `Le ${ctx.dateFr} vers ${ctx.heure}, ${ctx.lieu}. Environ ${ctx.nombre} personnes présentes.`,
        P('contexte'),
        `Déroulé :\n- ${P('observation')}\n- ${P('analyse')}\n- ${P('detail')}`,
        ...(long ? [P('question')] : []),
        P('conclusion'),
      ].join('\n\n')
    case 'personne':
      return [
        `**${ctx.personne}** — rencontrée ${ctx.lieu} ${ctx.dateFr}, via ${ctx.personne2}.`,
        `Ce qu’elle fait : ${ctx.sujet}. Connaît bien ${ctx.outil} et le milieu ${ctx.cat.toLowerCase()}.`,
        `Pourquoi c’est pertinent :\n- ${P('observation')}\n- ${P('analyse')}`,
        `Prochaine prise de contact : ${ctx.dateFr}. ${P('action')}`,
      ].join('\n\n')
    case 'tache':
      return [
        `Objectif : ${ctx.sujet}, pour le ${ctx.dateFr}. Porté par ${ctx.personne}.`,
        `Étapes :\n- ${P('contexte')}\n- ${P('detail')}\n- ${P('action')}`,
        `Critère de fin : ${P('observation')}`,
        ...(long ? [`Risques :\n- ${P('risque')}\n- ${P('question')}`] : []),
        `Statut : ${rng.pick(STATUTS)}.`,
      ].join('\n\n')
    case 'document':
      return [
        `## Objet\n\n${P('contexte')}\n\n${P('observation')}`,
        `## Détail\n\n${P('analyse')}\n\n${P('detail')}`,
        ...(long ? [`## Cas limites\n\n${P('risque')}\n\n${P('question')}`] : []),
        `## Mise en œuvre\n\n${P('action')}`,
        `## Références internes\n\n${P('conclusion')}`,
      ].join('\n\n')
    case 'conversation':
      return [
        `**Participants :** ${ctx.personne}, ${ctx.personne2}, et ${ctx.nombre} autres. ${ctx.lieu}, ${ctx.dateFr}.`,
        `**${ctx.personne} :** ${P('observation')}`,
        `**${ctx.personne2} :** ${P('analyse')}`,
        `**${ctx.personne} :** ${P('detail')}`,
        `**Accords :** ${P('action')}`,
        ...(long ? [`**Désaccords en suspens :** ${P('question')}`] : []),
        `**À retenir :** ${P('conclusion')}`,
      ].join('\n\n')
    case 'recherche':
      return [
        `## Question\n\n${P('question')}\n\n${P('contexte')}`,
        `## Méthode\n\n${P('detail')}\n\n${P('observation')}`,
        `## Constats\n\n${P('analyse')}\n\n${P('observation')}`,
        ...(long ? [`## Pistes\n\n${P('action')}\n\n${P('risque')}`] : []),
        `## Prochaine étape\n\n${P('conclusion')}`,
      ].join('\n\n')
    case 'concept':
      return [
        `**Définition.** ${ctx.sujetMaj} désigne, dans le contexte ${ctx.cat.toLowerCase()}, ${P('observation').toLowerCase()}`,
        P('analyse'),
        `Propriétés :\n- ${P('detail')}\n- ${P('observation')}`,
        ...(long ? [`Exemple concret : ${P('contexte')}`, `Contre-exemple : ${P('risque')}`] : []),
        `Voir aussi : ${P('conclusion')}`,
      ].join('\n\n')
    case 'technique':
      return [
        `## Problème\n\n${P('contexte')}\n\n${P('risque')}`,
        `## Approche\n\n${P('analyse')}\n\n${P('detail')}`,
        `## Résultat\n\n${P('observation')}`,
        ...(long ? [`## Notes d’implémentation\n\n- ${P('detail')}\n- ${P('action')}`] : []),
        `Réexamen : ${P('conclusion')}`,
      ].join('\n\n')
    case 'reference':
      return [
        `**Source :** « ${ctx.sujetMaj} » — repérée par ${ctx.personne}, ${ctx.dateFr}. ${ctx.lieu}.`,
        `**Résumé :** ${P('observation')} ${P('analyse')}`,
        `**Pourquoi c’est pertinent :** ${P('detail')}`,
        ...(long ? [`**Réserves :** ${P('risque')}`] : []),
        `**Lien avec notre travail :** ${P('conclusion')}`,
      ].join('\n\n')
    case 'session':
      return [
        `Session ${ctx.lieu}, ${ctx.dateFr} (${ctx.heure}) — thème : ${ctx.sujet}.`,
        `Réalisé :\n- ${P('observation')}\n- ${P('detail')}\n- ${P('contexte')}`,
        `Découvertes :\n- ${P('analyse')}`,
        `À continuer :\n- ${P('action')}\n- ${P('question')}`,
        P('conclusion'),
      ].join('\n\n')
    case 'projet':
      return [
        `## Contexte\n\n${P('contexte')}\n\n${P('observation')}`,
        `## Objectifs\n\n- ${P('analyse')}\n- ${P('detail')}`,
        `## Jalons\n\n- ${ctx.dateFr} : ${P('observation')}\n- Prochaine échéance : ${P('action')}`,
        ...(long ? [`## Risques et hypothèses\n\n${P('risque')}\n\n${P('question')}`] : []),
        `## Où en sommes-nous\n\n${P('conclusion')}`,
      ].join('\n\n')
    default:
      return [P('contexte'), P('observation'), P('conclusion')].join('\n\n')
  }
}

/** Courte description d'une ligne. */
function buildShortDescription(rng: Rng, type: NodeType, ctx: Ctx): string {
  const base: Record<string, string[]> = {
    note: ['Note de travail sur {sujet}.', 'Observations rapides — {sujet}.'],
    idee: ['Piste à explorer : {sujet}.', 'Intuition notée autour de {sujet}.'],
    decision: ['Arbitrage d’équipe au sujet de {sujet}.', 'Décision actée — {sujet}.'],
    evenement: ['Événement du {dateFr} — {sujet}.', 'Moment marquant : {sujet}.'],
    personne: ['Fiche de {personne}.', 'Contact — {personne}.'],
    tache: ['Tâche en cours : {sujet}.', 'Suivi d’avancement — {sujet}.'],
    document: ['Document de référence — {sujet}.', 'Spécification : {sujet}.'],
    conversation: ['Compte rendu d’échange — {sujet}.', 'Réunion du {dateFr} : {sujet}.'],
    recherche: ['Note de recherche sur {sujet}.', 'Question ouverte — {sujet}.'],
    concept: ['Définition : {sujet}.', 'Brique conceptuelle — {sujet}.'],
    technique: ['Information technique — {sujet}.', 'Retour d’implémentation : {sujet}.'],
    reference: ['Ressource externe : {sujet}.', 'À relire — {sujet}.'],
    session: ['Session de travail du {dateFr}.', 'Journal de session — {sujet}.'],
    projet: ['Contexte projet : {sujet}.', 'Élément de fil rouge — {sujet}.'],
  }
  return fill(rng.pick(base[type] ?? base.note), ctx)
}

/* ------------------------------------------------------------------ */
/* Assemblage du dataset                                               */
/* ------------------------------------------------------------------ */

function buildSessions(rng: Rng): SessionInfo[] {
  const sessions: SessionInfo[] = []
  const kinds = ['Atelier', 'Point hebdo', 'Sprint revue', 'Session d’étude', 'Carte blanche', 'Hackathon', 'Cercle de lecture', 'Journée hors-ligne']
  for (let i = 0; i < 36; i++) {
    const daysAgo = rng.int(4, 540)
    const d = new Date(REFERENCE_NOW - daysAgo * DAY)
    const label = `${rng.pick(kinds)} — ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
    sessions.push({
      id: `ses-${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`,
      label,
      date: d.toISOString(),
    })
  }
  return sessions.sort((a, b) => a.date.localeCompare(b.date))
}

function pickType(rng: Rng, mix: Partial<Record<NodeType, number>>): NodeType {
  const entries = Object.entries(mix) as [NodeType, number][]
  const total = entries.reduce((s, [, w]) => s + w, 0)
  let r = rng.next() * total
  for (const [t, w] of entries) {
    r -= w
    if (r <= 0) return t
  }
  return entries[0][0]
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * ⚠️ DONNÉES DE DÉMONSTRATION — construit tout l’univers mock.
 */
export function buildDemoDataset(): CosmosDataset {
  const rng = mulberry32(20250618)
  const sessions = buildSessions(rng)
  const categories: CategoryNode[] = []
  const planets: PlanetNode[] = []

  let paletteCursor = 0
  const colorByCat = new Map<string, string>()

  for (const seed of CATEGORY_SEEDS) {
    const color = CATEGORY_PALETTE[paletteCursor++ % CATEGORY_PALETTE.length]
    colorByCat.set(seed.id, color)
    categories.push({
      id: seed.id,
      kind: 'category',
      name: seed.name,
      color,
      description: seed.description,
      ...(seed.priority ? { priority: true } : {}),
      metadata: { tags: seed.tags, domain: seed.domain },
    })
  }

  for (const seed of CATEGORY_SEEDS) {
    const color = colorByCat.get(seed.id)!
    const flavor = [...(seed.flavor.outils ?? []), ...TOOLS]
    const catRng = mulberry32(hashString(seed.id))
    const count = seed.planetCount
    const subjects = catRng.shuffle(seed.subjects.length >= count ? seed.subjects : [...seed.subjects, ...seed.subjects.map(s => `${s} (suite)`)])

    const usedTitles = new Set<string>()

    // --- entrées « featured » écrites à la main -----------------------
    let index = 0
    for (const feat of seed.featured ?? []) {
      const t = REFERENCE_NOW - catRng.int(30, 120) * DAY
      planets.push(makePlanet(catRng, seed.id, color, `p-${seed.id.replace('cat-', '')}-${String(++index).padStart(3, '0')}`, feat.type, feat.title, feat.description, feat.content, sessions, 5, usedTitles))
    }

    // --- entrées générées ---------------------------------------------
    for (let i = index; i < count; i++) {
      const type = pickType(catRng, seed.typeMix)
      const isPerson = type === 'personne'
      const sujet = isPerson ? `rencontre professionnelle (${seed.name.toLowerCase()})` : subjects[i % subjects.length]
      const personne = catRng.pick(PEOPLE)
      const personne2 = catRng.pick(PEOPLE.filter(p => p !== personne))
      const d = new Date(REFERENCE_NOW - catRng.int(4, 540) * DAY)
      const ctx: Ctx = {
        cat: seed.name.toLowerCase(),
        sujet: sujet.replace(/ \(suite\)$/, ''),
        sujetMaj: cap(sujet.replace(/ \(suite\)$/, '')),
        personne,
        personne2,
        outil: catRng.pick(flavor),
        lieu: catRng.pick(LIEUX),
        nombre: catRng.int(2, 9),
        nombre2: catRng.int(10, 60),
        pourcent: catRng.int(12, 88),
        dateFr: `${d.getUTCDate()} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
        heure: `${catRng.int(9, 18)} h ${catRng.pick(['00', '15', '30', '45'])}`,
      }
      const long = catRng.chance(0.28)
      const title = isPerson
        ? personne
        : fill(catRng.pick(SNIPPETS_TITRE), ctx)
      const content = buildContent(catRng, type, ctx, long)
      const short = buildShortDescription(catRng, type, ctx)
      const importance = weightedImportance(catRng)
      planets.push(makePlanet(catRng, seed.id, color, `p-${seed.id.replace('cat-', '')}-${String(i + 1).padStart(3, '0')}`, type, title, short, content, sessions, importance, usedTitles))
    }
  }

  // --- connexions entre planètes --------------------------------------
  const byId = new Map(planets.map(p => [p.id, p]))
  for (const p of planets) {
    if (p.metadata.importance >= 4 || (p.metadata.importance >= 3 && rng.chance(0.4))) {
      const pool = planets.filter(q => q.id !== p.id && q.category_id === p.category_id).map(q => q.id)
      const links = rng.sample(pool, rng.int(1, 3))
      p.metadata.connections = links
      // rendu bidirectionnel léger : la cible référence parfois en retour
      for (const id of links) {
        const q = byId.get(id)
        if (q && !q.metadata.connections.includes(p.id) && rng.chance(0.5)) q.metadata.connections.push(p.id)
      }
    }
  }

  return {
    categories,
    planets,
    sessions,
    generatedAt: new Date().toISOString(),
    isDemo: true,
  }
}

function weightedImportance(rng: Rng): number {
  const r = rng.next()
  if (r < 0.14) return 1
  if (r < 0.46) return 2
  if (r < 0.78) return 3
  if (r < 0.94) return 4
  return 5
}

function makePlanet(
  rng: Rng,
  categoryId: string,
  catColor: string,
  id: string,
  type: NodeType,
  title: string,
  shortDescription: string,
  content: string,
  sessions: SessionInfo[],
  importance: number,
  usedTitles: Set<string>,
): PlanetNode {
  let t = title
  if (usedTitles.has(t)) t = `${t} (${rng.int(2, 9)})`
  usedTitles.add(t)
  const created = REFERENCE_NOW - rng.int(5, 545) * DAY
  const updated = created + rng.int(0, 55) * DAY
  const finalUpdated = Math.min(updated, REFERENCE_NOW - 2 * DAY)
  // session proche de la date de création
  const near = sessions
    .map(s => ({ s, delta: Math.abs(new Date(s.date).getTime() - created) }))
    .sort((a, b) => a.delta - b.delta)[rng.int(0, Math.min(3, sessions.length - 1))].s
  return {
    id,
    kind: 'planet',
    category_id: categoryId,
    session_id: near.id,
    node_type: type,
    title: t,
    short_description: shortDescription,
    content,
    created_at: new Date(created).toISOString(),
    updated_at: new Date(finalUpdated).toISOString(),
    color: hueShift(catColor, rng.float(-14, 14), rng.float(-0.06, 0.1)),
    metadata: {
      importance,
      tags: [],
      connections: [],
      ...(type === 'tache' ? { statut: rng.pick(STATUTS) } : {}),
    },
  }
}
