"""
Tests de base pour CosmosEngine -- pas de mock, vraie base SQLite
temporaire, vraies operations. Lancer avec : python -m pytest tests/
(ou directement : python tests/test_cosmos.py)
"""

import os
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cosmos import CosmosEngine
from cosmos import web_export


class TestCosmosEngine(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.tmpdir, "test_cosmos.db")
        self.engine = CosmosEngine(db_path=self.db_path)

    def tearDown(self):
        self.engine.close()

    def test_write_and_recall_exact(self):
        content = "Le budget total de Nyomni est de 2919 milliards de parametres."
        node_id = self.engine.write_node(content, session_id="s1")
        recalled = self.engine.recall(node_id)
        self.assertIsNotNone(recalled)
        self.assertEqual(recalled["abyss"], content)
        self.assertTrue(len(recalled["surface"]) <= len(content) + 5)

    def test_recall_unknown_id_returns_none(self):
        self.assertIsNone(self.engine.recall("id-qui-nexiste-pas"))

    def test_query_finds_semantically_related_node(self):
        self.engine.write_node("Le chat noir dort sur le canape du salon.", session_id="s1")
        target_id = self.engine.write_node("Le chat noir se reveille et miaule pour manger.", session_id="s1")
        self.engine.write_node("La bourse europeenne a cloture en hausse ce jeudi.", session_id="s1")

        results = self.engine.query("chat qui miaule", top_k=2, session_id="s1")
        self.assertGreaterEqual(len(results), 1)
        top_ids = [r["id"] for r in results]
        self.assertIn(target_id, top_ids)
        # Le score du premier resultat doit etre strictement positif
        self.assertGreater(results[0]["score"], 0.0)

    def test_auto_link_thematic_creates_edge(self):
        n1 = self.engine.write_node("Nyomni utilise un MoME avec des experts de modalite dedies.", session_id="s1")
        n2 = self.engine.write_node("Le MoME de Nyomni a un groupe d'experts pour la profondeur.", session_id="s1")
        neighbors_n1 = self.engine.neighbors(n1, edge_type="proximite_thematique")
        neighbor_ids = [n["neighbor"] for n in neighbors_n1]
        self.assertIn(n2, neighbor_ids)

    def test_auto_link_temporal_creates_chain(self):
        n1 = self.engine.write_node("Premier message de la session.", session_id="s2")
        n2 = self.engine.write_node("Deuxieme message de la session.", session_id="s2")
        neighbors_n2 = self.engine.neighbors(n2, edge_type="continuite_temporelle")
        neighbor_ids = [n["neighbor"] for n in neighbors_n2]
        self.assertIn(n1, neighbor_ids)

    def test_manual_citation_link(self):
        n1 = self.engine.write_node("Fait etabli il y a longtemps.", session_id="s3")
        n2 = self.engine.write_node("Nouveau message qui cite le fait precedent.", session_id="s3")
        self.engine.link(n2, n1, edge_type="citation")
        neighbors_n2 = self.engine.neighbors(n2, edge_type="citation")
        self.assertEqual(neighbors_n2[0]["neighbor"], n1)

    def test_reindex_embeddings_recomputes_all_vectors(self):
        n1 = self.engine.write_node("Le chat noir dort sur le canape.", session_id="s5")
        n2 = self.engine.write_node("Le chat noir se reveille et miaule.", session_id="s5")
        count = self.engine.reindex_embeddings()
        self.assertEqual(count, 2)
        # Apres reindexation, la recherche semantique doit toujours fonctionner normalement.
        results = self.engine.query("chat qui miaule", top_k=1, session_id="s5")
        self.assertEqual(results[0]["id"], n2)

    def test_auto_categorization_assigns_sensible_type(self):
        node_id = self.engine.write_node(
            "Il faut encore ajouter les tests de la nouvelle fonctionnalite.", session_id="cat"
        )
        node = self.engine.recall(node_id)
        self.assertEqual(node["node_type"], "tache")

    def test_explicit_node_type_overrides_auto_categorization(self):
        node_id = self.engine.write_node("Contenu quelconque.", session_id="cat", node_type="forcé")
        node = self.engine.recall(node_id)
        self.assertEqual(node["node_type"], "forcé")

    def test_status_counts(self):
        self.engine.write_node("Un.", session_id="a")
        self.engine.write_node("Deux.", session_id="b")
        status = self.engine.status()
        self.assertEqual(status["n_nodes"], 2)
        self.assertEqual(status["n_sessions"], 2)

    def test_persistence_across_reconnect(self):
        node_id = self.engine.write_node("Ce message doit survivre a une reconnexion.", session_id="s4")
        self.engine.close()
        reopened = CosmosEngine(db_path=self.db_path)
        recalled = reopened.recall(node_id)
        self.assertIsNotNone(recalled)
        self.assertEqual(recalled["abyss"], "Ce message doit survivre a une reconnexion.")
        reopened.close()

    def test_visualize_generates_valid_html(self):
        from cosmos import visualize

        n1 = self.engine.write_node("Nyomni utilise un MoME avec des experts de modalite dedies.", session_id="viz")
        n2 = self.engine.write_node("Le MoME de Nyomni a un groupe d'experts pour la profondeur.", session_id="viz")

        graph_data = self.engine.export_graph()
        self.assertEqual(len(graph_data["nodes"]), 2)
        self.assertGreaterEqual(len(graph_data["edges"]), 1)  # lien thematique auto

        out_path = os.path.join(self.tmpdir, "graph.html")
        saved_path = visualize.save_html(graph_data, out_path)
        self.assertTrue(os.path.exists(saved_path))

        with open(saved_path, encoding="utf-8") as f:
            html = f.read()
        self.assertIn("<svg", html)
        self.assertIn(n1, html)
        self.assertIn(n2, html)
        self.assertIn("d3.min.js", html)

    def test_visualize_handles_empty_graph(self):
        from cosmos import visualize

        graph_data = self.engine.export_graph()
        self.assertEqual(graph_data["nodes"], [])
        html = visualize.build_html(graph_data)
        self.assertIn("<svg", html)
        self.assertIn("0 noeuds", html)

    def test_explicit_node_type_creates_new_category(self):
        self.engine.write_node("Regle du projet : toujours repondre en francais.", session_id="sac", node_type="regle")
        categories = {c["name"]: c for c in self.engine.list_categories()}
        self.assertIn("regle", categories)
        self.assertEqual(categories["regle"]["n_exemples"], 1)
        self.assertFalse(categories["regle"]["priorite"])

    def test_priority_flag_marks_whole_category(self):
        self.engine.write_node("Regle : ne jamais utiliser de listes a puces sauf demande.", session_id="sac", node_type="regle", priority=True)
        self.engine.write_node("Regle : reponses toujours concises.", session_id="sac", node_type="regle")
        categories = {c["name"]: c for c in self.engine.list_categories()}
        self.assertTrue(categories["regle"]["priorite"])
        self.assertEqual(categories["regle"]["n_exemples"], 2)

    def test_priority_context_returns_only_priority_categories(self):
        self.engine.write_node("Regle : reponses concises.", session_id="sac", node_type="regle", priority=True)
        self.engine.write_node("Fait ordinaire sans importance particuliere.", session_id="sac", node_type="fait")
        sac_a_dos = self.engine.priority_context()
        self.assertEqual(len(sac_a_dos), 1)
        self.assertEqual(sac_a_dos[0]["node_type"], "regle")

    def test_set_category_priority_on_unseen_category(self):
        existed = self.engine.set_category_priority("regle_future", True)
        self.assertFalse(existed)
        node_id = self.engine.write_node("Une future regle du projet.", session_id="sac", node_type="regle_future")
        node = self.engine.recall(node_id)
        self.assertEqual(node["node_type"], "regle_future")
        sac_a_dos = self.engine.priority_context()
        self.assertIn(node_id, [n["id"] for n in sac_a_dos])

    def test_dynamic_category_gets_reused_by_auto_categorization(self):
        # Deux exemples explicites pour construire un prototype solide pour
        # une categorie custom qui n'existe pas dans la taxonomie par defaut.
        self.engine.write_node(
            "Regle imperative du projet : ne jamais commiter de cle API en dur dans le code.",
            session_id="sac", node_type="regle_securite",
        )
        self.engine.write_node(
            "Regle imperative du projet : toujours valider les entrees utilisateur avant de les stocker.",
            session_id="sac", node_type="regle_securite",
        )
        # Contenu similaire, sans node_type explicite -- doit retrouver la
        # categorie apprise plutot que la taxonomie par defaut.
        node_id = self.engine.write_node(
            "Regle imperative du projet : ne jamais exposer les logs d'erreur bruts a l'utilisateur final.",
            session_id="sac",
        )
        node = self.engine.recall(node_id)
        self.assertEqual(node["node_type"], "regle_securite")

    def test_web_export_matches_cosmos_dataset_contract(self):
        n1 = self.engine.write_node(
            "Regle du projet : toujours repondre en francais.", session_id="web", node_type="regle", priority=True
        )
        n2 = self.engine.write_node(
            "Deuxieme regle du projet, liee a la premiere par le sujet.", session_id="web", node_type="regle"
        )
        self.engine.write_node("Un fait sans lien evident avec les regles.", session_id="web", node_type="fait")

        payload = web_export.build_web_dataset(self.engine.export_graph())

        self.assertEqual(payload["isDemo"], False)
        self.assertEqual(len(payload["planets"]), 3)
        cat_ids = {c["id"] for c in payload["categories"]}
        self.assertIn("regle", cat_ids)
        self.assertIn("fait", cat_ids)
        cat_regle = next(c for c in payload["categories"] if c["id"] == "regle")
        cat_fait = next(c for c in payload["categories"] if c["id"] == "fait")
        self.assertTrue(cat_regle["priority"])
        self.assertFalse(cat_fait["priority"])

        planet_n1 = next(p for p in payload["planets"] if p["id"] == n1)
        self.assertEqual(planet_n1["category_id"], "regle")
        self.assertEqual(planet_n1["metadata"]["importance"], 5)  # categorie prioritaire
        # node_type doit toujours retomber dans la taxonomie fixe des 14 valeurs de la webapp
        fixed_taxonomy = {
            "note", "idee", "decision", "evenement", "personne", "tache", "document",
            "conversation", "recherche", "concept", "technique", "reference", "session", "projet",
        }
        self.assertIn(planet_n1["node_type"], fixed_taxonomy)

        planet_n2 = next(p for p in payload["planets"] if p["id"] == n2)
        self.assertEqual(planet_n2["metadata"]["importance"], 5)  # priorite portee par la categorie, pas le noeud

        # Les connexions exportees doivent correspondre aux vraies aretes du graphe.
        neighbor_ids = {n["neighbor"] for n in self.engine.neighbors(n1)}
        self.assertEqual(set(planet_n1["metadata"]["connections"]), neighbor_ids)

    def test_web_export_handles_empty_graph(self):
        payload = web_export.build_web_dataset(self.engine.export_graph())
        self.assertEqual(payload["categories"], [])
        self.assertEqual(payload["planets"], [])
        self.assertEqual(payload["sessions"], [])

    def test_list_categories_assigns_and_persists_color(self):
        self.engine.write_node("Une idee quelconque.", session_id="s1", node_type="idee")
        first = {c["name"]: c["color"] for c in self.engine.list_categories()}
        self.assertTrue(first["idee"].startswith("#"))
        # Meme couleur au deuxieme appel -- persistee, pas recalculee.
        second = {c["name"]: c["color"] for c in self.engine.list_categories()}
        self.assertEqual(first["idee"], second["idee"])

    def test_set_category_color_overrides_palette(self):
        self.engine.write_node("Une idee quelconque.", session_id="s1", node_type="idee")
        self.engine.set_category_color("idee", "#ff00ff")
        categories = {c["name"]: c for c in self.engine.list_categories()}
        self.assertEqual(categories["idee"]["color"], "#ff00ff")

    def test_rename_category_moves_nodes_and_category_row(self):
        n1 = self.engine.write_node("Premiere idee.", session_id="s1", node_type="idee")
        n2 = self.engine.write_node("Deuxieme idee.", session_id="s1", node_type="idee")
        self.engine.rename_category("idee", "inspiration")
        categories = {c["name"] for c in self.engine.list_categories()}
        self.assertNotIn("idee", categories)
        self.assertIn("inspiration", categories)
        self.assertEqual(self.engine.recall(n1)["node_type"], "inspiration")
        self.assertEqual(self.engine.recall(n2)["node_type"], "inspiration")

    def test_rename_category_refuses_existing_target(self):
        self.engine.write_node("Une idee.", session_id="s1", node_type="idee")
        self.engine.write_node("Une inspiration.", session_id="s1", node_type="inspiration")
        with self.assertRaises(ValueError):
            self.engine.rename_category("idee", "inspiration")

    def test_merge_categories_moves_nodes_and_sums_examples(self):
        n1 = self.engine.write_node("Une idee.", session_id="s1", node_type="idee")
        n2 = self.engine.write_node("Une inspiration.", session_id="s1", node_type="inspiration", priority=True)
        moved = self.engine.merge_categories("idee", "inspiration")
        self.assertEqual(moved, 1)
        categories = {c["name"]: c for c in self.engine.list_categories()}
        self.assertNotIn("idee", categories)
        self.assertEqual(categories["inspiration"]["n_exemples"], 2)
        self.assertTrue(categories["inspiration"]["priorite"])  # heritee de la cible
        self.assertEqual(self.engine.recall(n1)["node_type"], "inspiration")
        self.assertEqual(self.engine.recall(n2)["node_type"], "inspiration")

    def test_merge_categories_rejects_self_merge(self):
        self.engine.write_node("Une idee.", session_id="s1", node_type="idee")
        with self.assertRaises(ValueError):
            self.engine.merge_categories("idee", "idee")

    def test_update_node_title_and_content(self):
        node_id = self.engine.write_node("Contenu original.", session_id="s1")
        ok = self.engine.update_node(node_id, title="Mon titre a moi")
        self.assertTrue(ok)
        exported = self.engine.export_graph()["nodes"]
        node = next(n for n in exported if n["id"] == node_id)
        self.assertEqual(node["title"], "Mon titre a moi")
        self.assertEqual(node["abyss"], "Contenu original.")  # non touche

        ok2 = self.engine.update_node(node_id, content="Nouveau contenu completement different.")
        self.assertTrue(ok2)
        recalled = self.engine.recall(node_id)
        self.assertEqual(recalled["abyss"], "Nouveau contenu completement different.")

    def test_update_node_unknown_id_returns_false(self):
        self.assertFalse(self.engine.update_node("id-inconnu", title="x"))

    def test_update_node_changes_category(self):
        node_id = self.engine.write_node("Un fait.", session_id="s1", node_type="fait")
        self.engine.update_node(node_id, node_type="archive")
        self.assertEqual(self.engine.recall(node_id)["node_type"], "archive")
        categories = {c["name"] for c in self.engine.list_categories()}
        self.assertIn("archive", categories)

    def test_set_pinned_toggle(self):
        node_id = self.engine.write_node("Un souvenir important pour moi.", session_id="s1")
        self.assertTrue(self.engine.set_pinned(node_id, True))
        pinned_node = next(n for n in self.engine.export_graph()["nodes"] if n["id"] == node_id)
        self.assertTrue(pinned_node["pinned"])
        self.engine.set_pinned(node_id, False)
        unpinned_node = next(n for n in self.engine.export_graph()["nodes"] if n["id"] == node_id)
        self.assertFalse(unpinned_node["pinned"])

    def test_set_pinned_unknown_id_returns_false(self):
        self.assertFalse(self.engine.set_pinned("id-inconnu", True))

    def test_web_export_uses_manual_title_and_pinned(self):
        node_id = self.engine.write_node("Un souvenir avec un long contenu original.", session_id="web")
        self.engine.update_node(node_id, title="Titre choisi a la main")
        self.engine.set_pinned(node_id, True)
        payload = web_export.build_web_dataset(self.engine.export_graph())
        planet = next(p for p in payload["planets"] if p["id"] == node_id)
        self.assertEqual(planet["title"], "Titre choisi a la main")
        self.assertTrue(planet["metadata"]["pinned"])

    def test_concurrent_access_from_multiple_threads(self):
        """Reproduit le scenario reel qui a plante en usage MCP : le serveur
        execute chaque appel d'outil dans un thread de worker different que
        celui qui a cree la connexion. Sans check_same_thread=False + verrou,
        ceci levait sqlite3.ProgrammingError."""
        errors = []

        def worker(i):
            try:
                node_id = self.engine.write_node(f"Message numero {i} depuis un thread.", session_id="concurrent")
                self.engine.recall(node_id)
                self.engine.status()
            except Exception as e:  # noqa: BLE001 - on veut voir toute exception dans le test
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(errors, [], f"Erreurs remontees depuis les threads : {errors}")
        self.assertEqual(self.engine.status()["n_nodes"], 20)


