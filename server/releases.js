/**
 * Notes de version : source unique de l'historique affiché dans l'application (Notes de version).
 * RÈGLE : une seule mise à jour PAR JOUR. Plusieurs modifications le même jour = même entrée (en tête) et une seule
 * incrémentation de version dans package.json, sauf demande contraire de l'utilisateur. Nouvelle entrée = nouveau jour.
 * Catégories : nouveautes, ameliorations, corrections. `date` : AAAA-MM-JJ (null si non renseignée).
 */
export const RELEASES = [
  {
    version: '3.4.0', date: '2026-11-19',
    nouveautes: [
      'Formules mathématiques : les blocs « Équation » et les équations placées dans une ligne de texte sont maintenant dessinées en vraies formules (fractions, indices, exposants, lettres grecques comme ϱ ou ϖ, accents…) au lieu de s’afficher en code LaTeX brut. Un clic sur un bloc ouvre le texte LaTeX pour le modifier. La bibliothèque (KaTeX) est incluse dans Deepwell, sans service extérieur, et ne se charge que sur les pages qui contiennent une formule. Une formule mal écrite reste affichée en texte brut.',
    ],
    ameliorations: [
      'Caractères spéciaux mathématiques : la liste des polices de secours inclut maintenant des polices de symboles mathématiques, pour mieux afficher ∑, ∫, ≈, ≠, √, ∞… dans le texte normal.',
      'Toutes les versions portent maintenant le nom « Alpha » (Alpha 3.4.0, Alpha 3.3.7…), dans la barre latérale et dans les notes de version, y compris les anciennes.',
      'Quelques petits détails cachés ont été ajoutés ici et là, en lien avec ta terminologie. À toi de les trouver.',
      'Quand la connexion est coupée, le message d’erreur explique maintenant clairement que la liaison est perdue.',
      'Écrans d’accès restreint (page verrouillée, page introuvable, lien indisponible) : une ligne de contenu masqué est ajoutée.',
    ],
    corrections: [],
  },
  {
    version: '3.3.7', date: '2026-11-19',
    nouveautes: [],
    ameliorations: [
      'Mentions de date : l’icône de calendrier est retirée (la date s’affiche seule, comme avant), et elle est mieux alignée avec le texte qui l’entoure au lieu de descendre un peu trop bas.',
    ],
    corrections: [],
  },
  {
    version: '3.3.6', date: '2026-11-19',
    nouveautes: [],
    ameliorations: [
      'Cadres : encore un peu plus de vide au-dessus et en dessous du texte.',
    ],
    corrections: [],
  },
  {
    version: '3.3.5', date: '2026-11-19',
    nouveautes: [],
    ameliorations: [
      'Page avec une image de couverture : l’icône de la page chevauche maintenant le bas de la couverture, le bas de l’image arrivant à peu près à la moitié de l’icône, comme dans Notion.',
    ],
    corrections: [],
  },
  {
    version: '3.3.4', date: '2026-11-19',
    nouveautes: [],
    ameliorations: [
      'Cadres : un peu de vide est ajouté au-dessus et en dessous du texte, à peu près comme dans Notion.',
    ],
    corrections: [],
  },
  {
    version: '3.3.3', date: '2026-11-19',
    nouveautes: [],
    ameliorations: [
      'Séparateurs : l’espace entre les blocs de part et d’autre est un peu élargi, à peu près comme dans Notion.',
    ],
    corrections: [],
  },
  {
    version: '3.3.2', date: '2026-11-19',
    nouveautes: [],
    ameliorations: [
      'Cadres : le texte a maintenant la même taille que le texte normal, l’icône est plus petite et le cadre est moins haut.',
      'Séparateurs : ils ne prennent plus de hauteur superflue autour de leur ligne.',
    ],
    corrections: [],
  },
  {
    version: '3.3.1', date: '2026-11-19',
    nouveautes: [
      'Nouveau thème « Noir profond » (Mon affichage → Thème) : fond d’un noir pur, avec un menu, des cartes et des menus contextuels qui restent bien distincts grâce à des gris étagés et de fins contours clairs. Il peut aussi être choisi comme thème par défaut dans Réglages → Apparence.',
    ],
    ameliorations: [],
    corrections: [],
  },
  {
    version: '3.3.0', date: '2026-11-19',
    nouveautes: [
      'Calendrier : chaque élément affiche maintenant ses propriétés (choisies avec le bouton « Propriétés ») et le début du texte de sa page, directement dans la case du jour.',
      'Tri disponible dans toutes les vues (Kanban et Calendrier compris) : le tri est appliqué aux cartes d’une colonne et aux éléments d’un même jour.',
      'Une base de données placée dans une page s’affiche directement dans la page, sans cliquer sur un lien. Elle ne se charge que lorsqu’on approche de son emplacement, pour garder la page rapide. Son titre reste un lien vers la base seule.',
    ],
    ameliorations: [
      'Notes de version : la dernière version et les nouveautés depuis ta dernière visite sont dépliées, les anciennes sont repliées. Chaque version indique son nombre d’entrées, et des filtres Nouveautés / Améliorations / Corrections permettent de ne voir qu’un type.',
    ],
    corrections: [],
  },
  {
    version: '3.2.1', date: '2026-11-19',
    nouveautes: [],
    ameliorations: [
      'Séparateurs et encadrés (appels) : l’espace autour d’eux est réduit, les pages sont plus compactes.',
      'Aperçu latéral d’une entrée : un peu plus d’espace vide à gauche et à droite du contenu.',
    ],
    corrections: [
      'Menus (propriétés affichées, nouvelle vue, menu d’une vue, menu d’une page) : ils se ferment maintenant au clic à l’extérieur, avec Échap, au défilement et au changement de page. Avant, un seul clic à l’intérieur suffisait à les rendre « collants ».',
      'Sélecteur d’options (Sélection, Statut, Multi-sélection) : il se ferme aussi quand on change de page.',
      'Menu « Propriétés » : les cases cochées correspondent maintenant à ce qui est réellement affiché dans la vue (galerie, liste, Kanban). Il n’est plus nécessaire de décocher puis recocher une propriété pour la voir apparaître.',
    ],
  },
  {
    version: '3.2.0', date: '2026-11-19',
    nouveautes: [
      'Stockage Google Drive pour les cours (Mode scolaire → option « Stockage Drive ») : le bouton « Nouveau chapitre » crée la page et son dossier Drive, rangé par année, matière et support (DeepWell Cours / Année / Matière / Support).',
      'Bouton « Ajouter un fichier » sur la page d’un chapitre : le fichier part directement de ton navigateur vers Drive, sans passer par le serveur. Les fichiers des addendums vont dans un sous-dossier « Addenda ».',
      'Sur la page d’un chapitre : aperçu Drive intégré (chargé au clic), téléchargement par fichier et « Tout télécharger » en une archive ZIP (chapitre et addendums), préparée dans ton navigateur.',
      'Renommer un chapitre ou changer sa matière déplace et renomme son dossier sur Drive. Renommer ou retirer un fichier est répercuté sur Drive (corbeille de Drive, récupérable). Si Google ne répond pas, DeepWell réessaie tout seul.',
      '« Rattacher mes cours existants » (Réglages de la base) : aperçu de ce qui sera fait, puis rangement de tes cours déjà présents. Les fichiers du serveur sont envoyés sur Drive (les copies du serveur sont conservées), les liens Drive existants sont rattachés au bon chapitre sans être déplacés, les liens Canva restent des liens.',
    ],
    ameliorations: [],
    corrections: [],
  },
  {
    version: '3.1.0', date: '2026-11-19',
    nouveautes: [
      'Page « Notes de version » : l’historique des versions de Deepwell, avec une pastille discrète sur le numéro de version tant que la dernière n’a pas été consultée.',
      'Réglage « Mode scolaire » dans les bases de données (bouton « Réglages » au-dessus de la base) : il regroupe les options scolaires à venir. Une base où il est désactivé se comporte comme une base ordinaire.',
    ],
    ameliorations: [
      'File de tâches interne avec nouvelles tentatives espacées, pour les opérations qui peuvent échouer temporairement (préparation des prochaines étapes Google Drive).',
    ],
    corrections: [],
  },
  { version: '3.0.6', date: null, nouveautes: ['Bases de données : colonne « Numéro automatique », tri croissant / décroissant avec comparaison numérique.'], ameliorations: [], corrections: [] },
  { version: '3.0.5', date: null, nouveautes: [], ameliorations: ['Aperçu latéral plus aéré ; vue liste des bases sans lignes de séparation.'], corrections: [] },
  { version: '3.0.4', date: null, nouveautes: ['Propriétés d’une ligne de base : listes « à la Notion » pour Sélection, Statut et Multi-sélection.'], ameliorations: [], corrections: [] },
  { version: '3.0.3', date: null, nouveautes: [], ameliorations: [], corrections: ['Aperçu latéral d’une ligne de base décalé vers la droite avec une barre de défilement horizontale.'] },
  { version: '3.0.2', date: null, nouveautes: [], ameliorations: [], corrections: ['Supprimer une mention ou tout le contenu d’un bloc avec Retour arrière ne bloque plus la saisie dans le bloc.'] },
];
