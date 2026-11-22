# Deepwell — alternative auto-hébergée à Notion

Pages / sous-pages illimitées, éditeur à blocs, bases de données (vue tableau), partage façon Notion,
comptes utilisateurs, sauvegardes, Google Drive, import Notion, personnalisation complète.
Un seul processus Node.js + un fichier SQLite : aucun service externe requis.

## Démarrer

```bash
npm install
npm start            # http://localhost:3000
```

Le premier compte créé devient **administrateur**. Prérequis : Node.js ≥ 22.5 (testé sur 24).

### Sur un serveur

```bash
docker build -t deepwell .
docker run -d --name deepwell -p 3000:3000 -v deepwell-data:/app/data \
  -e PUBLIC_URL=https://notes.example.com -e COOKIE_SECURE=1 -e TRUST_PROXY=1 deepwell
```

Placez-le derrière un reverse proxy HTTPS (Caddy, nginx, Traefik). Sans Docker : `node server/index.js` sous systemd/pm2.

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT`, `HOST` | écoute | `3000`, `0.0.0.0` |
| `DATA_DIR` | base, fichiers, sauvegardes | `./data` |
| `PUBLIC_URL` | URL publique (callback Google) | `http://localhost:PORT` |
| `COOKIE_SECURE=1` / `TRUST_PROXY=1` | derrière HTTPS / un proxy | — |
| `BACKUP_INTERVAL_HOURS`, `BACKUP_KEEP` | planification et rétention | `24`, `14` |
| `MAX_UPLOAD_MB` | taille max d'un fichier/ZIP | `200` / `500` pour le ZIP |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Drive | — |

## Migrer depuis Notion

**Réglages → Import Notion.** Deux voies :

1. **API Notion (recommandée, fidélité maximale).** Crée une intégration interne sur notion.so/my-integrations,
   partage tes pages racines avec elle (••• → Connexions), colle le jeton. Les blocs sont stockés **au format JSON natif de Notion**
   (+ l'objet d'origine complet dans `raw`) : mise en forme, couleurs, mentions, toggles, colonnes, tableaux, callouts, équations, bases
   de données avec **types de propriétés**, icônes, couvertures, commentaires, hiérarchie. Les fichiers hébergés par Notion
   (URL qui expirent en 1 h) sont **téléchargés** chez toi ; les liens/mentions internes sont réécrits. L'import est **rejouable sans doublon**.
2. **ZIP d'export (Markdown & CSV).** Sans jeton, mais l'export Notion perd déjà des informations avant d'arriver ici
   (types de propriétés → déduits du CSV, couleurs, mentions, vues).

Ce que Notion ne laisse **pas** sortir, par aucune voie : vues de bases (filtres/tris/galerie/calendrier), historique des versions,
permissions et membres de l'espace, automatisations, boutons, modèles ; blocs « unsupported » conservés bruts mais non affichables ;
formules/rollups importés avec leur dernière valeur, non recalculés.

L'import **suit toutes les références** (sous-pages, mentions, liens, bases et leurs lignes) au lieu de se limiter aux résultats de la
recherche Notion, qui est incomplète. Les pages référencées mais non partagées avec l'intégration sont listées à la fin de l'import :
partagez-les dans Notion puis relancez l'import (seul le complément est ajouté, les liens se réparent). Les liens vers des pages absentes
s'affichent en pointillés avec une infobulle explicative.

## Édition : recherche, mentions, dates