class TestDeletion(unittest.TestCase):
    """Suppression de souvenirs / categories / sessions et remise a zero totale."""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.engine = CosmosEngine(db_path=os.path.join(self.tmpdir, "test_delete.db"))

    def tearDown(self):
        self.engine.close()

    def _count(self, table):
        return self.engine.conn.execute(f"SELECT COUNT(*) AS c FROM {table}").fetchone()["c"]

    def test_delete_node_removes_node_and_its_edges(self):
        n1 = self.engine.write_node("Le chat noir dort sur le canape.", session_id="s1", node_type="animaux")
        n2 = self.engine.write_node("Le chat noir se reveille et miaule.", session_id="s1", node_type="animaux")
        n3 = self.engine.write_node("Le chat gris observe la fenetre.", session_id="s1", node_type="animaux")
        self.assertTrue(self.engine.delete_node(n2))

        self.assertIsNone(self.engine.recall(n2))
        self.assertIsNotNone(self.engine.recall(n1))
        self.assertIsNotNone(self.engine.recall(n3))
        dangling = self.engine.conn.execute(
            "SELECT COUNT(*) AS c FROM edges WHERE from_node = ? OR to_node = ?", (n2, n2)
        ).fetchone()["c"]
        self.assertEqual(dangling, 0)
        cat = next(c for c in self.engine.list_categories() if c["name"] == "animaux")
        self.assertEqual(cat["n_exemples"], 2)

    def test_delete_unknown_node_returns_false(self):
        self.assertFalse(self.engine.delete_node("id-qui-nexiste-pas"))

    def test_delete_last_node_drops_its_category(self):
        n1 = self.engine.write_node("Un souvenir unique.", node_type="solo")
        result = self.engine.delete_nodes([n1])
        self.assertEqual(result["categories_supprimees"], ["solo"])
        self.assertNotIn("solo", [c["name"] for c in self.engine.list_categories()])

    def test_delete_last_node_can_keep_empty_category(self):
        n1 = self.engine.write_node("Une regle.", node_type="regle", priority=True)
        self.engine.delete_nodes([n1], keep_empty_categories=True)
        cats = {c["name"]: c for c in self.engine.list_categories()}
        self.assertIn("regle", cats)
        self.assertEqual(cats["regle"]["n_exemples"], 0)
        self.assertTrue(cats["regle"]["priorite"])

    def test_delete_nodes_reports_missing_ids(self):
        n1 = self.engine.write_node("Un souvenir.")
        result = self.engine.delete_nodes([n1, "inconnu", n1])
        self.assertEqual(result["noeuds_supprimes"], 1)
        self.assertEqual(result["ids_introuvables"], ["inconnu"])

    def test_delete_category_removes_all_its_nodes(self):
        self.engine.write_node("Idee A.", node_type="idee")
        self.engine.write_node("Idee B.", node_type="idee")
        autre = self.engine.write_node("Tache C.", node_type="tache")
        result = self.engine.delete_category("idee")
        self.assertEqual(result["noeuds_supprimes"], 2)
        self.assertEqual(self._count("nodes"), 1)
        self.assertIsNotNone(self.engine.recall(autre))
        self.assertNotIn("idee", [c["name"] for c in self.engine.list_categories()])
        with self.assertRaises(ValueError):
            self.engine.delete_category("idee")

    def test_delete_session_removes_only_that_session(self):
        self.engine.write_node("Message A.", session_id="a")
        self.engine.write_node("Message B.", session_id="a")
        keep = self.engine.write_node("Message C.", session_id="b")
        result = self.engine.delete_session("a")
        self.assertEqual(result["noeuds_supprimes"], 2)
        self.assertEqual(self.engine.status()["n_sessions"], 1)
        self.assertIsNotNone(self.engine.recall(keep))
        with self.assertRaises(ValueError):
            self.engine.delete_session("a")

    def test_reset_all_empties_everything(self):
        self.engine.write_node("Un.", session_id="s1", node_type="regle", priority=True)
        self.engine.write_node("Deux.", session_id="s2")
        self.engine.write_node("Trois.", session_id="s2")
        result = self.engine.reset_all()
        self.assertEqual(result["noeuds_supprimes"], 3)
        self.assertEqual(self._count("nodes"), 0)
        self.assertEqual(self._count("edges"), 0)
        self.assertEqual(self._count("categories"), 0)
        self.assertEqual(self.engine.priority_context(), [])
        # la base reste utilisable apres remise a zero
        node_id = self.engine.write_node("Apres la remise a zero.")
        self.assertIsNotNone(self.engine.recall(node_id))

    def test_reset_all_can_keep_categories(self):
        self.engine.write_node("Une regle.", node_type="regle", priority=True)
        result = self.engine.reset_all(keep_categories=True)
        self.assertEqual(result["categories_supprimees"], 0)
        self.assertEqual(self._count("nodes"), 0)
        cats = {c["name"]: c for c in self.engine.list_categories()}
        self.assertTrue(cats["regle"]["priorite"])
        self.assertEqual(cats["regle"]["n_exemples"], 0)


