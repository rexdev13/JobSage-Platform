-- Migrate preferred_region column from scalar text to text[]
-- Existing non-null values are wrapped in a one-element array.
-- This migration was applied to the running database via direct SQL on 2026-07-22.
ALTER TABLE profiles
  ALTER COLUMN preferred_region
    TYPE text[]
    USING CASE
      WHEN preferred_region IS NULL THEN NULL
      ELSE ARRAY[preferred_region]
    END;