- **Ctrl/⌘ K** : palette de recherche (pages récentes, insensible aux accents, multi-mots, extrait et chemin du parent, navigation clavier).
- **Table des matières** flottante à droite (survol → liste cliquable, titre courant mis en évidence), sur les pages à titres.
- **`@`** : mentionner une page, une personne ou une date (Aujourd'hui, Demain, Hier, ou sélecteur avec heure et fin). Clic sur une date pour la modifier.
- **Dates** : stockées en ISO avec leur décalage (comme Notion), affichées dans **votre fuseau horaire** et format (Réglages → Date et heure) :
  mentions, propriétés de bases, titres importés (« Entrée du 2026-09-03T11:29:00+02:00 » → « 3 septembre 2026, 11:29 »).
  Une date sans heure n'est jamais décalée.

## Interface, blocs et bases de données

- **Look Notion** : police système identique à Notion, palette et tailles proches (texte 17 px par défaut, réglable : Réglages → Apparence), panneau latéral masquable (bouton ou **Ctrl+\\**).
- **Icônes de page vectorielles** (Lucide, ISC) avec couleur, en plus des emoji et des images (clic sur l'icône, ou « Ajouter une icône »). Le fichier `public/icons/LICENSE` accompagne la bibliothèque.
- **Mise en forme** : sélectionnez du texte → B / I / U / S / code / lien, **couleur et surlignage**, **police** (serif, mono). Un clic sur la poignée ⋮⋮ d'un bloc ouvre son menu : couleur du texte et du fond, police du bloc, **couleur d'un séparateur**, transformer en…, commenter, dupliquer, supprimer.
- **Graphiques** (`/graphique`) : barres, barres horizontales, courbe, aire, anneau, camembert ; données saisies à la main ou **agrégées depuis une base de données** (comptage ou somme par catégorie).
- **Commentaires** : sur la page ou sur un bloc, fils de discussion, réponses, résolution ; nouveau rôle de partage « Peut commenter » ; les commentaires de page de Notion sont importés.
- **Bases de données** : vues **Tableau, Kanban** (glisser-déposer entre colonnes), **Calendrier** (glisser pour changer la date, mois à navigation, ajout au clic), **Galerie** et **Liste**, avec tri, filtre et propriétés affichées par vue. Les vues sont enregistrées avec la base.

## Organisation : dossiers, déplacer, clic droit

- **Dossiers de pages** : « Nouveau dossier » dans la barre latérale (ou le « + » d'une page/dossier). Un dossier regroupe des pages, d'autres dossiers et des bases ; sa page liste son contenu.
- **Clic droit** sur une page ou un dossier (barre latérale, liste d'un dossier) : ouvrir dans un onglet, copier le lien, renommer, changer l'icône, ajouter une sous-page/sous-dossier, dupliquer (avec toutes les sous-pages), **Déplacer vers…**, corbeille.
- **Déplacer vers…** ouvre un sélecteur de destination (arbre + recherche) et change le *parent* de l'élément ; il est aussi dans le menu « ⋯ » de la page. Pour un **bloc** (clic droit sur le bloc ou sur sa poignée ⋮⋮), la destination est une page : le bloc est copié, puis retiré de la source.
- **Clic droit dans l'éditeur** : menu du bloc. **Maj + clic droit**, ou clic droit sur du texte sélectionné, donne le menu du navigateur (orthographe, copier/coller). Réglages → Apparence → « Clic droit dans les pages » permet de garder partout le menu du navigateur.
- **Icône du site** (favicon) : Réglages → Apparence → Identité (icône vectorielle colorée, emoji ou image importée).

## Sauvegardes

Instantané SQLite cohérent à chaud (`VACUUM INTO`, compressé) + copie incrémentale des fichiers, automatiquement chaque jour
(Réglages → Sauvegardes : lancer, télécharger, envoyer sur Drive). Restauration, serveur arrêté :

```bash
npm run restore -- data/backups/deepwell-AAAA-MM-JJ….db.gz
```

## Google Drive

Console Google Cloud → activer *Google Drive API* → ID client OAuth « Application Web » → URI de redirection
`PUBLIC_URL/api/drive/callback` → renseigner `GOOGLE_CLIENT_ID/SECRET`. Chaque utilisateur connecte son compte
(Réglages → Google Drive), puis `/drive` insère un fichier Drive dans une page. L'admin peut envoyer les sauvegardes sur son Drive
(manuellement ou automatiquement). Les jetons sont chiffrés (AES-256-GCM) avec `data/secret.key`, absent des sauvegardes de la base —
**sauvegardez ce fichier à part** si vous utilisez Drive.

## Partage

Par page : invitation d'un utilisateur (lecture / édition) ou **lien public** (lecture seule, sans compte). Les droits sont
**hérités** par les sous-pages. Seul le propriétaire partage ou supprime définitivement ; corbeille avec restauration.

## Personnaliser

Réglages → Apparence (admin) : nom, couleur d'accent, police, arrondi, largeur, thème par défaut et **CSS libre** appliqué à tout le site
(variables `--accent --bg --fg --border --sidebar-bg --radius --font --content-width`, classes `.block.t-<type>`).
Le front est du JS natif sans étape de build (`public/js/`). Nouveau type de bloc : `BLOCK_DEFAULTS`, `SLASH_ITEMS` et `renderBlock` dans `editor.js`.

## Sécurité (résumé)

Mots de passe scrypt ; sessions en cookie `HttpOnly` + `SameSite=Lax` ; en-tête `X-DW` obligatoire sur toute requête modifiante (anti-CSRF) ;
limitation des tentatives de connexion ; URL de liens filtrées (`javascript:` bloqué) ; fichiers servis en `sandbox` CSP ;
ZIP importés protégés contre le zip-slip. Les URL `/files/<uuid>` sont des liens « capability » (non devinables, comme chez Notion) : toute
personne qui connaît l'URL d'un fichier peut le lire.

## Limites connues

Pas de collaboration temps réel (dernier enregistrement gagnant), pas d'annulation structurelle (Ctrl+Z natif par bloc seulement),
vue base de données = tableau (tri/filtre simples), pas de formules/relations/rollups éditables (importés et affichés en lecture seule).

## Tests

`npm test` : auth, droits hérités, liens publics, blocs, import Notion contre un faux serveur Notion, import ZIP, backup.

## Nouveautés récentes

- **Icônes géométriques** (`geo-*`, formes pleines ou en trait, motifs) ajoutées au sélecteur : recherchez « géométrique », « cercle », « losange »… ; couleur modifiable comme pour les autres icônes. `scripts/gen-geo-icons.cjs` les (re)génère.
- **Mentions `@`** : icône vectorielle de la page (jamais un emoji). **Icônes personnalisées** : toute image importée est gardée dans une collection personnelle du sélecteur.
- **Sélection multiple** dans la barre latérale (Ctrl/⌘ + clic, Maj + clic) : icône, déplacement ou corbeille en une fois.
- **Annuler / rétablir** : Ctrl+Z, Ctrl+Y (ou Ctrl+Maj+Z).
- **Historique des versions** (menu « ⋯ ») : une version au plus toutes les 5 min, aperçu et restauration (l'état actuel est gardé avant restauration).
- **Boutons** (`/bouton`) : nom, couleur et suite d'actions (ajouter des blocs, ajouter une page à une base, modifier une propriété, ouvrir page/lien, confirmer, message ; variables `{{date}} {{heure}} {{utilisateur}} {{titre}}`). L'API Notion ne fournit ni nom ni actions : les boutons importés arrivent vides et sont à reconfigurer ; leur configuration survit aux réimports.
- **Dates** sans cadre (plus petites dans les titres) ; liens et mentions de pages en gras ; plus de section « Sous-pages » en bas des pages.
- **Remplacer les liens par les documents** (menu « ⋯ ») : sous-pages, liens de page et mentions seules sur une ligne de la page et de ses sous-pages sont remplacés par le contenu du document (précédé de son titre). Un document lié à plusieurs endroits n'est jamais modifié sans votre choix : une liste de doublons vous laisse désigner l'emplacement qui garde le document, les autres restent des liens. Les pages d'origine sont conservées, l'état précédent va dans l'historique.
- **Accès restreint** (menu « ⋯ » → Verrouiller avec un code) : PIN ou mot de passe (4–64 caractères, haché scrypt) exigé pour ouvrir la page et ses sous-pages, même par le propriétaire ; cadenas dans la barre latérale ; verrouillage automatique après inactivité (5 min à 1 h, ou jamais) et « Verrouiller maintenant » ; modifier ou retirer le code demande l'ancien. Le contenu est refusé par le serveur (423) et exclu de la recherche ; les liens publics ne peuvent pas ouvrir une page verrouillée. Limites : titres visibles dans l'arborescence, export JSON et sauvegardes non chiffrés, code non récupérable.
- **Remplacer des liens par les sous-pages** (menu « ⋯ ») : uniquement les liens de la page courante, à cocher un par un ; la page ciblée est *déplacée* sous la page courante et le lien devient cette sous-page (contenu non copié) ; elle disparaît de son ancien emplacement. Doublons : vous choisissez quel lien devient la sous-page, les autres restent des liens.
- **Sélection de blocs** : Ctrl/⌘ + clic, ou rectangle (clic-glisser depuis les marges) ; barre d'actions groupées (gras, couleurs, transformer, icône des callouts et liens de page, dupliquer, déplacer vers une page, supprimer), Suppr, Ctrl+D, Alt+↑/↓, Échap.
- **Bases de données** : clic sur une entrée = aperçu latéral glissant avec « Ouvrir en plein écran » ; menu de la vue → « Ouvrir les entrées en plein écran par défaut ».
- **Raccourcis** : Ctrl+B/I/U/K/E, Ctrl+Maj+S (barré), Ctrl+Z/Y ; Markdown : `#`, `##`, `###`, `-`, `1.`, `[]`, `>`, `---` (séparateur), ``` (code).
- **Performance** : réponses gzip, cache des icônes, rendu différé des blocs hors écran sur les grandes pages.
- **Import Notion : icônes natives** (le jeu d'icônes minimalistes de Notion) : l'API 2022-06-28 ne les renvoie pas ; l'import les relit avec une version récente de l'API (`NOTION_NEW_VERSION`, défaut 2026-03-11) et télécharge le SVG identique (`notion.so/icons/<nom>_<couleur>.svg`) chez vous — pages, bases et callouts. **Boutons** : l'API ne fournit que « bouton » sans configuration ; l'import tente aussi la version récente et conserve toute réponse exploitable dans le bloc (`content.notion`), sinon le bouton reste à reconfigurer.
- **Cadres** (ex-« callouts », comme Notion : plus hauts, texte et icône centrés) ; **« + »** à gauche de la poignée d'un bloc : ajoute une ligne au-dessus (Alt + clic : en dessous) ; les icônes importées de Notion rejoignent automatiquement la collection d'icônes (sélecteur → Personnalisé) ; « Remplacer des liens par les sous-pages » détecte aussi les mentions dans des listes, textes mixtes et tableaux.
- **Collection d'icônes** (sélecteur → Personnalisé) en deux sections : « Importées » (transferts Notion) et « Mes images » (envoyées à la main) ; toute image devenue icône y est enregistrée automatiquement.

- **Recolorer une icône importée** : onglet « Personnalisé » du sélecteur d’icônes → choisir une couleur (palette ou sélecteur libre) puis cliquer sur une icône SVG ; une copie recolorée est créée et rangée dans la même section (l’original reste intact).

- **Citation au clavier** : `| ` (barre verticale + espace) en début de bloc crée une citation (comme `> ` et `" `).
- **Mode développeur** (Réglages → Développeur, administrateur, désactivé par défaut) : permet à l’auteur d’un commentaire ou au propriétaire de la page de modifier la date d’ajout d’origine (clic sur la date dans le panneau des commentaires). Désactivé, le serveur refuse toute modification de cette date.

- **Commentaires comme dans Notion** : commentaire général de la page (panneau des commentaires) ou commentaire sur du texte sélectionné (bouton « Commenter » de la barre flottante, ou Ctrl+Maj+M) ; le texte commenté est surligné et un clic dessus ouvre le panneau. Sélectionner depuis la marge gauche d’un bloc commence au premier caractère.

- **Favoris** : étoile en haut de la page, ou « Ajouter aux favoris » dans le menu de la page / du clic droit ; la section « Favoris » du panneau de gauche les liste (pages et sous-pages), réordonnables par glisser-déposer. Le logo du site (Réglages → Apparence → Icône du site) remplace la lettre en haut à gauche.
- Le bouton « Résoudre » des commentaires a été retiré.

- Le remplacement des liens / mentions par les sous-pages (menu « ⋯ ») est réservé au **mode développeur** (Réglages → Développeur), côté interface et côté serveur.

- Panneau de gauche : Corbeille, Réglages et Déconnexion sont des cases avec uniquement l’icône ; la section Favoris se place en haut ou en bas du panneau (flèche à droite de son titre, choix mémorisé par navigateur).

- **Version** : numéro dans `package.json` (source unique), affiché en bas à gauche du panneau latéral. 3.0.1 à la mise en place ; +1 sur le dernier chiffre à chaque petite modification, +1 sur le deuxième (3.1…) après une pause d’une à deux semaines.

- 3.0.2 : correctif éditeur — supprimer une mention (ou tout le contenu d’un bloc) avec Retour arrière pouvait faire retirer par le navigateur la zone de texte du bloc ; Entrée ne faisait plus rien et la mention revenait au prochain rendu. La zone de texte est maintenant recréée et le contenu effacé du modèle.

- 3.0.3 : correctif — l’aperçu latéral d’une ligne de base était décalé vers la droite avec une barre de défilement horizontale : la classe `peek` du `<body>` (mode aperçu) reprenait les styles du panneau `.peek`. Elle s’appelle désormais `is-peek`.

- 3.0.4 : propriétés d’une ligne de base (aperçu latéral et page) — icône du type + nom à gauche, valeur à droite ; Sélection, Statut et Multi-sélection s’ouvrent dans une liste « à la Notion » (pastilles colorées, recherche, création d’option, coche sur les choix) au lieu du menu natif (`public/js/optpicker.js`).

- 3.0.5 : aperçu latéral plus aéré (marges de 64 px, titre et propriétés espacés, blocs inchangés entre eux) ; vue liste des bases sans lignes de séparation.

- 3.0.6 : bases de données — colonne « Numéro automatique » (ou bouton # sur l’en-tête d’une colonne Nombre) : une nouvelle ligne reçoit la plus grande valeur + 1, toujours modifiable à la main ; les colonnes « ID unique » importées de Notion suivent la même règle et deviennent modifiables. Tri : choix Croissant / Décroissant, comparaison numérique pour les nombres et ID (vides en dernier).
