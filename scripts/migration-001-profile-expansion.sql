-- Migration: Expand profile for human connections
-- Run in Supabase SQL Editor

-- Add new profile fields
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS hobbies JSONB DEFAULT '[]';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS life_context JSONB DEFAULT '[]';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS region VARCHAR(100);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS currently_learning JSONB DEFAULT '[]';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS favorite_content JSONB DEFAULT '[]';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS background JSONB DEFAULT '[]';

-- Add comments for clarity
COMMENT ON COLUMN profiles.hobbies IS 'Personal interests: gaming, fishing, woodworking, etc.';
COMMENT ON COLUMN profiles.life_context IS 'Life stage tags: new_parent, pet_owner, veteran, remote_worker, etc.';
COMMENT ON COLUMN profiles.region IS 'Geographic region or "Remote"';
COMMENT ON COLUMN profiles.currently_learning IS 'What they are learning: languages, skills, etc.';
COMMENT ON COLUMN profiles.favorite_content IS 'Podcasts, books, creators they love';
COMMENT ON COLUMN profiles.background IS 'Career background: ex_military, former_teacher, career_changer, etc.';

SELECT 'Profile schema expanded 🏝️' as message;
