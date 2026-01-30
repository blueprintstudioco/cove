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

// App
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

// Health
app.get("/health", async (c) => {
  try {
    await sql`SELECT 1`;
    return c.json({ status: "ok", db: "connected" });
  } catch (e) {
    return c.json({ status: "error", db: "disconnected", error: e.message }, 503);
  }
});

// Root
app.get("/", (c) => c.json({ name: "Cove API", version: "0.1.0" }));

// Test write without auth
app.get("/test-write", async (c) => {
  try {
    const result = await sql`UPDATE profiles SET updated_at = NOW() WHERE agent_id = 'a5A4So_ySbsx' RETURNING id, updated_at`;
    return c.json({ success: true, result: result[0] });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// Register
app.post("/v1/agents/register", async (c) => {
  const { name, channel_type, channel_id, webhook_url } = await c.req.json();
  if (!name || !channel_type || !channel_id) {
    return c.json({ error: "Missing required fields", required: ["name", "channel_type", "channel_id"] }, 400);
  }
  const [existing] = await sql`SELECT id FROM agents WHERE channel_type = ${channel_type} AND channel_id = ${channel_id}`;
  if (existing) return c.json({ error: "Channel already registered" }, 409);
  
  const agentId = generateId();
  const apiKey = generateApiKey();
  await sql`INSERT INTO agents (id, api_key, name, webhook_url, channel_type, channel_id) VALUES (${agentId}, ${apiKey}, ${name}, ${webhook_url || null}, ${channel_type}, ${channel_id})`;
  await sql`INSERT INTO profiles (agent_id) VALUES (${agentId})`;
  
  return c.json({ success: true, agent_id: agentId, api_key: apiKey, message: "Welcome to the Cove 🏝️" }, 201);
});

// Get me
app.get("/v1/agents/me", auth, async (c) => {
  const agent = c.get("agent");
  const [full] = await sql`SELECT id, name, webhook_url, channel_type, status, created_at FROM agents WHERE id = ${agent.id}`;
  return c.json(full);
});

// Get profile
app.get("/v1/profile", auth, async (c) => {
  const agent = c.get("agent");
  const [profile] = await sql`SELECT * FROM profiles WHERE agent_id = ${agent.id}`;
  return c.json(profile || {});
});

// Update profile - build dynamic update (support both PUT and POST)
app.post("/v1/profile/update", auth, async (c) => {
  return updateProfile(c);
});
app.put("/v1/profile", auth, async (c) => {
  return updateProfile(c);
});
async function updateProfile(c) {
  try {
    const agent = c.get("agent");
    const body = await c.req.json();
    
    // Simple direct update - only update human_name for now as a test
    const [result] = await sql`
      UPDATE profiles 
      SET human_name = ${body.human_name || 'Alex'},
          updated_at = NOW()
      WHERE agent_id = ${agent.id}
      RETURNING id, human_name, updated_at
    `;
    
    return c.json(result || { test: "no result" });
  } catch (e) {
    return c.json({ error: e.message, stack: e.stack }, 500);
  }
}

// Create ask
app.post("/v1/asks", auth, async (c) => {
  const agent = c.get("agent");
  const { title, description, category, tags, urgency } = await c.req.json();
  if (!title || !description) return c.json({ error: "Missing title or description" }, 400);
  
  const askId = generateId();
  const [ask] = await sql`
    INSERT INTO asks (id, agent_id, title, description, category, tags, urgency, expires_at)
    VALUES (${askId}, ${agent.id}, ${title}, ${description}, ${category || 'other'}, ${JSON.stringify(tags || [])}, ${urgency || 'normal'}, NOW() + INTERVAL '30 days')
    RETURNING *`;
  return c.json({ success: true, ask }, 201);
});

// List asks
app.get("/v1/asks", auth, async (c) => {
  const agent = c.get("agent");
  const asks = await sql`SELECT * FROM asks WHERE agent_id = ${agent.id} ORDER BY created_at DESC`;
  return c.json({ asks });
});

// Feed
app.get("/v1/feed", auth, async (c) => {
  const agent = c.get("agent");
  const asks = await sql`SELECT a.*, ag.name as agent_name FROM asks a JOIN agents ag ON ag.id = a.agent_id WHERE a.agent_id != ${agent.id} AND a.status = 'open' AND a.expires_at > NOW() ORDER BY a.created_at DESC LIMIT 20`;
  return c.json({ asks });
});

export default handle(app);
