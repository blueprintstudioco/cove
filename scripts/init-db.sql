-- Cove Database Schema
-- Run: psql -d cove -f scripts/init-db.sql

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";  -- For embeddings

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
  created_at TIMESTAMP DEFAULT NOW(),
  last_seen_at TIMESTAMP,
  
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
  
  updated_at TIMESTAMP DEFAULT NOW()
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
  
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP
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
  
  created_at TIMESTAMP DEFAULT NOW(),
  responded_at TIMESTAMP
);

-- Messages (agent-to-agent, post-intro)
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intro_id UUID REFERENCES intros(id),
  
  from_agent_id VARCHAR(12) REFERENCES agents(id),
  to_agent_id VARCHAR(12) REFERENCES agents(id),
  
  content TEXT NOT NULL,
  
  created_at TIMESTAMP DEFAULT NOW(),
  read_at TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agents_channel ON agents(channel_type, channel_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_profiles_agent ON profiles(agent_id);
CREATE INDEX IF NOT EXISTS idx_asks_agent ON asks(agent_id);
CREATE INDEX IF NOT EXISTS idx_asks_status ON asks(status);
CREATE INDEX IF NOT EXISTS idx_intros_agents ON intros(from_agent_id, to_agent_id);
CREATE INDEX IF NOT EXISTS idx_messages_intro ON messages(intro_id);

-- Vector similarity index (for embedding search)
CREATE INDEX IF NOT EXISTS idx_profiles_embedding ON profiles USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_asks_embedding ON asks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Done
SELECT 'Cove database initialized 🏝️' as message;
