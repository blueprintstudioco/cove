import OpenAI from "openai";
import sql from "./db";

// Initialize OpenAI client
// Check for API key in environment or .credentials file
const getApiKey = (): string => {
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }
  
  // Try to read from credentials file
  try {
    const fs = require("fs");
    const path = require("path");
    const credPath = path.join(process.env.HOME || "", "clawd/.credentials/openai.json");
    if (fs.existsSync(credPath)) {
      const creds = JSON.parse(fs.readFileSync(credPath, "utf-8"));
      return creds.api_key || creds.apiKey;
    }
  } catch (e) {
    // Ignore - will fail below
  }
  
  throw new Error("OpenAI API key not found. Set OPENAI_API_KEY or add ~/clawd/.credentials/openai.json");
};

let openai: OpenAI | null = null;

const getClient = (): OpenAI => {
  if (!openai) {
    openai = new OpenAI({ apiKey: getApiKey() });
  }
  return openai;
};

const EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * Generate embedding for text using OpenAI
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getClient();
  
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: 1536,
  });
  
  return response.data[0].embedding;
}

/**
 * Build profile text for embedding
 */
function buildProfileText(profile: {
  human_name?: string;
  location?: string;
  interests?: string[];
  skills?: string[];
  building?: string[];
  looking_for?: string[];
  can_help_with?: string[];
  summary?: string;
}): string {
  const parts: string[] = [];
  
  if (profile.human_name) parts.push(`Name: ${profile.human_name}`);
  if (profile.location) parts.push(`Location: ${profile.location}`);
  if (profile.summary) parts.push(`About: ${profile.summary}`);
  
  // Parse JSON if needed
  const parseArr = (val: string[] | string | null): string[] => {
    if (!val) return [];
    if (typeof val === "string") {
      try { return JSON.parse(val); } catch { return []; }
    }
    return val;
  };
  
  const interests = parseArr(profile.interests);
  const skills = parseArr(profile.skills);
  const building = parseArr(profile.building);
  const lookingFor = parseArr(profile.looking_for);
  const canHelpWith = parseArr(profile.can_help_with);
  
  if (interests.length) parts.push(`Interests: ${interests.join(", ")}`);
  if (skills.length) parts.push(`Skills: ${skills.join(", ")}`);
  if (building.length) parts.push(`Building: ${building.join(", ")}`);
  if (lookingFor.length) parts.push(`Looking for: ${lookingFor.join(", ")}`);
  if (canHelpWith.length) parts.push(`Can help with: ${canHelpWith.join(", ")}`);
  
  return parts.join("\n");
}

/**
 * Build ask text for embedding
 */
function buildAskText(ask: {
  title: string;
  description: string;
  category?: string;
  tags?: string[];
}): string {
  const parts: string[] = [];
  
  parts.push(`Title: ${ask.title}`);
  parts.push(`Description: ${ask.description}`);
  
  if (ask.category) parts.push(`Category: ${ask.category}`);
  
  const tags = typeof ask.tags === "string" ? JSON.parse(ask.tags) : (ask.tags || []);
  if (tags.length) parts.push(`Tags: ${tags.join(", ")}`);
  
  return parts.join("\n");
}

/**
 * Generate and store embedding for a profile
 */
export async function generateProfileEmbedding(profile: {
  id: string;
  agent_id: string;
  human_name?: string;
  location?: string;
  interests?: string[];
  skills?: string[];
  building?: string[];
  looking_for?: string[];
  can_help_with?: string[];
  summary?: string;
}): Promise<void> {
  const text = buildProfileText(profile);
  
  if (!text.trim()) {
    console.log(`Skipping embedding for profile ${profile.id} - no content`);
    return;
  }
  
  console.log(`Generating embedding for profile ${profile.id}...`);
  const embedding = await generateEmbedding(text);
  
  // Store as pgvector format
  const vectorStr = `[${embedding.join(",")}]`;
  
  await sql`
    UPDATE profiles 
    SET embedding = ${vectorStr}::vector
    WHERE id = ${profile.id}
  `;
  
  console.log(`Stored embedding for profile ${profile.id}`);
}

/**
 * Generate and store embedding for an ask
 */
export async function generateAskEmbedding(ask: {
  id: string;
  title: string;
  description: string;
  category?: string;
  tags?: string[];
}): Promise<void> {
  const text = buildAskText(ask);
  
  console.log(`Generating embedding for ask ${ask.id}...`);
  const embedding = await generateEmbedding(text);
  
  // Store as pgvector format
  const vectorStr = `[${embedding.join(",")}]`;
  
  await sql`
    UPDATE asks 
    SET embedding = ${vectorStr}::vector
    WHERE id = ${ask.id}
  `;
  
  console.log(`Stored embedding for ask ${ask.id}`);
}

/**
 * Find profiles that can help with an ask (semantic matching)
 */
export async function findMatchingProfiles(askId: string, limit: number = 10): Promise<any[]> {
  // Get the ask's embedding
  const [ask] = await sql`
    SELECT id, agent_id, embedding 
    FROM asks 
    WHERE id = ${askId}
  `;
  
  if (!ask?.embedding) {
    console.log(`Ask ${askId} has no embedding`);
    return [];
  }
  
  // Find profiles with similar can_help_with using cosine similarity
  // Exclude the ask creator and only match profiles with embeddings
  const matches = await sql`
    SELECT 
      p.id,
      p.agent_id,
      p.human_name,
      p.location,
      p.skills,
      p.can_help_with,
      p.summary,
      a.name as agent_name,
      1 - (p.embedding <=> ${ask.embedding}::vector) as similarity
    FROM profiles p
    JOIN agents a ON a.id = p.agent_id
    WHERE p.embedding IS NOT NULL
      AND p.agent_id != ${ask.agent_id}
      AND p.visibility != 'private'
      AND a.status = 'active'
    ORDER BY p.embedding <=> ${ask.embedding}::vector
    LIMIT ${limit}
  `;
  
  return matches;
}

/**
 * Find asks that match a profile's interests/skills (for feed)
 */
export async function findMatchingAsks(agentId: string, limit: number = 20): Promise<any[]> {
  // Get the profile's embedding
  const [profile] = await sql`
    SELECT id, agent_id, embedding 
    FROM profiles 
    WHERE agent_id = ${agentId}
  `;
  
  if (!profile?.embedding) {
    console.log(`Profile for agent ${agentId} has no embedding`);
    // Fall back to recent asks
    return sql`
      SELECT a.*, ag.name as agent_name
      FROM asks a
      JOIN agents ag ON ag.id = a.agent_id
      WHERE a.agent_id != ${agentId}
        AND a.status = 'open'
        AND a.expires_at > NOW()
      ORDER BY a.created_at DESC
      LIMIT ${limit}
    `;
  }
  
  // Find asks with semantic similarity to profile
  const matches = await sql`
    SELECT 
      a.*,
      ag.name as agent_name,
      1 - (a.embedding <=> ${profile.embedding}::vector) as relevance
    FROM asks a
    JOIN agents ag ON ag.id = a.agent_id
    WHERE a.embedding IS NOT NULL
      AND a.agent_id != ${agentId}
      AND a.status = 'open'
      AND a.expires_at > NOW()
    ORDER BY a.embedding <=> ${profile.embedding}::vector
    LIMIT ${limit}
  `;
  
  return matches;
}
