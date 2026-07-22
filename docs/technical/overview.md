# Playcollect – Technische Übersicht

Stand dieser Baseline:
- Git-Remote erreichbar und per Deploy-Key beschreibbar
- lokaler Quellstand in ein zentrales Repo unter `/root/playcollect` überführt
- Altpfade per Symlink erhalten

## Struktur

### `playcollect-ui/`
Enthält die produktive Node-/Express-Anwendung.
Wichtige Dateien:
- `server.js`
- `package.json`
- `package-lock.json`
- `public/styles.css`
- `public/*.svg`

Nicht versioniert:
- `node_modules/`
- `public/catalog-images/`

### `playcollect-db/`
Enthält Migrationen und Import-/Hilfsskripte rund um PostgreSQL und Katalogdaten.

Aktuelle Kern-Dateien:
- `001_initial_schema.sql`
- `002_add_catalog_set_images.sql`
- `003_import_playmobil_20.sql`
- `004_add_local_image_path.sql`
- `005_update_local_image_paths.sql`
- `006_import_sheet_rows_to_db.py`
- `007_add_user_sessions.sql`
- `008_add_i18n_translation_tables.sql`
- `download_playmobil_images.py`
- `import_inventory_xlsx_to_collection.py`

### `playcollect-mockup/`
Frühe HTML-/Frontend-Quellen und Design-Artefakte.

### `scripts/`
Zusätzliche operative Skripte für Importe und Hilfsworkflows:
- `playcollect_playmodb_to_sheet.py`
- `playcollect_playmobil_archive_to_sheet.py`
- `playcollect_archive_bulk_import.py`
- `playcollect_import_70400.py`

## Dokumentation

Die bisher relevanten agentischen Notizen wurden aus Obsidian in dieses Repo gespiegelt:
- `docs/agents/Tino – Playcollect PlaymoDB Import.md`
- `docs/agents/Tino – Playcollect Sheet nach PostgreSQL Import.md`

Neue Technik-Dokumentation:
- `playcollect-ui/PLAYCOLLECT_I18N_ARCHITECTURE.md`
- `docs/technical/playcollect-i18n-db-migration-plan.md`

## Deployment-/Betriebshinweis

Einige Laufzeit- und Host-Aspekte bleiben bewusst außerhalb des Repos:
- DB-Credentials
- Google OAuth Tokens / Client Secret
- lokale Service-/Env-Secrets
- gespiegelt heruntergeladene Katalogbilder

Diese Trennung ist absichtlich, damit das Repo Git-tauglich bleibt und keine sensiblen Daten enthält.
