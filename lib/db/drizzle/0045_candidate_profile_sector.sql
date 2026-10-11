ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sector text;
--> statement-breakpoint
UPDATE profiles
SET sector = CASE lower(btrim(profession))
  WHEN 'doctor' THEN 'healthcare'
  WHEN 'nurse' THEN 'healthcare'
  WHEN 'allied_health_professional' THEN 'healthcare'
  WHEN 'it professional' THEN 'it'
END
WHERE sector IS NULL
  AND lower(btrim(profession)) IN (
    'doctor',
    'nurse',
    'allied_health_professional',
    'it professional'
  );
