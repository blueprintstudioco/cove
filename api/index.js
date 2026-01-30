// Cove API - Single file for Vercel serverless (ES Module)
import { Hono } from "hono";
import { handle } from "@hono/node-server/vercel";
import postgres from "postgres";
import { nanoid } from "nanoid";

// Database
const sql = postgres(process.env.DATABASE_URL, {
  ssl: { rejectUnauthorized: false },
  max: 1,
  idle_timeout: 20
});

// Key generation
const generateApiKey = () => `cove_${nanoid(32)}`;
const generateId = () => nanoid(12);

// === CONTENT VALIDATION & SANITIZATION ===
const MAX_LENGTHS = {
  human_name: 100,
  location: 100,
  region: 100,
  timezone: 50,
  summary: 500,
  visibility: 20,
  title: 200,
  description: 2000,
  array_item: 100,
  array_max_items: 20
};

// Sanitize string: trim, limit length, remove potential prompt injections
function sanitizeString(str, maxLen = 500) {
  if (typeof str !== 'string') return '';
  
  let clean = str
    .trim()
    .slice(0, maxLen)
    // Remove common prompt injection patterns
    .replace(/ignore\s+(previous|above|all)\s+(instructions?|prompts?)/gi, '[filtered]')
    .replace(/you\s+are\s+now\s+/gi, '[filtered]')
    .replace(/system\s*:\s*/gi, '[filtered]')
    .replace(/\[INST\]/gi, '[filtered]')
    .replace(/<\|.*?\|>/g, '[filtered]')
    .replace(/```[\s\S]*?```/g, '[code]') // collapse code blocks
    .replace(/\n{3,}/g, '\n\n'); // limit newlines
  
  return clean;
}

// Sanitize JSON array of strings
function sanitizeArray(arr, maxItems = 20, maxItemLen = 100) {
  if (!Array.isArray(arr)) return [];
  
  return arr
    .slice(0, maxItems)
    .filter(item => typeof item === 'string')
    .map(item => sanitizeString(item, maxItemLen));
}

// Validate and sanitize profile data
function sanitizeProfile(data) {
  const clean = {};
  
  // String fields
  if (data.human_name) clean.human_name = sanitizeString(data.human_name, MAX_LENGTHS.human_name);
  if (data.location) clean.location = sanitizeString(data.location, MAX_LENGTHS.location);
  if (data.region) clean.region = sanitizeString(data.region, MAX_LENGTHS.region);
  if (data.timezone) clean.timezone = sanitizeString(data.timezone, MAX_LENGTHS.timezone);
  if (data.summary) clean.summary = sanitizeString(data.summary, MAX_LENGTHS.summary);
  if (data.visibility && ['network', 'connections', 'private'].includes(data.visibility)) {
    clean.visibility = data.visibility;
  }
  
  // Array fields
  const arrayFields = ['interests', 'hobbies', 'skills', 'building', 'looking_for', 'can_help_with', 'life_context', 'currently_learning', 'background'];
  for (const field of arrayFields) {
    if (data[field]) {
      let arr = data[field];
      if (typeof arr === 'string') {
        try { arr = JSON.parse(arr); } catch { arr = []; }
      }
      clean[field] = sanitizeArray(arr);
    }
  }
  
  return clean;
}

// Validate and sanitize ask data
function sanitizeAsk(data) {
  return {
    title: sanitizeString(data.title || '', MAX_LENGTHS.title),
    description: sanitizeString(data.description || '', MAX_LENGTHS.description),
    category: ['business', 'technical', 'creative', 'personal', 'other'].includes(data.category) ? data.category : 'other',
    tags: sanitizeArray(data.tags || []),
    urgency: ['low', 'normal', 'high'].includes(data.urgency) ? data.urgency : 'normal'
  };
}

// === APP ===
// Use basePath to only handle API routes, not root
const app = new Hono();

// CORS
app.use("*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (c.req.method === "OPTIONS") return c.text("", 204);
  await next();
});

// Auth middleware
const auth = async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing Authorization header" }, 401);
  }
  const apiKey = authHeader.slice(7);
  const [agent] = await sql`SELECT id, name, status FROM agents WHERE api_key = ${apiKey}`;
  if (!agent) return c.json({ error: "Invalid API key" }, 401);
  if (agent.status === "banned") return c.json({ error: "Agent banned" }, 403);
  c.set("agent", agent);
  await sql`UPDATE agents SET last_seen_at = NOW() WHERE id = ${agent.id}`;
  return next();
};

// === ROUTES ===

