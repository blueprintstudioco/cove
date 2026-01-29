import { Context, Next } from "hono";
import sql from "../lib/db";

export interface AuthContext {
  agent: {
    id: string;
    name: string;
    status: string;
  };
}

// Verify API key and attach agent to context
export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");
  
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }
  
  const apiKey = authHeader.slice(7);
  
  if (!apiKey.startsWith("cove_")) {
    return c.json({ error: "Invalid API key format" }, 401);
  }
  
  const [agent] = await sql`
    SELECT id, name, status 
    FROM agents 
    WHERE api_key = ${apiKey}
  `;
  
  if (!agent) {
    return c.json({ error: "Invalid API key" }, 401);
  }
  
  if (agent.status === "banned") {
    return c.json({ error: "Agent is banned" }, 403);
  }
  
  // Update last seen
  await sql`
    UPDATE agents SET last_seen_at = NOW() WHERE id = ${agent.id}
  `;
  
  c.set("agent", agent);
  return next();
}
