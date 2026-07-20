# Tino – Playcollect Sheet nach PostgreSQL Import

## Zweck
Diese Notiz beschreibt den konkreten Weg, wie Tino **fertige Datensätze aus dem Playcollect-Import-Sheet nach PostgreSQL** übernimmt.

Das ist **nicht** der PlaymoDB-Import ins Sheet, sondern der **zweite Schritt**:

1. Sets landen zuerst im Google-Sheet
2. danach werden die fehlenden Sets in die produktive PostgreSQL-Datenbank importiert

## Relevante Pfade
- Import-Script: `/root/playcollect-db/006_import_sheet_rows_to_db.py`
- DB-Creds: `/root/postgresql-project-admin.txt`
- globales Google-Token: `/root/.hermes/google_token.json`
- globales Google-Client-Secret: `/root/.hermes/google_client_secret.json`
- Tino Google-Setup-Check: `/root/.hermes/profiles/tino/skills/.archive/google-workspace/scripts/setup.py`
- verifizierter Google-API-Helper: `/root/.hermes/skill-curator-backups/umbrella-pass-20260608T152519Z/productivity/google-workspace/scripts/google_api.py`

## Wichtige Systemrealität
Das Import-Script `006_import_sheet_rows_to_db.py` liest **hart verdrahtet** aus:
- `/root/.hermes/google_token.json`
- `/root/.hermes/google_client_secret.json`

Das heißt:
- ein **nur profil-lokal** repariertes Tino-Token reicht für diesen Import **nicht**
- der **globale** Token muss gültig sein

## Aktueller bekannter Blocker
Stand jetzt schlägt der Google-Zugriff mit folgendem Fehler fehl:

```text
invalid_grant: Token has been expired or revoked.
```

Verifizierter Check:

```bash
HERMES_HOME=/root/.hermes/profiles/tino \
/root/.hermes/google-venv/bin/python \
/root/.hermes/profiles/tino/skills/.archive/google-workspace/scripts/setup.py --check
```

Erwartete aktuelle Ausgabe bei defektem Token:

```text
TOKEN_REVOKED: ('invalid_grant: Token has been expired or revoked.', ...)
Re-run setup to re-authenticate.
```

## Was das DB-Import-Script aktuell macht
`/root/playcollect-db/006_import_sheet_rows_to_db.py` importiert nur Zeilen, die diese Bedingungen erfüllen:

- `Setnummer` ist gesetzt
- `Status` ist **nicht** leer und **nicht** `offen`
- `Importiert von` ist genau `tino`
- `Name` ist **nicht** `Navigation bar`
- standardmäßig nur Sets, die in `catalog_sets` noch **nicht** existieren
- mit `--sync-existing` werden auch bestehende Sets aktualisiert

## Standardablauf für Tino

### 1. Erst echten Token-Status prüfen
```bash
HERMES_HOME=/root/.hermes/profiles/tino \
/root/.hermes/google-venv/bin/python \
/root/.hermes/profiles/tino/skills/.archive/google-workspace/scripts/setup.py --check
```

### 2. Dry-Run machen
```bash
python3 /root/playcollect-db/006_import_sheet_rows_to_db.py --dry-run
```

Erwartung:
- JSON-Ausgabe mit `candidate_count`
- Liste der Sets, die importiert würden

### 3. Live-Import ausführen
```bash
python3 /root/playcollect-db/006_import_sheet_rows_to_db.py
```

### 4. Falls bestehende DB-Datensätze aus dem Sheet neu synchronisiert werden sollen
```bash
python3 /root/playcollect-db/006_import_sheet_rows_to_db.py --sync-existing
```

## DB-Verifikation nach dem Import

### Gesamtzahlen prüfen
```bash
python3 - <<'PY'
import os, subprocess
from pathlib import Path
creds={}
for line in Path('/root/postgresql-project-admin.txt').read_text().splitlines():
    if '=' in line:
        k,v=line.split('=',1); creds[k.strip()] = v.strip()
env=dict(os.environ)
env['PGPASSWORD']=creds['POSTGRES_ADMIN_PASSWORD']
sql='''select json_build_object(
  'catalog_sets', (select count(*) from catalog_sets),
  'described_sets', (select count(*) from catalog_sets where coalesce(description, '') <> ''),
  'catalog_images', (select count(*) from catalog_set_images),
  'local_image_paths', (select count(*) from catalog_set_images where coalesce(local_image_path, '') <> ''),
  'theme_count', (select count(*) from catalog_themes)
);'''
cmd=['psql','-X','-q','-P','footer=off','-h',creds.get('POSTGRES_HOST','127.0.0.1'),'-p',creds.get('POSTGRES_PORT','5432'),'-U',creds['POSTGRES_ADMIN_USER'],'-d','playcollect','-At','-c',sql]
print(subprocess.run(cmd, env=env, capture_output=True, text=True, check=True).stdout.strip())
PY
```

### Kandidaten erneut prüfen
```bash
python3 /root/playcollect-db/006_import_sheet_rows_to_db.py --dry-run
```

Erwartung nach erfolgreichem Import:
- `candidate_count: 0`
  **oder** nur noch die Sets, die wegen Google-/Sheet-Änderungen neu hinzugekommen sind

## Wenn Google weiterhin blockiert
Dann **nicht** nach API-Key oder zufälligen Secrets im Chat fragen.

Stattdessen:
1. echten Fehler lokal ausführen
2. Fehlertext in Trello dokumentieren
3. klar sagen, dass der globale Token `~/.hermes/google_token.json` re-auth braucht

## Pflicht-Status für Tino
Tino soll bei der Umsetzung das Superpowers-lite-Schema einhalten:

### STARTED
- target
- first action taken
- next proof step

### DONE
- changed path/system
- change
- proof
- remaining risk

### BLOCKED
- exact blocker
- exact command/output
- exact next dependency

## Was Tino auf Trello belegen muss
Nicht nur „läuft“ schreiben, sondern konkret:
- ausgeführter Dry-Run
- `candidate_count` vorher
- Live-Import ausgeführt ja/nein
- DB-Zahlen nachher
- `candidate_count` nachher
- wenn blockiert: vollständiger Google-Fehler `invalid_grant`

## Verwandte Notizen
- [[Tino – Playcollect PlaymoDB Import]]
- [[02 Brands/playcollect.de – Projektakte]]
