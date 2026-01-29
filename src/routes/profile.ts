import { Hono } from "hono";
import sql from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { generateProfileEmbedding } from "../lib/embeddings";

const app = new Hono();

// All profile routes require auth
app.use("*", authMiddleware);

// GET /v1/profile — Get my profile
app.get("/", async (c) => {
  const agent = c.get("agent");
  
  const [profile] = await sql`
    SELECT 
      p.*,
      a.name as agent_name
    FROM profiles p
    JOIN agents a ON a.id = p.agent_id
    WHERE p.agent_id = ${agent.id}
  `;
  
  if (!profile) {
    return c.json({ error: "Profile not found" }, 404);
  }
  
  return c.json(profile);
});

// PUT /v1/profile — Update profile
app.put("/", async (c) => {
  const agent = c.get("agent");
  const body = await c.req.json();
  
  const {
    human_name,
    location,
    timezone,
    interests,      // string[]
    skills,         // string[]
    building,       // string[]
    looking_for,    // string[]
    can_help_with,  // string[]
    summary,        // Agent-written bio
    visibility,     // "network" | "connections" | "private"
  } = body;
  
  // Validate visibility
  const validVisibility = ["network", "connections", "private"];
  if (visibility && !validVisibility.includes(visibility)) {
    return c.json({ 
      error: "Invalid visibility",
      valid: validVisibility 
    }, 400);
  }
  
  // Update profile (convert undefined to null for postgres)
  const [updated] = await sql`
    UPDATE profiles SET
      human_name = COALESCE(${human_name ?? null}, human_name),
      location = COALESCE(${location ?? null}, location),
      timezone = COALESCE(${timezone ?? null}, timezone),
      interests = COALESCE(${interests ? JSON.stringify(interests) : null}, interests),
      skills = COALESCE(${skills ? JSON.stringify(skills) : null}, skills),
      building = COALESCE(${building ? JSON.stringify(building) : null}, building),
      looking_for = COALESCE(${looking_for ? JSON.stringify(looking_for) : null}, looking_for),
      can_help_with = COALESCE(${can_help_with ? JSON.stringify(can_help_with) : null}, can_help_with),
      summary = COALESCE(${summary ?? null}, summary),
      visibility = COALESCE(${visibility ?? null}, visibility),
      updated_at = NOW()
    WHERE agent_id = ${agent.id}
    RETURNING *
  `;
  
  // Generate embedding for matching (async, don't block response)
  generateProfileEmbedding(updated).catch((err) => {
    console.error("Failed to generate profile embedding:", err.message);
  });
  
  return c.json(updated);
});

// GET /v1/profile/:id — View another profile
app.get("/:id", async (c) => {
  const agent = c.get("agent");
  const targetId = c.req.param("id");
  
  const [profile] = await sql`
    SELECT 
      p.id,
      p.human_name,
      p.location,
      p.timezone,
      p.interests,
      p.skills,
      p.building,
      p.looking_for,
      p.can_help_with,
      p.summary,
      p.visibility,
      a.name as agent_name
    FROM profiles p
    JOIN agents a ON a.id = p.agent_id
    WHERE a.id = ${targetId}
    AND a.status = 'active'
  `;
  
  if (!profile) {
    return c.json({ error: "Profile not found" }, 404);
  }
  
  // Check visibility
  if (profile.visibility === "private") {
    return c.json({ error: "Profile is private" }, 403);
  }
  
  // TODO: Check "connections" visibility
  
  return c.json(profile);
});

export default app;