class TestServerNewTools(unittest.TestCase):
    """Verifie que les nouveaux outils du sac a dos (categories dynamiques,
    priorite) sont bien exposes par le serveur MCP, pas seulement testes au
    niveau de CosmosEngine."""

    def setUp(self):
        import importlib
        import os
        import sys
        import tempfile

        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        os.environ["COSMOS_DB_PATH"] = os.path.join(tempfile.mkdtemp(), "server_tools_test.db")
        if "server" in sys.modules:
            importlib.reload(sys.modules["server"])
        else:
            import server  # noqa: F401
        self.server = sys.modules["server"]

    def tearDown(self):
        self.server.engine.close()

    def test_write_with_priority_then_priority_context_tool(self):
        write_result = self.server.cosmos_write(
            content="Regle : toujours repondre en francais, de maniere concise.",
            node_type="regle",
            priority=True,
        )
        self.assertEqual(write_result["node_type"], "regle")

        categories_result = self.server.cosmos_categories()
        names = [c["name"] for c in categories_result["categories"]]
        self.assertIn("regle", names)

        sac_a_dos = self.server.cosmos_priority_context()
        self.assertEqual(len(sac_a_dos["souvenirs_prioritaires"]), 1)

    def test_set_category_priority_tool(self):
        result = self.server.cosmos_set_category_priority(name="tache", priority=True)
        self.assertEqual(result["categorie"], "tache")
        self.assertTrue(result["priorite"])

    def test_set_category_color_tool(self):
        self.server.cosmos_write(content="Une idee.", node_type="idee")
        result = self.server.cosmos_set_category_color(name="idee", color="#123456")
        self.assertEqual(result["color"], "#123456")
        names_colors = {c["name"]: c["color"] for c in self.server.cosmos_categories()["categories"]}
        self.assertEqual(names_colors["idee"], "#123456")

    def test_rename_and_merge_category_tools(self):
        self.server.cosmos_write(content="Une idee.", node_type="idee")
        self.server.cosmos_write(content="Une inspiration.", node_type="inspiration")
        rename_result = self.server.cosmos_rename_category(old_name="idee", new_name="idees")
        self.assertEqual(rename_result["nouveau_nom"], "idees")
        merge_result = self.server.cosmos_merge_categories(source="idees", target="inspiration")
        self.assertEqual(merge_result["souvenirs_deplaces"], 1)
        names = [c["name"] for c in self.server.cosmos_categories()["categories"]]
        self.assertNotIn("idees", names)
        self.assertIn("inspiration", names)

    def test_update_node_and_set_pinned_tools(self):
        write_result = self.server.cosmos_write(content="Contenu original.")
        node_id = write_result["node_id"]
        update_result = self.server.cosmos_update_node(node_id=node_id, title="Titre manuel")
        self.assertTrue(update_result["modifie"])
        pin_result = self.server.cosmos_set_pinned(node_id=node_id, pinned=True)
        self.assertTrue(pin_result["epingle"])
        unknown_result = self.server.cosmos_update_node(node_id="id-inconnu", title="x")
        self.assertIn("error", unknown_result)

    def test_delete_tools(self):
        a = self.server.cosmos_write(content="Souvenir A.", node_type="cat_a")["node_id"]
        b = self.server.cosmos_write(content="Souvenir B.", node_type="cat_b")["node_id"]
        c = self.server.cosmos_write(content="Souvenir C.", node_type="cat_b", session_id="autre")["node_id"]

        self.assertTrue(self.server.cosmos_delete_node(node_id=a)["supprime"])
        self.assertIn("error", self.server.cosmos_delete_node(node_id=a))
        self.assertIn("error", self.server.cosmos_recall(node_id=a))

        self.assertEqual(self.server.cosmos_delete_session(session_id="autre")["noeuds_supprimes"], 1)
        self.assertIn("error", self.server.cosmos_delete_session(session_id="autre"))

        self.assertEqual(self.server.cosmos_delete_category(name="cat_b")["noeuds_supprimes"], 1)
        self.assertIn("error", self.server.cosmos_delete_category(name="cat_b"))
        self.assertEqual(self.server.cosmos_status()["n_nodes"], 0)

    def test_delete_all_requires_exact_confirmation(self):
        self.server.cosmos_write(content="A garder tant que pas confirme.")
        for wrong in ("", "oui", "supprimer tout"):
            result = self.server.cosmos_delete_all(confirmation=wrong)
            self.assertFalse(result["supprime"])
        self.assertEqual(self.server.cosmos_status()["n_nodes"], 1)

        result = self.server.cosmos_delete_all(confirmation="SUPPRIMER TOUT")
        self.assertTrue(result["supprime"])
        self.assertEqual(result["noeuds_supprimes"], 1)
        self.assertEqual(self.server.cosmos_status()["n_nodes"], 0)


class TestMcpAppsWiring(unittest.TestCase):
    """Verifie que server.py expose correctement le pattern officiel MCP Apps
    (outil avec _meta.ui.resourceUri + ressource ui:// servant du HTML)."""

    def test_tool_meta_points_to_resource(self):
        import asyncio
        import importlib
        import sys

        os.environ["COSMOS_DB_PATH"] = os.path.join(tempfile.mkdtemp(), "mcp_apps_test.db")
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        if "server" in sys.modules:
            importlib.reload(sys.modules["server"])
        else:
            import server  # noqa: F401
        server = sys.modules["server"]

        tools = asyncio.run(server.mcp.list_tools())
        graph_tool = next(t for t in tools if t.name == "cosmos_graph_app")
        meta = graph_tool.model_dump(by_alias=True).get("_meta")
        self.assertEqual(meta, {"ui": {"resourceUri": "ui://cosmos/graph"}})

        resources = asyncio.run(server.mcp.list_resources())
        self.assertIn("ui://cosmos/graph", [str(r.uri) for r in resources])

        content = asyncio.run(server.mcp.read_resource("ui://cosmos/graph"))
        self.assertIn("<svg", content[0].content)
        server.engine.close()


if __name__ == "__main__":
    unittest.main()
