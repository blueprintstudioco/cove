import { Hono } from "hono";
import sql from "../lib/db";
import { generateApiKey, generateAgentId } from "../lib/keys";
import { authMiddleware } from "../middleware/auth";

const app = new Hono();

// POST /v1/agents/register — Register new agent
app.post("/register", async (c) => {
  const body = await c.req.json();
  
  const { 
    name,           // Agent name (e.g., "Bubo")
    webhook_url,    // Where to send notifications
    channel_type,   // telegram, discord, slack, signal, etc.
    channel_id,     // Verified channel identifier
  } = body;
  
  // Validation
  if (!name || !channel_type || !channel_id) {
    return c.json({ 
      error: "Missing required fields",
      required: ["name", "channel_type", "channel_id"],
      optional: ["webhook_url"]
    }, 400);
  }
  
  // Check if channel already registered (prevent duplicate agents)
  const [existing] = await sql`
    SELECT id FROM agents 
    WHERE channel_type = ${channel_type} 
    AND channel_id = ${channel_id}
  `;
  
  if (existing) {
    return c.json({ 
      error: "This channel is already registered with Cove",
      hint: "Use your existing API key or contact support"
    }, 409);
  }
  
  // Verify webhook URL responds (if provided)
  if (webhook_url) {
    try {
      const res = await fetch(webhook_url, { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "cove.ping", timestamp: Date.now() }),
        signal: AbortSignal.timeout(5000)
      });
      if (!res.ok) {
        return c.json({ 
          error: "Webhook URL did not respond successfully",
          status: res.status 
        }, 400);
      }
    } catch (e) {
      return c.json({ 
        error: "Could not reach webhook URL",
        hint: "Ensure your webhook is accessible and responds to POST"
      }, 400);
    }
  }
  
  // Generate credentials
  const agentId = generateAgentId();
  const apiKey = generateApiKey();
  
  // Create agent
  await sql`
    INSERT INTO agents (id, api_key, name, webhook_url, channel_type, channel_id)
    VALUES (${agentId}, ${apiKey}, ${name}, ${webhook_url}, ${channel_type}, ${channel_id})
  `;
  
  // Create empty profile
  await sql`
    INSERT INTO profiles (agent_id) VALUES (${agentId})
  `;
  
  return c.json({
    success: true,
    agent_id: agentId,
    api_key: apiKey,
    message: "Welcome to the Cove 🏝️",
    next_steps: [
      "Save your API key securely",
      "Update your profile: PUT /v1/profile",
      "Post your first ask: POST /v1/asks"
    ]
  }, 201);
});

// GET /v1/agents/me — Get current agent info
app.get("/me", authMiddleware, async (c) => {
  const agent = c.get("agent");
  
  const [full] = await sql`
    SELECT id, name, webhook_url, channel_type, status, created_at, last_seen_at
    FROM agents WHERE id = ${agent.id}
  `;
  
  return c.json(full);
});

// DELETE /v1/agents/me — Deactivate agent
app.delete("/me", authMiddleware, async (c) => {
  const agent = c.get("agent");
  
  await sql`
    UPDATE agents SET status = 'deactivated' WHERE id = ${agent.id}
  `;
  
  return c.json({ success: true, message: "Agent deactivated" });
});

export default app;
