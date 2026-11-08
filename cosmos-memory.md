# Mémoire COSMOS

Tu as une mémoire externe persistante : le serveur MCP COSMOS (outils `cosmos_*`).
Tu oublies tout entre deux conversations, COSMOS non. Utilise-la.

## Principe
- **Surface** : résumé court de chaque souvenir (léger).
- **Abyss** : contenu complet, chargé seulement si besoin (`cosmos_recall`).
- Les souvenirs sont rangés par catégorie. Une catégorie **prioritaire** est chargée au début de chaque conversation.

## Début de conversation (toujours)
1. Appelle `cosmos_priority_context()`. Applique les règles et préférences reçues.
2. Ne charge rien d'autre tant que ce n'est pas utile.

## Avant de répondre
Si la question touche au passé, à un projet, à une décision ou à une préférence :
`cosmos_query(query_text)` → si un résumé est utile, `cosmos_recall(node_id)` pour le détail.
Ne devine pas ce que COSMOS peut te dire.

## Quand écrire (`cosmos_write`)
Écris dès que l'utilisateur donne une information **durable** :
- décision, préférence, règle, fait sur lui ou son projet, tâche en cours.
- Un souvenir = une idée, une ou deux phrases, autonome (compréhensible seul).
- N'écris pas : bavardage, détails temporaires, ce que tu peux relire dans le code.
- Avant d'écrire, fais un `cosmos_query` rapide : si un souvenir existe déjà, utilise `cosmos_update_node` au lieu de créer un doublon.
- Catégories prioritaires (`priority=True`) : seulement `regle` et `preference`. Garde-les très courtes.

## Auto-amélioration
Après une tâche terminée, une erreur ou une correction de l'utilisateur, demande-toi :
« Qu'est-ce qui m'aurait fait gagner du temps si je l'avais su avant ? »

1. **Correction ou échec** → `cosmos_write(..., node_type="lecon")` avec le format :
   `Quand <situation> → faire <action>, parce que <raison>.`
2. **Une leçon revient 2 fois** → promeus-la : `priority=True` dans une catégorie `regle`.
3. **Une leçon est fausse ou dépassée** → corrige-la (`cosmos_update_node`) ou supprime-la (`cosmos_delete_node`).
4. **Ménage** (quand `cosmos_status()` montre beaucoup de souvenirs) : fusionne les catégories proches (`cosmos_merge_categories`), supprime les doublons.
5. Garde le « sac à dos » petit : si `cosmos_priority_context()` devient long, déprioritise ce qui n'est plus essentiel (`cosmos_set_category_priority`).

## Règles de sécurité
- Ne stocke jamais de mot de passe, clé API ou donnée sensible.
- Ne supprime en masse (`cosmos_delete_all`, `cosmos_delete_category`) que sur demande explicite de l'utilisateur.
- Si COSMOS ne répond pas, dis-le et continue sans.
