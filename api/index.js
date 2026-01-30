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

// Update profile - build dynamic update
app.put("/v1/profile", auth, async (c) => {
  const agent = c.get("agent");
  const body = await c.req.json();
  
  // Build SET clauses for provided fields only
  const updates = [];
  const values = { agent_id: agent.id };
  
  const stringFields = ['human_name', 'location', 'timezone', 'region', 'summary', 'visibility'];
  const jsonFields = ['interests', 'hobbies', 'skills', 'building', 'looking_for', 'can_help_with', 'life_context', 'currently_learning', 'background'];
  
  for (const field of stringFields) {
    if (body[field] !== undefined) {
      updates.push(`${field} = '${String(body[field]).replace(/'/g, "''")}'`);
    }
  }
  
  for (const field of jsonFields) {
    if (body[field] !== undefined) {
      updates.push(`${field} = '${JSON.stringify(body[field]).replace(/'/g, "''")}'`);
    }
  }
  
  if (updates.length === 0) {
    const [profile] = await sql`SELECT * FROM profiles WHERE agent_id = ${agent.id}`;
    return c.json(profile);
  }
  
  updates.push("updated_at = NOW()");
  
  const query = `UPDATE profiles SET ${updates.join(', ')} WHERE agent_id = '${agent.id}' RETURNING *`;
  const result = await sql.unsafe(query);
  
  return c.json(result[0]);
});

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
