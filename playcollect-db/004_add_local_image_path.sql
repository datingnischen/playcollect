BEGIN;

ALTER TABLE catalog_set_images
ADD COLUMN IF NOT EXISTS local_image_path TEXT;

CREATE INDEX IF NOT EXISTS catalog_set_images_local_image_path_idx
  ON catalog_set_images (local_image_path);

COMMIT;
