# Playcollect i18n – PostgreSQL-Translationsschema & Migrationsplan

## Zweck
Diese Migration legt die DB-Basis für echtes DE/EN/FR-Routing, übersetzte Themenwelten und spätere SEO-Freigaben, ohne die bestehende Playcollect-App oder die laufenden Importer zu brechen.

## Neue Migration
- `playcollect-db/008_add_i18n_translation_tables.sql`

## Was die Migration anlegt

### 1) `catalog_set_translations`
Speichert sprachabhängige Set-Texte pro Locale.

Felder:
- `set_id`
- `locale` (`de`, `en`, `fr`)
- `name`
- `description`
- `seo_title`
- `meta_description`
- `translation_state`
- `is_indexable`
- `created_at`, `updated_at`

Regeln:
- `UNIQUE(set_id, locale)`
- Check auf erlaubte Locales
- Check auf erlaubte States: `canonical`, `draft`, `machine`, `reviewed`, `published`

### 2) `catalog_theme_translations`
Speichert sprachabhängige Namen, Slugs und Introtexte pro Themenwelt.

Felder:
- `theme_id`
- `locale` (`de`, `en`, `fr`)
- `name`
- `slug`
- `intro`
- `hero_description`
- `meta_description`
- `translation_state`
- `is_indexable`
- `created_at`, `updated_at`

Regeln:
- `UNIQUE(theme_id, locale)`
- `UNIQUE(locale, slug)` für öffentliche Locale-Slugs
- Check auf erlaubte Locales
- Check auf erlaubte States

## Bewusste Architekturentscheidung

### Bestehende Kern-Tabellen bleiben vorerst erhalten
Die Migration entfernt **nichts** aus:
- `catalog_sets`
- `catalog_themes`

Damit bleibt die bestehende App kompatibel, während die neuen i18n-Routen schrittweise umgebaut werden.

### Bestehende Slugs bleiben zunächst die stabilen internen Keys
- `catalog_sets.slug` bleibt technischer Set-Slug
- `catalog_themes.slug` bleibt technischer Theme-Key während der Transition
- öffentliche Locale-Slugs laufen künftig über `catalog_theme_translations.slug`

Das vermeidet einen riskanten Big-Bang-Umbau im laufenden Betrieb.

## Backfill-Strategie in 008

### DE wird automatisch aus dem Bestand erzeugt
Die Migration schreibt für alle vorhandenen Datensätze sofort:
- `catalog_set_translations(locale='de')`
- `catalog_theme_translations(locale='de')`

Quelle:
- Sets: `catalog_sets.name`, `catalog_sets.description`
- Themes: `catalog_themes.name`, `catalog_themes.slug`, `catalog_themes.description`

Dabei gilt:
- `translation_state = 'canonical'`
- `is_indexable = TRUE`

So ist DE direkt vollständig befüllt, während EN/FR leer bzw. später befüllbar bleiben.

## Trigger-/Sync-Strategie

### Problem
Die aktuellen Importer schreiben weiterhin in:
- `catalog_sets`
- `catalog_themes`

Ohne Sync würden neue oder geänderte DE-Daten nicht automatisch in den Translationstabellen landen.

### Lösung
Die Migration legt zwei Trigger an:
- `catalog_sets_sync_de_translation_trg`
- `catalog_themes_sync_de_translation_trg`

Diese spiegeln neue/aktualisierte DE-Inhalte automatisch in die Translationstabellen.

### Schutz vor Überschreiben manueller Übersetzungen
Die Trigger überschreiben **nur** Datensätze mit:
- `translation_state = 'canonical'`

Das heißt:
- bestehende DE-Spiegelung bleibt automatisch aktuell
- später manuell gepflegte Inhalte mit `reviewed` oder `published` werden nicht versehentlich von Alt-Importern zurückgedreht

## Rollout-Reihenfolge

