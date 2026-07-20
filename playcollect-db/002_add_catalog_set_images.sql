BEGIN;

CREATE TABLE IF NOT EXISTS catalog_set_images (
  id              BIGSERIAL PRIMARY KEY,
  set_id          BIGINT NOT NULL REFERENCES catalog_sets(id) ON DELETE CASCADE,
  image_url       TEXT NOT NULL,
  source_page_url TEXT,
  alt_text        TEXT,
  image_kind      TEXT NOT NULL DEFAULT 'product',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalog_set_images_kind_chk CHECK (image_kind IN ('product', 'box_front', 'box_back', 'detail', 'extra', 'other')),
  CONSTRAINT catalog_set_images_sort_order_chk CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS catalog_set_images_set_url_uidx
  ON catalog_set_images (set_id, image_url);

CREATE INDEX IF NOT EXISTS catalog_set_images_set_id_idx
  ON catalog_set_images (set_id);

DROP TRIGGER IF EXISTS catalog_set_images_set_updated_at ON catalog_set_images;
CREATE TRIGGER catalog_set_images_set_updated_at
BEFORE UPDATE ON catalog_set_images
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
