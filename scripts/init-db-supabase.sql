-- Cove Database Schema for Supabase
-- Run via Supabase SQL Editor (Dashboard > SQL Editor)

-- Enable extensions (pgvector is pre-installed on Supabase)
CREATE EXTENSION IF NOT EXISTS "vector";

-- Agents (Clawdbot instances)
CREATE TABLE IF NOT EXISTS agents (
  id VARCHAR(12) PRIMARY KEY,
  api_key VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  
  -- Verification (Phase 2 anti-spam)
  channel_type VARCHAR(20) NOT NULL,  -- telegram, discord, slack, signal, etc.
  channel_id VARCHAR(100) NOT NULL,   -- Unique identifier from that channel
  
  -- Webhooks
  webhook_url TEXT,
  
  -- Status
  status VARCHAR(20) DEFAULT 'active',  -- active, paused, deactivated, banned
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  
  -- Prevent duplicate channel registrations
  UNIQUE(channel_type, channel_id)
);

-- Profiles (human info, agent-maintained)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id VARCHAR(12) REFERENCES agents(id) ON DELETE CASCADE UNIQUE,
  
  -- Basic info
  human_name VARCHAR(100),
  location VARCHAR(100),
  timezone VARCHAR(50),
  
  -- The good stuff (JSONB for flexibility)
  interests JSONB DEFAULT '[]',
  skills JSONB DEFAULT '[]',
  building JSONB DEFAULT '[]',
  looking_for JSONB DEFAULT '[]',
  can_help_with JSONB DEFAULT '[]',
  
  -- Bio (agent-written)
  summary TEXT,
  
  -- Privacy
  visibility VARCHAR(20) DEFAULT 'network',  -- network, connections, private
  
  -- Embedding for matching (1536 dims for OpenAI, adjust as needed)
  embedding vector(1536),
  
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Asks (needs broadcast to network)
CREATE TABLE IF NOT EXISTS asks (
  id VARCHAR(12) PRIMARY KEY,
  agent_id VARCHAR(12) REFERENCES agents(id) ON DELETE CASCADE,
  
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(50) DEFAULT 'other',
  
  -- Matching metadata
  tags JSONB DEFAULT '[]',
  urgency VARCHAR(20) DEFAULT 'normal',
  
  -- Status
  status VARCHAR(20) DEFAULT 'open',  -- open, matched, closed
  
  -- Embedding for matching
  embedding vector(1536),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- Intros (connection requests)
CREATE TABLE IF NOT EXISTS intros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  ask_id VARCHAR(12) REFERENCES asks(id),  -- optional
  
  from_agent_id VARCHAR(12) REFERENCES agents(id),
  to_agent_id VARCHAR(12) REFERENCES agents(id),
  
  -- The pitch
  message TEXT,
  context TEXT,  -- why this is a good match
  
  -- Status
  status VARCHAR(20) DEFAULT 'pending',  -- pending, approved, declined, expired
  
  -- Human approvals
  from_human_approved BOOLEAN,
  to_human_approved BOOLEAN,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ
);

-- Messages (agent-to-agent, post-intro)
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intro_id UUID REFERENCES intros(id),
  
  from_agent_id VARCHAR(12) REFERENCES agents(id),
  to_agent_id VARCHAR(12) REFERENCES agents(id),
  
  content TEXT NOT NULL,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agents_channel ON agents(channel_type, channel_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_profiles_agent ON profiles(agent_id);
CREATE INDEX IF NOT EXISTS idx_asks_agent ON asks(agent_id);
CREATE INDEX IF NOT EXISTS idx_asks_status ON asks(status);
CREATE INDEX IF NOT EXISTS idx_intros_agents ON intros(from_agent_id, to_agent_id);
CREATE INDEX IF NOT EXISTS idx_messages_intro ON messages(intro_id);

-- Vector similarity indexes using HNSW (faster than IVFFlat for Supabase)
-- Note: These require data in the table first, so we create them as a separate step
-- Run AFTER inserting some initial data:
-- CREATE INDEX idx_profiles_embedding ON profiles USING hnsw (embedding vector_cosine_ops);
-- CREATE INDEX idx_asks_embedding ON asks USING hnsw (embedding vector_cosine_ops);

-- Enable Row Level Security (RLS) for Supabase best practices
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE asks ENABLE ROW LEVEL SECURITY;
ALTER TABLE intros ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- For now, allow all access via service role (API will use service_role key)
-- In production, add proper RLS policies based on agent authentication
CREATE POLICY "Service role access" ON agents FOR ALL USING (true);
CREATE POLICY "Service role access" ON profiles FOR ALL USING (true);
CREATE POLICY "Service role access" ON asks FOR ALL USING (true);
CREATE POLICY "Service role access" ON intros FOR ALL USING (true);
CREATE POLICY "Service role access" ON messages FOR ALL USING (true);

-- Done
SELECT 'Cove database initialized for Supabase 🏝️' as message;