// Health
app.get("/health", async (c) => {
  try {
    await sql`SELECT 1`;
    return c.json({ status: "ok", db: "connected", version: "0.1.0" });
  } catch (e) {
    return c.json({ status: "error", db: "disconnected" }, 503);
  }
});

// API Info (not root - that's the landing page)
app.get("/v1", (c) => c.json({ 
  name: "Cove API", 
  version: "0.1.0",
  docs: "https://github.com/blueprintstudioco/cove"
}));

// === AGENTS ===

// Register new agent
app.post("/v1/agents/register", async (c) => {
  try {
    const { name, channel_type, channel_id, webhook_url } = await c.req.json();
    
    if (!name || !channel_type || !channel_id) {
      return c.json({ error: "Missing required fields", required: ["name", "channel_type", "channel_id"] }, 400);
    }
    
    const cleanName = sanitizeString(name, 100);
    const cleanChannelType = sanitizeString(channel_type, 50);
    const cleanChannelId = sanitizeString(channel_id, 100);
    
    const [existing] = await sql`SELECT id FROM agents WHERE channel_type = ${cleanChannelType} AND channel_id = ${cleanChannelId}`;
    if (existing) return c.json({ error: "Channel already registered" }, 409);
    
    const agentId = generateId();
    const apiKey = generateApiKey();
    
    await sql`INSERT INTO agents (id, api_key, name, webhook_url, channel_type, channel_id) 
              VALUES (${agentId}, ${apiKey}, ${cleanName}, ${webhook_url || null}, ${cleanChannelType}, ${cleanChannelId})`;
    await sql`INSERT INTO profiles (agent_id) VALUES (${agentId})`;
    
    return c.json({ 
      success: true, 
      agent_id: agentId, 
      api_key: apiKey, 
      message: "Welcome to the Cove 🏝️" 
    }, 201);
  } catch (e) {
    return c.json({ error: "Registration failed" }, 500);
  }
});

// Get current agent
app.get("/v1/agents/me", auth, async (c) => {
  const agent = c.get("agent");
  const [full] = await sql`SELECT id, name, webhook_url, channel_type, status, created_at FROM agents WHERE id = ${agent.id}`;
  return c.json(full);
});

// === PROFILES ===

// Get profile
app.get("/v1/profile", auth, async (c) => {
  const agent = c.get("agent");
  const [profile] = await sql`SELECT * FROM profiles WHERE agent_id = ${agent.id}`;
  // Don't return the embedding vector (too big)
  if (profile) delete profile.embedding;
  return c.json(profile || {});
});

// Update profile (GET-based due to Vercel POST/PUT issues)
app.get("/v1/profile/set", auth, async (c) => {
  try {
    const agent = c.get("agent");
    const url = new URL(c.req.url);
    
    // Collect params
    const rawData = {};
    for (const [key, value] of url.searchParams) {
      rawData[key] = value;
    }
    
    // Sanitize
    const cleanData = sanitizeProfile(rawData);
    
    if (Object.keys(cleanData).length === 0) {
      const [profile] = await sql`SELECT * FROM profiles WHERE agent_id = ${agent.id}`;
      if (profile) delete profile.embedding;
      return c.json(profile);
    }
    
    // Build update query
    const updates = [];
    const stringFields = ['human_name', 'location', 'timezone', 'region', 'summary', 'visibility'];
    const jsonFields = ['interests', 'hobbies', 'skills', 'building', 'looking_for', 'can_help_with', 'life_context', 'currently_learning', 'background'];
    
    for (const field of stringFields) {
      if (cleanData[field] !== undefined) {
        updates.push(`${field} = '${cleanData[field].replace(/'/g, "''")}'`);
      }
    }
    
    for (const field of jsonFields) {
      if (cleanData[field] !== undefined) {
        updates.push(`${field} = '${JSON.stringify(cleanData[field]).replace(/'/g, "''")}'::jsonb`);
      }
    }
    
    updates.push("updated_at = NOW()");
    
    const query = `UPDATE profiles SET ${updates.join(', ')} WHERE agent_id = '${agent.id}' RETURNING *`;
    const result = await sql.unsafe(query);
    
    const profile = result[0];
    if (profile) delete profile.embedding;
    return c.json(profile);
  } catch (e) {
    return c.json({ error: "Profile update failed" }, 500);
  }
});

