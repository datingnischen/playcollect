# Tino – Playcollect PlaymoDB Import

## Zweck
Diese Notiz beschreibt den Standardweg, wie Tino neue Playmobil-Sets aus **PlaymoDB** in das Google-Sheet für Playcollect übernimmt.

## Ziel
Tino soll:
1. eine Setnummer oder PlaymoDB-URL bekommen
2. die Fakten aus PlaymoDB ziehen
3. eine **eigene deutsche Kurzbeschreibung** erzeugen
4. den Datensatz ins Sheet schreiben
5. die Bildquellen im Bild-Tab dokumentieren

## Wichtigste Regel
**Nie 1:1 Texte aus PlaymoDB, Herstellerseiten oder Shops kopieren.**

Erlaubt ist:
- Setnummer
- Name
- Themenwelt
- Fokus / Kategorie
- Erscheinungsjahr
- Teileanzahl
- Bildquellen
- sachliche Merkmale

Nicht erlaubt ist:
- längere Beschreibungen oder Marketingtexte einfach zu übernehmen
- englische Quelltexte ungeprüft ins deutsche Sheet zu schreiben

## Google Sheet
- Name: `Playcollect – Import Sheet`
- URL: https://docs.google.com/spreadsheets/d/1da21AwIV6DeJZeuCs2H_hHAO6h7wIo9qGFey5KyRx6w/edit
- Tabs:
  - `Anleitung`
  - `Katalog_Import`
  - `Bilder_Import`

## Scripts
### PlaymoDB
- Pfad: `/root/.hermes/scripts/playcollect_playmodb_to_sheet.py`
- Python: nutzt direkt die Google-venv per Shebang

### Offizielles PLAYMOBIL Archiv
- Pfad: `/root/.hermes/scripts/playcollect_playmobil_archive_to_sheet.py`
- Quelle: `https://www.playmobil.com/de-de/archiv/`
- Zweck: alte Sets direkt aus dem offiziellen PLAYMOBIL-Archiv ins Import-Sheet übernehmen
- Wichtig: Beschreibungen werden ebenfalls **neu formuliert** und nicht 1:1 aus der Quelle übernommen

## Standardaufruf
### Mit Setnummer
```bash
/root/.hermes/scripts/playcollect_playmodb_to_sheet.py 70947 --imported-by Tino
```

### Mit kompletter URL
```bash
/root/.hermes/scripts/playcollect_playmodb_to_sheet.py "https://playmodb.org/cgi-bin/showinv.pl?setnum=70947" --imported-by Tino
```

### Nur prüfen, ohne ins Sheet zu schreiben
```bash
/root/.hermes/scripts/playcollect_playmodb_to_sheet.py 70947 --dry-run
```

### Offizielles PLAYMOBIL-Archiv: einzelnes Set importieren
```bash
/root/.hermes/scripts/playcollect_playmobil_archive_to_sheet.py "https://www.playmobil.com/de-de/multi-play-maedchen/6467.html" --imported-by Tino
```

### Offizielles PLAYMOBIL-Archiv: Archivseite prüfen
```bash
/root/.hermes/scripts/playcollect_playmobil_archive_to_sheet.py --page 1 --limit 5 --dry-run
```

## Was das Script schreibt
### Tab `Katalog_Import`
- Status
- Setnummer
- Name
- Slug
- Themenwelt
- Kategorie/Fokus
- Quelle URL
- Quellenhinweis
- Merkmale / Stichpunkte
- **Eigene Kurzbeschreibung DE**
- Zubehör / Besonderheiten
- Erscheinungsjahr
- Marke
- Bildanzahl
- Beschreibung geprüft
- Importiert von
- Notizen

### Tab `Bilder_Import`
- Status
- Setnummer
- Bildtyp
- Quelle Bild-URL
- lokaler Dateipfad (bleibt zunächst leer)
- deutscher Alt-Text
- Primärbild ja/nein
- Reihenfolge
- geprüft ja/nein
- Notiz

## Verhalten des Scripts
- erkennt Setnummer aus Nummer oder URL
- ruft die Setseite bei PlaymoDB auf
- schreibt **deutsche Umschreibung** statt Kopie
- legt neue Zeilen an oder aktualisiert vorhandene Setnummern
- ergänzt neue Bildquellen nur einmal

## Aktueller Test
Erfolgreich getestet mit:
- Set `70947`
- Quelle: `https://playmodb.org/cgi-bin/showinv.pl?setnum=70947`

## Grenzen
- Das Script dokumentiert Bildquellen im Sheet, lädt Bilder aber **nicht automatisch lokal herunter**.
- Für produktive lokale App-Bilder braucht es später einen separaten Download-Schritt.
- Wenn PlaymoDB nur englische Namen liefert, darf Tino die **Kurzbeschreibung deutsch schreiben**, aber den Namen nur dann frei übersetzen, wenn die deutsche Form eindeutig ist.

## Tino-Regel
Wenn Unsicherheit bei Name oder Einordnung besteht:
- Quelle dokumentieren
- Kurzbeschreibung neutral und sachlich halten
- keine kreative Produktbehauptung erfinden

## Verwandte Notiz
- [[Tino – Playcollect Sheet nach PostgreSQL Import]]
