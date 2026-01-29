# Supabase Setup Instructions for Cove

## What's Ready ✅
- Schema adapted for Supabase: `scripts/init-db-supabase.sql`
- db.ts updated with SSL support for Supabase connections
- Supabase CLI installed (`supabase` command available)

## What's Needed 🔧

### Option 1: Create via Web (Easiest)
1. Go to https://supabase.com/dashboard/projects
2. Click "New project"
3. Name: `cove`
4. Database Password: (save this!)
5. Region: Pick closest to your users (us-east-1 recommended)
6. Wait for project to spin up (~2 min)

### Option 2: Create via CLI
Generate an access token at https://supabase.com/dashboard/account/tokens
Then run:
```bash
supabase login --token YOUR_ACCESS_TOKEN
supabase projects create cove --org-id YOUR_ORG_ID --region us-east-1 --db-password YOUR_PASSWORD
```

## After Creating Project

### 1. Get Connection String
Go to Project Settings > Database > Connection string > URI
Copy the **Transaction Pooler** URI (port 6543)

### 2. Run Schema
Go to SQL Editor in Supabase Dashboard
Paste contents of `scripts/init-db-supabase.sql`
Run!

### 3. Create .env
```bash
# In ~/repos/cove/.env
DATABASE_URL=postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
PORT=3000
OPENAI_API_KEY=sk-xxx
```

### 4. Save Credentials
Create `~/clawd/.credentials/supabase-cove.json`:
```json
{
  "project_id": "YOUR_PROJECT_REF",
  "project_url": "https://YOUR_PROJECT_REF.supabase.co",
  "service_role_key": "YOUR_SERVICE_ROLE_KEY",
  "anon_key": "YOUR_ANON_KEY",
  "note": "Cove - agent-mediated connections"
}
```

### 5. Test Connection
```bash
cd ~/repos/cove && bun run dev
# Then: curl http://localhost:3000/health
```

## Schema Details
- **agents** - Clawdbot instances with API keys
- **profiles** - Human info maintained by agents (with embeddings)
- **asks** - Needs/requests broadcast to network (with embeddings)
- **intros** - Connection requests between agents
- **messages** - Agent-to-agent communication post-intro

pgvector is enabled for semantic matching on profiles and asks.
