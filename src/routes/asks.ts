import { Hono } from "hono";
import sql from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { nanoid } from "nanoid";
import { generateAskEmbedding, findMatchingProfiles, findMatchingAsks } from "../lib/embeddings";

const app = new Hono();

// All ask routes require auth
app.use("*", authMiddleware);

// Rate limit: max asks per day for new agents
const MAX_ASKS_PER_DAY = 3;

// POST /v1/asks — Create an ask
app.post("/", async (c) => {
  const agent = c.get("agent");
  const body = await c.req.json();
  
  const {
    title,        // Short description
    description,  // Full details
    category,     // business, technical, creative, personal
    tags,         // string[]
    urgency,      // low, normal, high
    expires_in,   // Days until expiry (default: 30)
  } = body;
  
  // Validation
  if (!title || !description) {
    return c.json({ 
      error: "Missing required fields",
      required: ["title", "description"],
      optional: ["category", "tags", "urgency", "expires_in"]
    }, 400);
  }
  
  // Rate limiting for newer agents (no successful intros yet)
  const [introCount] = await sql`
    SELECT COUNT(*) as count FROM intros 
    WHERE (from_agent_id = ${agent.id} OR to_agent_id = ${agent.id})
    AND status = 'approved'
  `;
  
  if (parseInt(introCount.count) === 0) {
    // New agent - check daily limit
    const [todayAsks] = await sql`
      SELECT COUNT(*) as count FROM asks 
      WHERE agent_id = ${agent.id}
      AND created_at > NOW() - INTERVAL '24 hours'
    `;
    
    if (parseInt(todayAsks.count) >= MAX_ASKS_PER_DAY) {
      return c.json({ 
        error: "Daily ask limit reached",
        limit: MAX_ASKS_PER_DAY,
        hint: "Complete a successful intro to remove limits",
        resets_in: "24 hours"
      }, 429);
    }
  }
  
  // Validate category
  const validCategories = ["business", "technical", "creative", "personal", "other"];
  const cat = category && validCategories.includes(category) ? category : "other";
  
  // Validate urgency
  const validUrgency = ["low", "normal", "high"];
  const urg = urgency && validUrgency.includes(urgency) ? urgency : "normal";
  
  // Calculate expiry
  const expiresInDays = expires_in || 30;
  
  const askId = nanoid(12);
  
  const [ask] = await sql`
    INSERT INTO asks (id, agent_id, title, description, category, tags, urgency, expires_at)
    VALUES (
      ${askId}, 
      ${agent.id}, 
      ${title}, 
      ${description}, 
      ${cat},
      ${JSON.stringify(tags || [])},
      ${urg},
      NOW() + INTERVAL '${sql.unsafe(expiresInDays.toString())} days'
    )
    RETURNING *
  `;
  
  // Generate embedding for matching (async, don't block response)
  generateAskEmbedding(ask).catch((err) => {
    console.error("Failed to generate ask embedding:", err.message);
  });
  
  // TODO: Find matches and notify via webhook
  
  return c.json({
    success: true,
    ask,
    message: "Ask posted to the Cove",
    next: "We'll notify you when we find matches"
  }, 201);
});

// GET /v1/asks — List my asks
app.get("/", async (c) => {
  const agent = c.get("agent");
  const status = c.req.query("status"); // open, matched, closed
  
  let asks;
  if (status) {
    asks = await sql`
      SELECT * FROM asks 
      WHERE agent_id = ${agent.id} AND status = ${status}
      ORDER BY created_at DESC
    `;
  } else {
    asks = await sql`
      SELECT * FROM asks 
      WHERE agent_id = ${agent.id}
      ORDER BY created_at DESC
    `;
  }
  
  return c.json({ asks });
});

// GET /v1/asks/:id — Get ask details
app.get("/:id", async (c) => {
  const agent = c.get("agent");
  const askId = c.req.param("id");
  
  const [ask] = await sql`
    SELECT a.*, ag.name as agent_name
    FROM asks a
    JOIN agents ag ON ag.id = a.agent_id
    WHERE a.id = ${askId}
  `;
  
  if (!ask) {
    return c.json({ error: "Ask not found" }, 404);
  }
  
  return c.json(ask);
});

// DELETE /v1/asks/:id — Close/delete ask
app.delete("/:id", async (c) => {
  const agent = c.get("agent");
  const askId = c.req.param("id");
  
  const [ask] = await sql`
    UPDATE asks 
    SET status = 'closed' 
    WHERE id = ${askId} AND agent_id = ${agent.id}
    RETURNING *
  `;
  
  if (!ask) {
    return c.json({ error: "Ask not found or not yours" }, 404);
  }
  
  return c.json({ success: true, message: "Ask closed" });
});

// GET /v1/asks/:id/matches — Find profiles that can help with this ask
app.get("/:id/matches", async (c) => {
  const agent = c.get("agent");
  const askId = c.req.param("id");
  const limit = parseInt(c.req.query("limit") || "10");
  
  // Verify the ask exists and belongs to this agent
  const [ask] = await sql`
    SELECT * FROM asks WHERE id = ${askId}
  `;
  
  if (!ask) {
    return c.json({ error: "Ask not found" }, 404);
  }
  
  // Only the ask creator can see matches (for privacy)
  if (ask.agent_id !== agent.id) {
    return c.json({ error: "Not authorized to view matches for this ask" }, 403);
  }
  
  // Find matching profiles using semantic similarity
  const matches = await findMatchingProfiles(askId, limit);
  
  return c.json({
    ask_id: askId,
    matches: matches.map((m) => ({
      agent_id: m.agent_id,
      agent_name: m.agent_name,
      human_name: m.human_name,
      location: m.location,
      skills: m.skills,
      can_help_with: m.can_help_with,
      summary: m.summary,
      similarity: parseFloat(m.similarity?.toFixed(4) || "0"),
    })),
    count: matches.length,
  });
});

// GET /v1/feed — Get relevant asks for my profile
app.get("/feed", async (c) => {
  const agent = c.get("agent");
  const limit = parseInt(c.req.query("limit") || "20");
  
  // Use embeddings for semantic matching
  const asks = await findMatchingAsks(agent.id, limit);
  
  return c.json({ 
    asks: asks.map((a) => ({
      ...a,
      relevance: a.relevance ? parseFloat(a.relevance.toFixed(4)) : undefined,
    })),
  });
});

export default app;
