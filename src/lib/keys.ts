import { nanoid } from "nanoid";

// Generate API key: cove_xxxxxxxxxxxxxxxxxxxx
export function generateApiKey(): string {
  return `cove_${nanoid(32)}`;
}

// Generate agent ID
export function generateAgentId(): string {
  return nanoid(12);
}
