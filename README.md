# Playcollect

Zentrales Git-Repository für den aktuellen Playcollect-Stand auf diesem Agenten.

Enthalten sind:
- `playcollect-ui/` – produktive Node/Express-Oberfläche
- `playcollect-db/` – SQL-Migrationen und DB-/Import-Skripte
- `playcollect-mockup/` – frühe HTML-/Design-Quellen
- `scripts/` – wiederverwendbare Import-/Hilfsskripte
- `docs/` – technische und agentische Dokumentation, aus Obsidian gespiegelt

## Wichtige lokale Pfade

Der Agent arbeitet weiterhin über die bekannten Pfade, diese zeigen jetzt per Symlink in dieses Repo:
- `/root/playcollect-ui`
- `/root/playcollect-db`
- `/root/playcollect-mockup`
- `/root/playcollect_import_70400.py`
- `/root/.hermes/scripts/playcollect_playmodb_to_sheet.py`
- `/root/.hermes/scripts/playcollect_playmobil_archive_to_sheet.py`
- `/root/.hermes/scripts/playcollect_archive_bulk_import.py`

Damit bleiben bestehende Kommandos stabil, aber künftige Änderungen landen direkt im Git-Working-Tree.

## Nicht bewusst versioniert

Folgende lokale/generierte Bestände sind im ersten Baseline-Commit absichtlich ausgeschlossen:
- `playcollect-ui/node_modules/`
- `playcollect-ui/public/catalog-images/`
- Python-Cache-Dateien
- lokale Backup-/Export-JSONs
- Secrets / `.env`

Grund: Diese Dateien sind groß oder maschinenspezifisch und können aus Code, Importern oder lokaler Laufzeit wiederhergestellt werden.

## Git-Zugriff

Das Remote-Repo ist:
- `git@github.com:datingnischen/playcollect.git`

Der SSH-Deploy-Key liegt lokal unter:
- `/root/.ssh/playcollect_github_deploy_ed25519`

Typischer Push-Test:

```bash
GIT_SSH_COMMAND="ssh -i /root/.ssh/playcollect_github_deploy_ed25519 -o IdentitiesOnly=yes" git push origin main
```

## Nächste sinnvolle Git-Regel

Künftige Playcollect-Arbeit sollte bevorzugt direkt in diesem Repo bzw. über die stabilen Symlink-Pfade erfolgen, damit UI, DB-Skripte, Importer und Doku gemeinsam versioniert bleiben.

## Lokale Entwicklung (seit Redesign 2026-10)

Ohne Server-DB: `playcollect-ui/dev/` startet ein eingebettetes Postgres und befüllt es mit Sets von der Live-Seite.

```bash
cd playcollect-ui/dev && npm install && node devdb.js     # DB auf Port 54329
cd .. && DATABASE_URL=postgres://pc:pc@127.0.0.1:54329/playcollect node server.js
```

`PLAYCOLLECT_PREVIEW_PASSWORD` aktiviert den Testzugang (kein Standardpasswort mehr im Code). `dev/shots.js` prüft per Puppeteer die Hauptabläufe und macht Screenshots.