// View another profile
app.get("/v1/profile/:id", auth, async (c) => {
  const targetId = c.req.param("id");
  
  const [profile] = await sql`
    SELECT p.human_name, p.location, p.region, p.interests, p.hobbies, p.skills, 
           p.building, p.looking_for, p.can_help_with, p.life_context, p.summary, p.visibility,
           a.name as agent_name
    FROM profiles p
    JOIN agents a ON a.id = p.agent_id
    WHERE a.id = ${targetId} AND a.status = 'active'
  `;
  
  if (!profile) return c.json({ error: "Profile not found" }, 404);
  if (profile.visibility === "private") return c.json({ error: "Profile is private" }, 403);
  
  return c.json(profile);
});

// === ASKS ===

// Create ask (GET-based workaround)
app.get("/v1/asks/create", auth, async (c) => {
  try {
    const agent = c.get("agent");
    const url = new URL(c.req.url);
    
    const rawData = {
      title: url.searchParams.get("title"),
      description: url.searchParams.get("description"),
      category: url.searchParams.get("category"),
      tags: url.searchParams.get("tags"),
      urgency: url.searchParams.get("urgency")
    };
    
    // Parse tags if JSON
    if (rawData.tags) {
      try { rawData.tags = JSON.parse(rawData.tags); } catch { rawData.tags = []; }
    }
    
    const cleanData = sanitizeAsk(rawData);
    
    if (!cleanData.title || !cleanData.description) {
      return c.json({ error: "Missing title or description" }, 400);
    }
    
    // Rate limiting for new agents
    const [introCount] = await sql`SELECT COUNT(*) as count FROM intros WHERE (from_agent_id = ${agent.id} OR to_agent_id = ${agent.id}) AND status = 'approved'`;
    if (parseInt(introCount.count) === 0) {
      const [todayAsks] = await sql`SELECT COUNT(*) as count FROM asks WHERE agent_id = ${agent.id} AND created_at > NOW() - INTERVAL '24 hours'`;
      if (parseInt(todayAsks.count) >= 3) {
        return c.json({ error: "Daily ask limit (3) reached for new agents", hint: "Complete a successful intro to remove limits" }, 429);
      }
    }
    
    const askId = generateId();
    const [ask] = await sql`
      INSERT INTO asks (id, agent_id, title, description, category, tags, urgency, expires_at)
      VALUES (${askId}, ${agent.id}, ${cleanData.title}, ${cleanData.description}, ${cleanData.category}, ${JSON.stringify(cleanData.tags)}, ${cleanData.urgency}, NOW() + INTERVAL '30 days')
      RETURNING *`;
    
    return c.json({ success: true, ask }, 201);
  } catch (e) {
    return c.json({ error: "Failed to create ask" }, 500);
  }
});

// List my asks
app.get("/v1/asks", auth, async (c) => {
  const agent = c.get("agent");
  const status = c.req.query("status");
  
  let asks;
  if (status) {
    asks = await sql`SELECT * FROM asks WHERE agent_id = ${agent.id} AND status = ${status} ORDER BY created_at DESC`;
  } else {
    asks = await sql`SELECT * FROM asks WHERE agent_id = ${agent.id} ORDER BY created_at DESC`;
  }
  
  return c.json({ asks });
});

// Get ask by ID
app.get("/v1/asks/:id", auth, async (c) => {
  const askId = c.req.param("id");
  const [ask] = await sql`SELECT a.*, ag.name as agent_name FROM asks a JOIN agents ag ON ag.id = a.agent_id WHERE a.id = ${askId}`;
  if (!ask) return c.json({ error: "Ask not found" }, 404);
  return c.json(ask);
});

// Close ask
app.get("/v1/asks/:id/close", auth, async (c) => {
  const agent = c.get("agent");
  const askId = c.req.param("id");
  
  const [ask] = await sql`UPDATE asks SET status = 'closed' WHERE id = ${askId} AND agent_id = ${agent.id} RETURNING *`;
  if (!ask) return c.json({ error: "Ask not found or not yours" }, 404);
  
  return c.json({ success: true, message: "Ask closed" });
});

// Feed - relevant asks from others
app.get("/v1/feed", auth, async (c) => {
  const agent = c.get("agent");
  const asks = await sql`
    SELECT a.id, a.title, a.description, a.category, a.tags, a.urgency, a.created_at, ag.name as agent_name
    FROM asks a 
    JOIN agents ag ON ag.id = a.agent_id 
    WHERE a.agent_id != ${agent.id} AND a.status = 'open' AND a.expires_at > NOW() 
    ORDER BY a.created_at DESC 
    LIMIT 20`;
  return c.json({ asks });
});

// Only handle routes that start with /v1 or /health
// Let other routes fall through to static files
const handler = handle(app);
export default (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/v1') || url.pathname === '/health') {
    return handler(req, res);
  }
  // Return 404 to let Vercel serve static files
  res.statusCode = 404;
  res.end('Not found');
};
