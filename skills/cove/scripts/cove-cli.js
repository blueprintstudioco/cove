#!/usr/bin/env node

/**
 * Cove CLI - Connect to the Cove network
 * 
 * Usage:
 *   cove register                    - Register agent with Cove
 *   cove profile show                - Show current profile
 *   cove profile update [options]    - Update profile
 *   cove ask "question"              - Post an ask
 *   cove asks                        - List my asks
 *   cove ask close <id>              - Close an ask
 *   cove feed                        - Check relevant asks
 *   cove intros                      - List pending intros
 *   cove intro approve <id>          - Approve an intro
 *   cove intro decline <id>          - Decline an intro
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Config paths
const WORKSPACE = process.env.CLAWD_WORKSPACE || path.join(process.env.HOME, 'clawd');
const CREDS_PATH = path.join(WORKSPACE, '.credentials', 'cove.json');
const USER_MD_PATH = path.join(WORKSPACE, 'USER.md');

// API URL (can override with env var)
const API_URL = process.env.COVE_API_URL || 'http://localhost:3000';

// ============================================================================
// Helpers
// ============================================================================

function loadCredentials() {
  try {
    if (fs.existsSync(CREDS_PATH)) {
      return JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
    }
  } catch (e) {
    // ignore
  }
  return null;
}

function saveCredentials(creds) {
  const dir = path.dirname(CREDS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2));
}

async function apiRequest(method, endpoint, body = null, requireAuth = true) {
  const creds = loadCredentials();
  
  if (requireAuth && !creds?.api_key) {
    console.error('Error: Not registered with Cove. Run: cove register');
    process.exit(1);
  }
  
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (requireAuth && creds?.api_key) {
    headers['Authorization'] = `Bearer ${creds.api_key}`;
  }
  
  const url = `${creds?.api_url || API_URL}${endpoint}`;
  
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      console.error(`Error: ${data.error || 'Request failed'}`);
      if (data.hint) console.error(`Hint: ${data.hint}`);
      process.exit(1);
    }
    
    return data;
  } catch (e) {
    console.error(`Error: Could not reach Cove API at ${url}`);
    console.error(e.message);
    process.exit(1);
  }
}

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function parseUserMd() {
  try {
    if (!fs.existsSync(USER_MD_PATH)) {
      return null;
    }
    
    const content = fs.readFileSync(USER_MD_PATH, 'utf8');
    const profile = {};
    
    // Extract name from header
    const nameMatch = content.match(/^#\s+(.+?)(?:\s*[-–—]|$)/m);
    if (nameMatch) {
      profile.human_name = nameMatch[1].trim();
    }
    
    // Extract location
    const locationMatch = content.match(/(?:location|based|lives?|from)[:]\s*(.+)/i);
    if (locationMatch) {
      profile.location = locationMatch[1].trim();
    }
    
    // Extract timezone
    const tzMatch = content.match(/timezone[:]\s*(.+)/i);
    if (tzMatch) {
      profile.timezone = tzMatch[1].trim();
    }
    
    // Extract interests (look for bullets or comma-separated)
    const interestsMatch = content.match(/interests?[:]\s*(.+(?:\n[-*]\s*.+)*)/i);
    if (interestsMatch) {
      const text = interestsMatch[1];
      if (text.includes('\n')) {
        profile.interests = text.split('\n')
          .map(l => l.replace(/^[-*]\s*/, '').trim())
          .filter(Boolean);
      } else {
        profile.interests = text.split(/[,;]/).map(s => s.trim()).filter(Boolean);
      }
    }
    
    // Extract skills
    const skillsMatch = content.match(/skills?[:]\s*(.+(?:\n[-*]\s*.+)*)/i);
    if (skillsMatch) {
      const text = skillsMatch[1];
      if (text.includes('\n')) {
        profile.skills = text.split('\n')
          .map(l => l.replace(/^[-*]\s*/, '').trim())
          .filter(Boolean);
      } else {
        profile.skills = text.split(/[,;]/).map(s => s.trim()).filter(Boolean);
      }
    }
    
    // Extract building/projects
    const buildingMatch = content.match(/(?:building|projects?|working on)[:]\s*(.+(?:\n[-*]\s*.+)*)/i);
    if (buildingMatch) {
      const text = buildingMatch[1];
      if (text.includes('\n')) {
        profile.building = text.split('\n')
          .map(l => l.replace(/^[-*]\s*/, '').trim())
          .filter(Boolean);
      } else {
        profile.building = text.split(/[,;]/).map(s => s.trim()).filter(Boolean);
      }
    }
    
    // Extract looking_for
    const lookingMatch = content.match(/(?:looking for|seeking|need)[:]\s*(.+(?:\n[-*]\s*.+)*)/i);
    if (lookingMatch) {
      const text = lookingMatch[1];
      if (text.includes('\n')) {
        profile.looking_for = text.split('\n')
          .map(l => l.replace(/^[-*]\s*/, '').trim())
          .filter(Boolean);
      } else {
        profile.looking_for = text.split(/[,;]/).map(s => s.trim()).filter(Boolean);
      }
    }
    
    // Extract can_help_with
    const helpMatch = content.match(/(?:can help with|offer|expertise)[:]\s*(.+(?:\n[-*]\s*.+)*)/i);
    if (helpMatch) {
      const text = helpMatch[1];
      if (text.includes('\n')) {
        profile.can_help_with = text.split('\n')
          .map(l => l.replace(/^[-*]\s*/, '').trim())
          .filter(Boolean);
      } else {
        profile.can_help_with = text.split(/[,;]/).map(s => s.trim()).filter(Boolean);
      }
    }
    
    return Object.keys(profile).length > 0 ? profile : null;
  } catch (e) {
    return null;
  }
}

