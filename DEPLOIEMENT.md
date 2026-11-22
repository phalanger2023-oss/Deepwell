# Mettre DeepWell en ligne (Docker + Traefik)

Même principe que les autres applications du serveur : Docker Compose, Traefik, certificat HTTPS automatique.
Adresse prévue : **https://deepwell.louisharicuisine.com** (modifiable dans `.env`).

## Ce qu'il faut savoir
- Les données (base, **clé de chiffrement `secret.key`**, fichiers, sauvegardes) vivent dans le volume Docker `deepwell_data`. Elles ne sont **jamais** sur GitHub.
- Sans `secret.key`, la base ne se relit pas : toujours copier base et clé ensemble.
- Le premier compte créé devient administrateur.

## Première installation
1. Le sous-domaine doit pointer vers le serveur (enregistrement DNS de type A).
2. Récupérer le code dans `~/apps/deepwell` : `git clone https://github.com/phalanger2023-oss/Deepwell.git ~/apps/deepwell`
3. `cp .env.example .env` (puis régler `DEEPWELL_HOST` si besoin).
4. `docker compose build --no-cache deepwell` puis `docker compose up -d`.
5. Vérifier : `docker compose ps` (état « healthy ») et ouvrir l'adresse dans le navigateur.

## Reprendre les données d'un DeepWell existant (une seule fois)
1. Sur l'ancien PC : fermer DeepWell, puis zipper tout le dossier `data/` (base `deepwell.db`, `secret.key`, `uploads/`, `backups/`).
2. Envoyer le zip sur le serveur, le dézipper dans un dossier temporaire, puis le copier dans le volume (le conteneur doit être arrêté : `docker compose stop deepwell`).
3. `docker compose start deepwell`.

## Mettre à jour après une modification
```
cd ~/apps/deepwell && git pull
docker compose up -d --build
```
Si `package.json` ou le `Dockerfile` ont changé : `docker compose build --no-cache deepwell` puis `docker compose up -d`.

## Sauvegarde du volume
```
docker run --rm -v deepwell_data:/donnees -v "$PWD":/sauvegarde alpine tar czf /sauvegarde/deepwell-data.tgz -C /donnees .
```