### Phase A – jetzt erledigt mit 008
- Translationstabellen anlegen
- DE-Backfill aus Altbestand
- Trigger für laufende DE-Synchronisation
- Index-Basis für spätere Locale-Abfragen

### Phase B – nächste App-Karten
1. App liest Themes/Settexte locale-aware aus Translationstabellen
2. Theme-Slug-Auflösung läuft über `catalog_theme_translations`
3. EN/FR-Seiten nutzen DE-Fallback kontrolliert
4. `is_indexable` steuert Noindex-/Index-Freigaben sauber pro Locale

### Phase C – Content-/Workflow-Karten
- Sheet-/Workflow-Anbindung für Übersetzungen
- Review-States nutzen (`machine`, `reviewed`, `published`)
- EN/FR erst indexieren, wenn echte Inhalte vorliegen

## Query-Muster für die nächsten Karten

### Set mit Locale + DE-Fallback laden
```sql
SELECT
  s.id,
  s.set_number,
  s.slug,
  COALESCE(t_req.name, t_de.name, s.name) AS display_name,
  COALESCE(t_req.description, t_de.description, s.description) AS display_description,
  COALESCE(t_req.seo_title, t_de.seo_title) AS seo_title,
  COALESCE(t_req.meta_description, t_de.meta_description) AS meta_description,
  COALESCE(t_req.is_indexable, FALSE) AS locale_indexable
FROM catalog_sets s
LEFT JOIN catalog_set_translations t_req
  ON t_req.set_id = s.id AND t_req.locale = $1
LEFT JOIN catalog_set_translations t_de
  ON t_de.set_id = s.id AND t_de.locale = 'de'
WHERE s.set_number = $2;
```

### Theme per öffentlichem Locale-Slug auflösen
```sql
SELECT
  th.id,
  th.slug AS internal_slug,
  COALESCE(tt_req.name, tt_de.name, th.name) AS display_name,
  COALESCE(tt_req.slug, tt_de.slug, th.slug) AS public_slug,
  COALESCE(tt_req.intro, tt_de.intro, th.description) AS intro,
  COALESCE(tt_req.hero_description, tt_de.hero_description, th.description) AS hero_description,
  COALESCE(tt_req.meta_description, tt_de.meta_description) AS meta_description,
  COALESCE(tt_req.is_indexable, FALSE) AS locale_indexable
FROM catalog_theme_translations tt_req
JOIN catalog_themes th ON th.id = tt_req.theme_id
LEFT JOIN catalog_theme_translations tt_de
  ON tt_de.theme_id = th.id AND tt_de.locale = 'de'
WHERE tt_req.locale = $1
  AND tt_req.slug = $2;
```

## Betriebsregeln während der Transition
- Bestehende Importe dürfen weiter in die Alt-Tabellen schreiben.
- Neue EN/FR-Inhalte gehören nur in die Translationstabellen.
- Öffentliche EN/FR-Slugs dürfen nie aus `catalog_themes.slug` abgeleitet werden, sondern nur aus `catalog_theme_translations.slug`.
- Index-Freigabe neuer Locales erst nach echter Inhaltsprüfung.

## Verifikation nach Migration
Pflichtchecks:
- Anzahl `catalog_set_translations` für `de` entspricht Anzahl `catalog_sets`
- Anzahl `catalog_theme_translations` für `de` entspricht Anzahl `catalog_themes`
- Trigger erzeugen bei neuen Sets/Themes automatisch einen DE-Translationseintrag
- `translation_state = 'reviewed'|'published'` wird von Triggern nicht überschrieben

## Noch bewusst nicht in 008 enthalten
- keine EN/FR-Inhalte
- keine statischen Seitentexte
- keine App-Query-Umbauten
- keine `hreflang`-/Sitemap-Logik
- keine automatische Sheet-Synchronisierung für EN/FR

Das folgt in den nächsten Karten, damit die Umstellung kontrolliert und ohne Live-Bruch bleibt.