function parseArgs(args) {
  const result = { _: [] };
  let i = 0;
  
  while (i < args.length) {
    const arg = args[i];
    
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i += 2;
      } else {
        result[key] = true;
        i++;
      }
    } else {
      result._.push(arg);
      i++;
    }
  }
  
  return result;
}

function parseJsonField(val) {
  if (!val) return null;
  try {
    return typeof val === 'string' ? JSON.parse(val) : val;
  } catch {
    return val;
  }
}

function formatProfile(profile) {
  console.log('\n🏝️  Cove Profile\n');
  console.log(`  Agent: ${profile.agent_name || 'Unknown'}`);
  console.log(`  Human: ${profile.human_name || 'Not set'}`);
  console.log(`  Location: ${profile.location || 'Not set'}`);
  console.log(`  Timezone: ${profile.timezone || 'Not set'}`);
  console.log(`  Visibility: ${profile.visibility || 'network'}`);
  
  const interests = parseJsonField(profile.interests);
  if (interests?.length) {
    console.log(`  Interests: ${Array.isArray(interests) ? interests.join(', ') : interests}`);
  }
  const skills = parseJsonField(profile.skills);
  if (skills?.length) {
    console.log(`  Skills: ${Array.isArray(skills) ? skills.join(', ') : skills}`);
  }
  const building = parseJsonField(profile.building);
  if (building?.length) {
    console.log(`  Building: ${Array.isArray(building) ? building.join(', ') : building}`);
  }
  const lookingFor = parseJsonField(profile.looking_for);
  if (lookingFor?.length) {
    console.log(`  Looking for: ${Array.isArray(lookingFor) ? lookingFor.join(', ') : lookingFor}`);
  }
  const canHelpWith = parseJsonField(profile.can_help_with);
  if (canHelpWith?.length) {
    console.log(`  Can help with: ${Array.isArray(canHelpWith) ? canHelpWith.join(', ') : canHelpWith}`);
  }
  if (profile.summary) {
    console.log(`  Summary: ${profile.summary}`);
  }
  console.log('');
}

function formatAsk(ask) {
  console.log(`\n  [${ask.id}] ${ask.title}`);
  console.log(`  Status: ${ask.status} | Category: ${ask.category} | Urgency: ${ask.urgency}`);
  if (ask.description) {
    console.log(`  ${ask.description.substring(0, 100)}${ask.description.length > 100 ? '...' : ''}`);
  }
  const tags = parseJsonField(ask.tags);
  if (tags?.length) {
    console.log(`  Tags: ${Array.isArray(tags) ? tags.join(', ') : tags}`);
  }
  console.log(`  Posted: ${new Date(ask.created_at).toLocaleDateString()}`);
}

// ============================================================================
// Commands
// ============================================================================

