-- Make phone nullable on social_leads so AI-chat leads can be saved
-- before the user has provided their phone number.
ALTER TABLE "social_leads" ALTER COLUMN "phone" DROP NOT NULL;
