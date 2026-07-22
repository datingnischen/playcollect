# Playcollect i18n + Multi-Market Architecture

## Zielbild
Playcollect startet zunächst komplett auf `playcollect.de` mit:

- `https://playcollect.de/` → Deutsch (Default)
- `https://playcollect.de/en/...` → Englisch
- `https://playcollect.de/fr/...` → Französisch

Später soll dieselbe Architektur auf andere Domains / Marken migrierbar sein, z. B.:

- `playcollect.com/...` oder neuer Markenname für EN
- `playcollect.fr/...` für FR

Die Architektur muss deshalb **domain-neutral**, **locale-aware** und **SEO-fähig** sein.

---

## 1. URL-Strategie

## Sofort umsetzen

### Default-Locale ohne Präfix
- DE bleibt auf Root:
  - `/`
  - `/katalog`
  - `/sets/4865`
  - `/themenwelten/piraten`

### Zusätzliche Locales mit Präfix
- EN:
  - `/en/`
  - `/en/catalog`
  - `/en/sets/4865`
  - `/en/themes/pirates`
- FR:
  - `/fr/`
  - `/fr/catalogue`
  - `/fr/sets/4865`
  - `/fr/themes/pirates`

## Optional
- `/de/...` nur als 301-Weiterleitung auf Root-Variante
- Beispiel: `/de/sets/4865` → `/sets/4865`

## Regel
- **Setnummer ist sprachneutral und stabil**
- **Slugs von Themenwelten und statischen Seiten sind locale-spezifisch**

---

## 2. Routing-Modell im Node-Server

Der aktuelle Server ist deutsch-first und erzeugt überall harte Pfade wie:
- `/search`
- `/katalog`
- `/themenwelten`
- `/sets/:setNumber`
- HTML `<html lang="de">`

## Ziel-Routing
Ein zentrales Locale-Parsing vor allen Seitenrouten.

## Vorschlag

### Locale-Konfig
```js
const SUPPORTED_LOCALES = ['de', 'en', 'fr'];
const DEFAULT_LOCALE = 'de';
```

### Locale aus Request ableiten
- `/...` => `de`
- `/en/...` => `en`
- `/fr/...` => `fr`

### Middleware / Helper
Helpers wie:
- `detectLocale(req)`
- `stripLocalePrefix(pathname)`
- `buildLocaleUrl(locale, routeKey, params)`
- `isDefaultLocale(locale)`

### Wichtige Folge
Routen sollen nicht mehr direkt nur deutsch sein, sondern mit einem internen Route-Key arbeiten.

Beispiel intern:
- `home`
- `search`
- `catalog`
- `themes`
- `themeDetail`
- `setDetail`
- `legalPlaymobil`

Locale-spezifische Pfade werden dann aus Mapping erzeugt.

---

## 3. Route-Mapping pro Sprache

## Vorschlag
```js
const ROUTE_PATHS = {
  de: {
    home: '/',
    search: '/search',
    catalog: '/katalog',
    themes: '/themenwelten',
    themeDetail: '/themenwelten/:slug',
    setDetail: '/sets/:setNumber',
    legalPlaymobil: '/hinweis-playmobil',
  },
  en: {
    home: '/en',
    search: '/en/search',
    catalog: '/en/catalog',
    themes: '/en/themes',
    themeDetail: '/en/themes/:slug',
    setDetail: '/en/sets/:setNumber',
    legalPlaymobil: '/en/playmobil-notice',
  },
  fr: {
    home: '/fr',
    search: '/fr/recherche',
    catalog: '/fr/catalogue',
    themes: '/fr/themes',
    themeDetail: '/fr/themes/:slug',
    setDetail: '/fr/sets/:setNumber',
    legalPlaymobil: '/fr/mention-playmobil',
  },
};
```

## Wichtige Entscheidung
Für Theme-Detail-Seiten sollte nicht der interne Theme-Slug direkt in allen Märkten verwendet werden, sondern die **übersetzte Slug-Version pro Locale**.

---

## 4. Datenmodell: sprachneutral vs. übersetzbar

## Sprachneutral lassen
Diese Daten bleiben in den bestehenden Kern-Tabellen:

### `catalog_sets`
- `id`
- `set_number`
- `release_year`
- `theme_id`
- `metadata`
- Bilder / Referenzen

### `catalog_themes`
- `id`
- interner stabiler Schlüssel / technischer Slug
- evtl. Sortierung / systemische Flags

## Neue Übersetzungstabellen

### `catalog_set_translations`
```sql
id
set_id
locale                -- de / en / fr
name
description
seo_title
meta_description
source_status         -- optional: draft / reviewed / machine / manual
created_at
updated_at
UNIQUE(set_id, locale)
```

### `catalog_theme_translations`
```sql
id
theme_id
locale
name
slug
intro
hero_description
meta_description
created_at
updated_at
UNIQUE(theme_id, locale)
UNIQUE(locale, slug)
```

### Optional später: `static_page_translations`
Für Startseite, Suchseite, rechtliche Seite, Sammlungs-Infos etc.

```sql
id
page_key              -- home / legal_playmobil / collection_intro ...
locale
title
body_html_or_md
seo_title
meta_description
UNIQUE(page_key, locale)
```

---

## 5. Theme-System für Mehrsprachigkeit

Die Themenwelt muss künftig aus zwei Ebenen bestehen:

## Intern stabil
- technischer Key, z. B. `pirates`
- bleibt systemweit konstant

## Öffentlich pro Locale
- DE Name: `Piraten`
- DE Slug: `piraten`
- EN Name: `Pirates`
- EN Slug: `pirates`
- FR Name: `Pirates`
- FR Slug: `pirates` oder lokalisiert

## Folge
Links wie `themeUrl(themeSlug)` dürfen nicht mehr direkt vom DB-Slug ausgehen, sondern müssen über Locale-Translation laufen.

---

## 6. Set-Seiten: Übersetzungen

## Set-URL
Die Setnummer bleibt identisch:
- DE: `/sets/4865`
- EN: `/en/sets/4865`
- FR: `/fr/sets/4865`

## Inhalt je Sprache
Laden aus `catalog_set_translations`:
- Name
- Beschreibung
- SEO Title
- Meta Description

## Fallback-Regel
Wenn eine EN-/FR-Übersetzung noch fehlt:
1. Seite darf technisch existieren
2. aber möglichst `noindex` solange die Übersetzung dünn/unfertig ist
3. oder gezielt nur DE indexieren, EN/FR erst nach Inhalt freischalten

Wichtig für SEO: keine halbleeren Sprachseiten massenhaft indexieren.

---

## 7. UI / Header-Sprachumschalter

## Header-Komponente
Im Header rechts ein Locale-Switcher:
- 🇩🇪 DE
- 🇬🇧 EN
- 🇫🇷 FR

## Verhalten
Wenn User auf einer Seite ist, springt der Switcher auf die äquivalente Seite:
- `/sets/4865` → `/en/sets/4865`
- `/themenwelten/piraten` → `/fr/themes/pirates`

## Dafür nötig
Pro Seite eine Funktion:
- `getAlternateUrls({ locale, routeKey, entityId/slug })`

---

## 8. SEO-Anforderungen

Jede indexierbare Seite braucht künftig:

### `<html lang>`
Nicht mehr hart `de`, sondern dynamisch:
```html
<html lang="de">
<html lang="en">
<html lang="fr">
```

### `canonical`
- DE Root-Variante canonical auf DE-URL
- EN canonical auf EN-URL
- FR canonical auf FR-URL

### `hreflang`
Beispiel für Setseite 4865:
```html
<link rel="alternate" hreflang="de-DE" href="https://playcollect.de/sets/4865">
<link rel="alternate" hreflang="en" href="https://playcollect.de/en/sets/4865">
<link rel="alternate" hreflang="fr-FR" href="https://playcollect.de/fr/sets/4865">
<link rel="alternate" hreflang="x-default" href="https://playcollect.de/sets/4865">
```

### Sitemaps
Empfohlen:
- `/sitemap-de.xml`
- `/sitemap-en.xml`
- `/sitemap-fr.xml`
- optional Sitemap-Index