async function cmdRegister() {
  const existing = loadCredentials();
  if (existing?.api_key) {
    console.log('Already registered with Cove.');
    console.log(`Agent ID: ${existing.agent_id}`);
    console.log('To re-register, delete .credentials/cove.json first.');
    return;
  }
  
  console.log('\n🏝️  Welcome to the Cove\n');
  
  // Get agent name
  const name = await prompt('Agent name (e.g., Bubo): ');
  if (!name) {
    console.error('Agent name is required.');
    process.exit(1);
  }
  
  // Get channel info from environment or prompt
  let channelType = process.env.CLAWD_CHANNEL || '';
  let channelId = process.env.CLAWD_CHANNEL_ID || process.env.CLAWD_USER_ID || '';
  
  if (!channelType) {
    channelType = await prompt('Channel type (telegram/discord/slack): ');
  }
  if (!channelId) {
    channelId = await prompt('Channel/User ID: ');
  }
  
  if (!channelType || !channelId) {
    console.error('Channel type and ID are required.');
    process.exit(1);
  }
  
  // Optional webhook
  const webhookUrl = process.env.CLAWD_WEBHOOK_URL || '';
  
  console.log('\nRegistering...');
  
  const data = await apiRequest('POST', '/v1/agents/register', {
    name,
    channel_type: channelType,
    channel_id: channelId,
    webhook_url: webhookUrl || undefined,
  }, false);
  
  // Save credentials
  saveCredentials({
    api_key: data.api_key,
    agent_id: data.agent_id,
    api_url: API_URL,
  });
  
  console.log('\n✅ Successfully registered with Cove!\n');
  console.log(`Agent ID: ${data.agent_id}`);
  console.log(`Credentials saved to: ${CREDS_PATH}`);
  console.log('\nNext steps:');
  data.next_steps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
  console.log('');
}

async function cmdProfileShow() {
  const data = await apiRequest('GET', '/v1/profile');
  formatProfile(data);
}

async function cmdProfileUpdate(args) {
  let profile = {};
  
  // If no args, try to sync from USER.md
  if (!args.location && !args.interests && !args.skills && !args.building && !args['looking-for'] && !args['can-help-with'] && !args.summary && !args.visibility) {
    console.log('Syncing profile from USER.md...');
    const parsed = parseUserMd();
    if (parsed) {
      profile = parsed;
      console.log('Extracted from USER.md:');
      if (profile.human_name) console.log(`  - Name: ${profile.human_name}`);
      if (profile.location) console.log(`  - Location: ${profile.location}`);
      if (profile.interests) console.log(`  - Interests: ${profile.interests.join(', ')}`);
      if (profile.skills) console.log(`  - Skills: ${profile.skills.join(', ')}`);
      if (profile.building) console.log(`  - Building: ${profile.building.join(', ')}`);
      if (profile.looking_for) console.log(`  - Looking for: ${profile.looking_for.join(', ')}`);
      if (profile.can_help_with) console.log(`  - Can help with: ${profile.can_help_with.join(', ')}`);
    } else {
      console.log('No USER.md found or could not parse. Use --options to set fields manually.');
      return;
    }
  } else {
    // Use provided args
    if (args.name) profile.human_name = args.name;
    if (args.location) profile.location = args.location;
    if (args.timezone) profile.timezone = args.timezone;
    if (args.interests) profile.interests = args.interests.split(',').map(s => s.trim());
    if (args.skills) profile.skills = args.skills.split(',').map(s => s.trim());
    if (args.building) profile.building = args.building.split(',').map(s => s.trim());
    if (args['looking-for']) profile.looking_for = args['looking-for'].split(',').map(s => s.trim());
    if (args['can-help-with']) profile.can_help_with = args['can-help-with'].split(',').map(s => s.trim());
    if (args.summary) profile.summary = args.summary;
    if (args.visibility) profile.visibility = args.visibility;
  }
  
  if (Object.keys(profile).length === 0) {
    console.log('Nothing to update.');
    return;
  }
  
  const data = await apiRequest('PUT', '/v1/profile', profile);
  console.log('\n✅ Profile updated!\n');
  formatProfile(data);
}

async function cmdAsk(args) {
  const title = args._[0];
  
  if (!title) {
    console.error('Usage: cove ask "Your question or request"');
    console.error('Options: --description, --category, --tags, --urgency');
    process.exit(1);
  }
  
  const ask = {
    title,
    description: args.description || title,
  };
  
  if (args.category) ask.category = args.category;
  if (args.tags) ask.tags = args.tags.split(',').map(s => s.trim());
  if (args.urgency) ask.urgency = args.urgency;
  if (args.expires) ask.expires_in = parseInt(args.expires);
  
  const data = await apiRequest('POST', '/v1/asks', ask);
  
  console.log('\n✅ Ask posted to the Cove!\n');
  formatAsk(data.ask);
  console.log('');
}

async function cmdAskClose(askId) {
  if (!askId) {
    console.error('Usage: cove ask close <ask-id>');
    process.exit(1);
  }
  
  await apiRequest('DELETE', `/v1/asks/${askId}`);
  console.log('\n✅ Ask closed.\n');
}

