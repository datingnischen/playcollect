BEGIN;

CREATE OR REPLACE FUNCTION normalized_translation_text(input_text TEXT)
RETURNS TEXT AS $$
  SELECT NULLIF(regexp_replace(btrim(COALESCE(input_text, '')), '\s+', ' ', 'g'), '');
$$ LANGUAGE sql IMMUTABLE;

CREATE TABLE IF NOT EXISTS catalog_set_translations (
  id                 BIGSERIAL PRIMARY KEY,
  set_id             BIGINT NOT NULL REFERENCES catalog_sets(id) ON DELETE CASCADE,
  locale             TEXT NOT NULL,
  name               TEXT NOT NULL,
  description        TEXT,
  seo_title          TEXT,
  meta_description   TEXT,
  translation_state  TEXT NOT NULL DEFAULT 'draft',
  is_indexable       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalog_set_translations_set_locale_unique UNIQUE (set_id, locale),
  CONSTRAINT catalog_set_translations_locale_chk CHECK (locale IN ('de', 'en', 'fr')),
  CONSTRAINT catalog_set_translations_state_chk CHECK (translation_state IN ('canonical', 'draft', 'machine', 'reviewed', 'published'))
);

CREATE INDEX IF NOT EXISTS catalog_set_translations_locale_idx
  ON catalog_set_translations (locale);

CREATE INDEX IF NOT EXISTS catalog_set_translations_indexable_idx
  ON catalog_set_translations (locale, is_indexable)
  WHERE is_indexable = TRUE;

CREATE TABLE IF NOT EXISTS catalog_theme_translations (
  id                 BIGSERIAL PRIMARY KEY,
  theme_id           BIGINT NOT NULL REFERENCES catalog_themes(id) ON DELETE CASCADE,
  locale             TEXT NOT NULL,
  name               TEXT NOT NULL,
  slug               TEXT NOT NULL,
  intro              TEXT,
  hero_description   TEXT,
  meta_description   TEXT,
  translation_state  TEXT NOT NULL DEFAULT 'draft',
  is_indexable       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalog_theme_translations_theme_locale_unique UNIQUE (theme_id, locale),
  CONSTRAINT catalog_theme_translations_locale_chk CHECK (locale IN ('de', 'en', 'fr')),
  CONSTRAINT catalog_theme_translations_state_chk CHECK (translation_state IN ('canonical', 'draft', 'machine', 'reviewed', 'published'))
);

CREATE UNIQUE INDEX IF NOT EXISTS catalog_theme_translations_locale_slug_uidx
  ON catalog_theme_translations (locale, slug);

CREATE INDEX IF NOT EXISTS catalog_theme_translations_locale_idx
  ON catalog_theme_translations (locale);

CREATE INDEX IF NOT EXISTS catalog_theme_translations_indexable_idx
  ON catalog_theme_translations (locale, is_indexable)
  WHERE is_indexable = TRUE;

DROP TRIGGER IF EXISTS catalog_set_translations_set_updated_at ON catalog_set_translations;
CREATE TRIGGER catalog_set_translations_set_updated_at
BEFORE UPDATE ON catalog_set_translations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS catalog_theme_translations_set_updated_at ON catalog_theme_translations;
CREATE TRIGGER catalog_theme_translations_set_updated_at
BEFORE UPDATE ON catalog_theme_translations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION sync_catalog_set_de_translation()
RETURNS trigger AS $$
BEGIN
  INSERT INTO catalog_set_translations (
    set_id,
    locale,
    name,
    description,
    seo_title,
    meta_description,
    translation_state,
    is_indexable
  ) VALUES (
    NEW.id,
    'de',
    COALESCE(normalized_translation_text(NEW.name), NEW.set_number),
    normalized_translation_text(NEW.description),
    COALESCE(normalized_translation_text(NEW.name), NEW.set_number),
    LEFT(normalized_translation_text(NEW.description), 160),
    'canonical',
    TRUE
  )
  ON CONFLICT (set_id, locale) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description,
        seo_title = EXCLUDED.seo_title,
        meta_description = EXCLUDED.meta_description,
        is_indexable = EXCLUDED.is_indexable,
        updated_at = NOW()
  WHERE catalog_set_translations.translation_state = 'canonical';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_catalog_theme_de_translation()
RETURNS trigger AS $$
BEGIN
  INSERT INTO catalog_theme_translations (
    theme_id,
    locale,
    name,
    slug,
    intro,
    hero_description,
    meta_description,
    translation_state,
    is_indexable
  ) VALUES (
    NEW.id,
    'de',
    COALESCE(normalized_translation_text(NEW.name), NEW.slug),
    NEW.slug,
    normalized_translation_text(NEW.description),
    normalized_translation_text(NEW.description),
    LEFT(normalized_translation_text(NEW.description), 160),
    'canonical',
    TRUE
  )
  ON CONFLICT (theme_id, locale) DO UPDATE
    SET name = EXCLUDED.name,
        slug = EXCLUDED.slug,
        intro = EXCLUDED.intro,
        hero_description = EXCLUDED.hero_description,
        meta_description = EXCLUDED.meta_description,
        is_indexable = EXCLUDED.is_indexable,
        updated_at = NOW()
  WHERE catalog_theme_translations.translation_state = 'canonical';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS catalog_sets_sync_de_translation_trg ON catalog_sets;
CREATE TRIGGER catalog_sets_sync_de_translation_trg
AFTER INSERT OR UPDATE OF name, description ON catalog_sets
FOR EACH ROW EXECUTE FUNCTION sync_catalog_set_de_translation();

DROP TRIGGER IF EXISTS catalog_themes_sync_de_translation_trg ON catalog_themes;
CREATE TRIGGER catalog_themes_sync_de_translation_trg
AFTER INSERT OR UPDATE OF slug, name, description ON catalog_themes
FOR EACH ROW EXECUTE FUNCTION sync_catalog_theme_de_translation();

INSERT INTO catalog_set_translations (
  set_id,
  locale,
  name,
  description,
  seo_title,
  meta_description,
  translation_state,
  is_indexable
)
SELECT
  s.id,
  'de',
  COALESCE(normalized_translation_text(s.name), s.set_number),
  normalized_translation_text(s.description),
  COALESCE(normalized_translation_text(s.name), s.set_number),
  LEFT(normalized_translation_text(s.description), 160),
  'canonical',
  TRUE
FROM catalog_sets s
ON CONFLICT (set_id, locale) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      seo_title = EXCLUDED.seo_title,
      meta_description = EXCLUDED.meta_description,
      is_indexable = EXCLUDED.is_indexable,
      updated_at = NOW()
WHERE catalog_set_translations.translation_state = 'canonical';

INSERT INTO catalog_theme_translations (
  theme_id,
  locale,
  name,
  slug,
  intro,
  hero_description,
  meta_description,
  translation_state,
  is_indexable
)
SELECT
  t.id,
  'de',
  COALESCE(normalized_translation_text(t.name), t.slug),
  t.slug,
  normalized_translation_text(t.description),
  normalized_translation_text(t.description),
  LEFT(normalized_translation_text(t.description), 160),
  'canonical',
  TRUE
FROM catalog_themes t
ON CONFLICT (theme_id, locale) DO UPDATE
  SET name = EXCLUDED.name,
      slug = EXCLUDED.slug,
      intro = EXCLUDED.intro,
      hero_description = EXCLUDED.hero_description,
      meta_description = EXCLUDED.meta_description,
      is_indexable = EXCLUDED.is_indexable,
      updated_at = NOW()
WHERE catalog_theme_translations.translation_state = 'canonical';

COMMIT;
