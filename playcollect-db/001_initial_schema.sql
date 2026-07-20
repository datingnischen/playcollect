-- Playcollect initial database schema
-- Scope: global catalog, user accounts, and user collections referencing the catalog

BEGIN;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS catalog_themes (
  id            BIGSERIAL PRIMARY KEY,
  parent_id     BIGINT REFERENCES catalog_themes(id) ON DELETE SET NULL,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS catalog_sets (
  id                BIGSERIAL PRIMARY KEY,
  set_number        TEXT NOT NULL UNIQUE,
  slug              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  release_year      INTEGER,
  retire_year       INTEGER,
  theme_id          BIGINT REFERENCES catalog_themes(id) ON DELETE SET NULL,
  category_label    TEXT,
  description       TEXT,
  age_min           INTEGER,
  age_max           INTEGER,
  piece_count       INTEGER,
  figure_count      INTEGER,
  box_variant_hint  TEXT,
  is_vintage        BOOLEAN NOT NULL DEFAULT FALSE,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalog_sets_release_year_chk CHECK (release_year IS NULL OR release_year BETWEEN 1974 AND 2100),
  CONSTRAINT catalog_sets_retire_year_chk CHECK (retire_year IS NULL OR retire_year BETWEEN 1974 AND 2100),
  CONSTRAINT catalog_sets_year_order_chk CHECK (retire_year IS NULL OR release_year IS NULL OR retire_year >= release_year),
  CONSTRAINT catalog_sets_age_min_chk CHECK (age_min IS NULL OR age_min >= 0),
  CONSTRAINT catalog_sets_age_max_chk CHECK (age_max IS NULL OR age_max >= 0),
  CONSTRAINT catalog_sets_age_order_chk CHECK (age_max IS NULL OR age_min IS NULL OR age_max >= age_min),
  CONSTRAINT catalog_sets_piece_count_chk CHECK (piece_count IS NULL OR piece_count >= 0),
  CONSTRAINT catalog_sets_figure_count_chk CHECK (figure_count IS NULL OR figure_count >= 0)
);

CREATE TABLE IF NOT EXISTS catalog_set_variants (
  id              BIGSERIAL PRIMARY KEY,
  set_id          BIGINT NOT NULL REFERENCES catalog_sets(id) ON DELETE CASCADE,
  variant_key     TEXT NOT NULL,
  variant_name    TEXT NOT NULL,
  release_year    INTEGER,
  retire_year     INTEGER,
  description     TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalog_set_variants_set_variant_unique UNIQUE (set_id, variant_key),
  CONSTRAINT catalog_set_variants_release_year_chk CHECK (release_year IS NULL OR release_year BETWEEN 1974 AND 2100),
  CONSTRAINT catalog_set_variants_retire_year_chk CHECK (retire_year IS NULL OR retire_year BETWEEN 1974 AND 2100),
  CONSTRAINT catalog_set_variants_year_order_chk CHECK (retire_year IS NULL OR release_year IS NULL OR retire_year >= release_year)
);

CREATE TABLE IF NOT EXISTS catalog_accessories (
  id                 BIGSERIAL PRIMARY KEY,
  set_id             BIGINT NOT NULL REFERENCES catalog_sets(id) ON DELETE CASCADE,
  accessory_code     TEXT,
  name               TEXT NOT NULL,
  quantity_default   INTEGER,
  description        TEXT,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalog_accessories_quantity_chk CHECK (quantity_default IS NULL OR quantity_default >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS catalog_accessories_unique_code_per_set_idx
  ON catalog_accessories (set_id, accessory_code)
  WHERE accessory_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_users (
  id                 BIGSERIAL PRIMARY KEY,
  email              TEXT NOT NULL,
  username           TEXT NOT NULL,
  password_hash      TEXT NOT NULL,
  display_name       TEXT,
  role_name          TEXT NOT NULL DEFAULT 'user',
  account_status     TEXT NOT NULL DEFAULT 'active',
  locale             TEXT NOT NULL DEFAULT 'de',
  marketing_opt_in   BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at  TIMESTAMPTZ,
  last_login_at      TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT app_users_role_name_chk CHECK (role_name IN ('user', 'moderator', 'admin')),
  CONSTRAINT app_users_account_status_chk CHECK (account_status IN ('pending', 'active', 'suspended', 'deleted'))
);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_lower_uidx
  ON app_users (LOWER(email));

CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_lower_uidx
  ON app_users (LOWER(username));

CREATE TABLE IF NOT EXISTS user_collections (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  slug             TEXT NOT NULL,
  name             TEXT NOT NULL,
  collection_type  TEXT NOT NULL DEFAULT 'custom',
  is_default       BOOLEAN NOT NULL DEFAULT FALSE,
  description      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_collections_type_chk CHECK (collection_type IN ('owned', 'wishlist', 'missing', 'custom')),
  CONSTRAINT user_collections_user_slug_unique UNIQUE (user_id, slug)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_collections_default_type_uidx
  ON user_collections (user_id, collection_type)
  WHERE is_default = TRUE;

CREATE TABLE IF NOT EXISTS user_collection_items (
  id                    BIGSERIAL PRIMARY KEY,
  collection_id         BIGINT NOT NULL REFERENCES user_collections(id) ON DELETE CASCADE,
  set_id                BIGINT NOT NULL REFERENCES catalog_sets(id) ON DELETE CASCADE,
  variant_id            BIGINT REFERENCES catalog_set_variants(id) ON DELETE SET NULL,
  quantity              INTEGER NOT NULL DEFAULT 1,
  completeness_percent  NUMERIC(5,2),
  item_condition        TEXT,
  purchase_price_cents  INTEGER,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_collection_items_quantity_chk CHECK (quantity >= 1),
  CONSTRAINT user_collection_items_completeness_chk CHECK (completeness_percent IS NULL OR (completeness_percent >= 0 AND completeness_percent <= 100)),
  CONSTRAINT user_collection_items_purchase_price_chk CHECK (purchase_price_cents IS NULL OR purchase_price_cents >= 0),
  CONSTRAINT user_collection_items_condition_chk CHECK (item_condition IS NULL OR item_condition IN ('sealed', 'mint', 'very_good', 'good', 'used', 'incomplete', 'damaged'))
);

CREATE UNIQUE INDEX IF NOT EXISTS user_collection_items_unique_idx
  ON user_collection_items (collection_id, set_id, COALESCE(variant_id, 0));

CREATE INDEX IF NOT EXISTS catalog_sets_theme_id_idx ON catalog_sets (theme_id);
CREATE INDEX IF NOT EXISTS catalog_sets_release_year_idx ON catalog_sets (release_year);
CREATE INDEX IF NOT EXISTS catalog_sets_is_vintage_idx ON catalog_sets (is_vintage);
CREATE INDEX IF NOT EXISTS catalog_set_variants_set_id_idx ON catalog_set_variants (set_id);
CREATE INDEX IF NOT EXISTS catalog_accessories_set_id_idx ON catalog_accessories (set_id);
CREATE INDEX IF NOT EXISTS user_collections_user_id_idx ON user_collections (user_id);
CREATE INDEX IF NOT EXISTS user_collection_items_set_id_idx ON user_collection_items (set_id);
CREATE INDEX IF NOT EXISTS user_collection_items_collection_id_idx ON user_collection_items (collection_id);

DROP TRIGGER IF EXISTS catalog_themes_set_updated_at ON catalog_themes;
CREATE TRIGGER catalog_themes_set_updated_at
BEFORE UPDATE ON catalog_themes
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS catalog_sets_set_updated_at ON catalog_sets;
CREATE TRIGGER catalog_sets_set_updated_at
BEFORE UPDATE ON catalog_sets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS catalog_set_variants_set_updated_at ON catalog_set_variants;
CREATE TRIGGER catalog_set_variants_set_updated_at
BEFORE UPDATE ON catalog_set_variants
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS catalog_accessories_set_updated_at ON catalog_accessories;
CREATE TRIGGER catalog_accessories_set_updated_at
BEFORE UPDATE ON catalog_accessories
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS app_users_set_updated_at ON app_users;
CREATE TRIGGER app_users_set_updated_at
BEFORE UPDATE ON app_users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS user_collections_set_updated_at ON user_collections;
CREATE TRIGGER user_collections_set_updated_at
BEFORE UPDATE ON user_collections
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS user_collection_items_set_updated_at ON user_collection_items;
CREATE TRIGGER user_collection_items_set_updated_at
BEFORE UPDATE ON user_collection_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
