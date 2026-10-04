# Playcollect i18n – Übersetzungsworkflow, Sheet-Anbindung & Rollout-QA

## Zweck
Karte 7 verbindet die neue i18n-Datenstruktur mit einem praxistauglichen Redaktions- und QA-Workflow in Google Sheets.

Ziel:
- Übersetzungen nicht direkt in SQL pflegen
- Sets und Themenwelten sauber in Google Sheets bearbeiten
- EN/FR schrittweise freigeben statt blind zu indexieren
- echte Rollout-Zahlen live aus PostgreSQL im Sheet sehen

## Neuer Workflow-Script
- `playcollect-db/009_sync_i18n_translation_sheet.py`

Interpreter:
- `/root/.hermes/google-venv/bin/python`

## Verwendete Google-Sheet-Tabs
Der Script arbeitet auf dem bestehenden Playcollect-Import-Sheet und legt diese zusätzlichen Tabs an:

- `I18N_Anleitung`
- `I18N_Set_Translations`
- `I18N_Theme_Translations`
- `I18N_Rollout_QA`

Die bestehenden Tabs bleiben unberührt:
- `Anleitung`
- `Katalog_Import`
- `Bilder_Import`

## Tab-Logik

### 1) `I18N_Set_Translations`
Eine Zeile pro:
- Set
- Locale (`de`, `en`, `fr`)

Wichtige Spalten:
- `Setnummer`
- `Basisname DE`
- `Themenwelt DE`
- `Jahr`
- `Locale`
- `Name`
- `Beschreibung`
- `SEO Titel`
- `Meta Beschreibung`
- `Übersetzungsstatus`
- `Indexierbar`
- `Sync Aktion`
- `Zuletzt aktualisiert UTC`

### 2) `I18N_Theme_Translations`
Eine Zeile pro:
- Themenwelt
- Locale (`de`, `en`, `fr`)

Wichtige Spalten:
- `Interner Theme-Slug`
- `Basisname DE`
- `Locale`
- `Öffentlicher Slug`
- `Name`
- `Intro`
- `Hero Beschreibung`
- `Meta Beschreibung`
- `Übersetzungsstatus`
- `Indexierbar`
- `Sync Aktion`
- `Zuletzt aktualisiert UTC`

### 3) `I18N_Rollout_QA`
Live-QA aus PostgreSQL, z. B.:
- `catalog_sets`
- `catalog_themes`
- `set_translations` pro Locale
- `theme_translations` pro Locale
- `missing_set_translations` pro Locale
- `missing_theme_translations` pro Locale
- Index-Regeln für DE/EN/FR

### 4) `I18N_Anleitung`
Kurzanleitung für Redaktion und Import.

## Betriebsmodell

### Export
Der Export schreibt den aktuellen DB-Stand in die i18n-Tabs.

Command:
```bash
/root/.hermes/google-venv/bin/python /root/playcollect/playcollect-db/009_sync_i18n_translation_sheet.py export
```

Effekt:
- Tabs werden bei Bedarf erstellt
- DE-Bestand wird sichtbar gemacht
- EN/FR erscheinen als leere Arbeitszeilen
- QA-Tab wird mit Live-Zahlen gefüllt

### Import Dry-Run
Liest nur Zeilen ein, bei denen `Sync Aktion` gesetzt ist, schreibt aber noch nichts in PostgreSQL.

Command:
```bash
/root/.hermes/google-venv/bin/python /root/playcollect/playcollect-db/009_sync_i18n_translation_sheet.py import
```

Gültige Trigger in `Sync Aktion`:
- `upsert`
- `import`
- `sync`
- `apply`
- `ja`
- `x`

### Import Live
Schreibt markierte Zeilen zurück in:
- `catalog_set_translations`
- `catalog_theme_translations`

Command:
```bash
/root/.hermes/google-venv/bin/python /root/playcollect/playcollect-db/009_sync_i18n_translation_sheet.py import --apply
```

### QA-Refresh
Aktualisiert nur den Rollout-QA-Tab neu.

Command:
```bash
/root/.hermes/google-venv/bin/python /root/playcollect/playcollect-db/009_sync_i18n_translation_sheet.py qa
```

## Freigaberegeln

### Deutsch
- bleibt aktuell primäre Live-Sprache
- darf indexierbar bleiben
- kommt aus dem bestehenden Bestand / Canonical-Bridge

### Englisch / Französisch
- starten bewusst konservativ
- zunächst `Indexierbar = nein`
- erst nach echter Textpflege + Prüfung gezielt auf `ja`

Damit bleibt die SEO-Strategie sauber:
- DE index
- EN/FR noindex bis substanzieller Content vorhanden ist

## Was Karte 7 konkret löst
- echtes Redaktions-Backend über Google Sheets statt SQL-Handarbeit
- klare Trennung zwischen Datenbestand und Übersetzungsarbeit
- rückspielbarer Workflow per `Sync Aktion`
- Live-Rollout-Monitoring direkt im Sheet
- kontrollierte EN/FR-Freigabe statt Massenindexierung leerer Seiten

## Verifikation aus der Umsetzung
Live nach Export/QA im bestehenden Playcollect-Sheet angelegt:
- `I18N_Anleitung`
- `I18N_Set_Translations`
- `I18N_Theme_Translations`
- `I18N_Rollout_QA`

Export-Ergebnis:
- `7509` Set-Locale-Zeilen
- `192` Theme-Locale-Zeilen

End-to-end Importtest erfolgreich:
- 1 EN-Setübersetzung per Sheet → PostgreSQL geschrieben
- 1 EN-Themenweltübersetzung per Sheet → PostgreSQL geschrieben
- danach Export erneut gefahren, damit Sync-Aktion wieder leer und Sheet/DB sauber synchron sind

Verifizierte Live-Zahlen nach Test:
- `set_translations(en) = 1`
- `theme_translations(en) = 1`

## Wichtige redaktionelle Regeln
- keine 1:1-Quellkopien
- kundenfreundliche Texte
- keine internen Techniklabels in sichtbaren Texten
- EN/FR erst indexieren, wenn Texte wirklich tragfähig sind
- bei Bildern keine fremden Wasserzeichen/Anbieterlogos/Copyright-Hinweise entfernen
- normale Qualitätsoptimierung nur bei eigenen oder rechtegeklärten Bildern