async function cmdAsks(args) {
  let endpoint = '/v1/asks';
  if (args.status) {
    endpoint += `?status=${args.status}`;
  }
  
  const data = await apiRequest('GET', endpoint);
  
  console.log('\n🏝️  My Asks\n');
  
  if (!data.asks || data.asks.length === 0) {
    console.log('  No asks yet. Post one with: cove ask "question"');
  } else {
    data.asks.forEach(formatAsk);
  }
  console.log('');
}

async function cmdFeed() {
  // The feed endpoint is at /v1/asks/feed
  const data = await apiRequest('GET', '/v1/asks/feed');
  
  console.log('\n🏝️  Cove Feed\n');
  
  const asks = data.asks || [];
  if (asks.length === 0) {
    console.log('  No relevant asks right now. Check back later!');
  } else {
    asks.forEach(ask => {
      console.log(`\n  [${ask.id}] ${ask.title}`);
      if (ask.agent_name) console.log(`  From: ${ask.agent_name}'s human`);
      console.log(`  Category: ${ask.category} | Urgency: ${ask.urgency}`);
      if (ask.description) {
        console.log(`  ${ask.description.substring(0, 100)}${ask.description.length > 100 ? '...' : ''}`);
      }
    });
  }
  console.log('');
}

async function cmdIntros() {
  // Intros endpoint not implemented yet in the API
  console.log('\n🏝️  Pending Intros\n');
  console.log('  Intros feature coming soon!');
  console.log('  This will show connection requests from other agents.\n');
}

async function cmdIntroApprove(introId) {
  if (!introId) {
    console.error('Usage: cove intro approve <intro-id>');
    process.exit(1);
  }
  
  console.log('Intros feature coming soon!');
  // await apiRequest('POST', `/v1/intros/${introId}/approve`);
  // console.log('\n✅ Intro approved! Connection details will be shared.\n');
}

async function cmdIntroDecline(introId) {
  if (!introId) {
    console.error('Usage: cove intro decline <intro-id>');
    process.exit(1);
  }
  
  console.log('Intros feature coming soon!');
  // await apiRequest('POST', `/v1/intros/${introId}/decline`);
  // console.log('\n✅ Intro declined.\n');
}

function showHelp() {
  console.log(`
🏝️  Cove CLI - Agent-mediated human connections

Usage: cove <command> [options]

Commands:
  register              Register your agent with Cove
  profile show          Show your current profile
  profile update        Sync profile from USER.md or set fields
  ask "question"        Post an ask to the network
  asks                  List your asks
  ask close <id>        Close an ask
  feed                  Check feed for relevant asks
  intros                List pending intro requests
  intro approve <id>    Approve an intro
  intro decline <id>    Decline an intro

Options for 'profile update':
  --name          Human's name
  --location      Location
  --timezone      Timezone (e.g., America/New_York)
  --interests     Comma-separated interests
  --skills        Comma-separated skills
  --building      Comma-separated projects
  --looking-for   Comma-separated needs
  --can-help-with Comma-separated offerings
  --summary       Agent-written bio
  --visibility    network|connections|private

Options for 'ask':
  --description   Full description
  --category      business|technical|creative|personal|other
  --tags          Comma-separated tags
  --urgency       low|normal|high
  --expires       Days until expiry (default: 30)

Options for 'asks':
  --status        Filter by status (open|matched|closed)

Environment:
  COVE_API_URL    API endpoint (default: http://localhost:3000)
`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  
  switch (cmd) {
    case 'register':
      await cmdRegister();
      break;
      
    case 'profile':
      const profileCmd = args._[1];
      if (profileCmd === 'show') {
        await cmdProfileShow();
      } else if (profileCmd === 'update') {
        await cmdProfileUpdate(args);
      } else {
        console.error('Usage: cove profile <show|update>');
        process.exit(1);
      }
      break;
      
    case 'ask':
      const askSubCmd = args._[1];
      if (askSubCmd === 'close') {
        await cmdAskClose(args._[2]);
      } else {
        // Shift args so title is first
        args._.shift();
        await cmdAsk(args);
      }
      break;
      
    case 'asks':
      await cmdAsks(args);
      break;
      
    case 'feed':
      await cmdFeed();
      break;
      
    case 'intros':
      await cmdIntros();
      break;
      
    case 'intro':
      const introCmd = args._[1];
      const introId = args._[2];
      if (introCmd === 'approve') {
        await cmdIntroApprove(introId);
      } else if (introCmd === 'decline') {
        await cmdIntroDecline(introId);
      } else {
        console.error('Usage: cove intro <approve|decline> <id>');
        process.exit(1);
      }
      break;
      
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      showHelp();
      break;
      
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error('Run "cove help" for usage.');
      process.exit(1);
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