### Robots / Indexing-Strategie
Nur Seiten indexieren, deren Übersetzung wirklich brauchbar ist.

---

## 9. Content-Quellen / Import-Pipeline

## Import-Realität
Aktuell kommen Daten aus Sheet / DB mit deutsch geprägten Texten.

## Ziel-Pipeline
### Phase 1
- DE bleibt primäre Redaktionssprache
- EN/FR-Felder dürfen zunächst leer sein

### Phase 2
- Übersetzungen für Sets generieren / pflegen
- Themenwelten priorisiert manuell + halbautomatisch

### Phase 3
- wichtige statische/SEO-Seiten pro Sprache sauber redaktionell pflegen

## Wichtig
Keine 1:1 Quellkopien. Übersetzungsfelder müssen denselben Qualitätsanspruch behalten:
- kundenfreundlich
- natürlich
- keine internen Labels
- keine sichtbaren Quellhinweise

---

## 10. Migration ohne spätere Schmerzen

Diese Architektur ist absichtlich so gewählt, dass später Domainwechsel leicht möglich ist.

## Heute
- DE: `playcollect.de/...`
- EN: `playcollect.de/en/...`
- FR: `playcollect.de/fr/...`

## Morgen
- DE: `playcollect.de/...`
- EN: `newbrand.com/...`
- FR: `newbrand.fr/...`

Dafür wichtig:
- Locale nicht hart an Domain koppeln
- Domain nur in einer zentralen Market-Konfiguration definieren

## Vorschlag Market-Konfig
```js
const MARKET_CONFIG = {
  de: { host: 'playcollect.de', locale: 'de', prefix: '' },
  en: { host: 'playcollect.de', locale: 'en', prefix: '/en' },
  fr: { host: 'playcollect.de', locale: 'fr', prefix: '/fr' },
};
```

Später nur Config ändern, nicht die gesamte Routing-Logik.

---

## 11. Konkrete Umsetzungsphasen

## Phase A — Architektur vorbereiten
1. Locale-Konstanten + Route-Key-System einführen
2. harte Pfade durch URL-Builder ersetzen
3. `<html lang>` dynamisch machen
4. Header/Footer/Navi locale-aware machen

## Phase B — Datenmodell erweitern
1. `catalog_set_translations`
2. `catalog_theme_translations`
3. Theme-Translation-Lookup im Server einbauen
4. Fallback-Logik definieren

## Phase C — erste Mehrsprachigkeit live
1. DE live wie bisher
2. EN unter `/en/`
3. FR unter `/fr/`
4. Sprachswitcher live
5. hreflang/canonical live

## Phase D — Content-Ausbau
1. Themenwelten priorisieren
2. Top-Setseiten übersetzen
3. Statische Seiten übersetzen
4. index/noindex fein steuern

## Phase E — spätere Domain-Migration
1. finalen internationalen Namen festlegen
2. EN/FR auf neue Domains umziehen
3. 301-Mapping setzen
4. hreflang / canonicals anpassen

---

## 12. Konkrete erste technische Tickets

### Ticket 1
Locale-Detection + URL-Builder im Node-Server einführen

### Ticket 2
Header/Footer/Navi vollständig locale-aware machen

### Ticket 3
Theme- und Set-Übersetzungstabellen in PostgreSQL anlegen

### Ticket 4
DE/EN/FR-Routen für Katalog, Suche, Themenwelten, Set-Detail einführen

### Ticket 5
hreflang/canonical/sitemap-Logik einbauen

### Ticket 6
Admin-/Sheet-/Import-Strategie für Übersetzungsfelder festlegen

---

## Empfehlung / Entscheidung

### Ja, jetzt so starten:
- `playcollect.de/` = DE
- `playcollect.de/en/...` = EN
- `playcollect.de/fr/...` = FR

### Und bewusst NICHT sofort tun:
- Deutsch unter `/de/` zwingen
- Locale-Logik fest an spätere Domains koppeln
- alle Seiten sofort indexieren, bevor Übersetzungen stehen

Das ist der richtige Übergang zwischen:
- **heute alles auf einer Domain betreiben**
- **morgen sauber international skalieren**
