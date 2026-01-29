import sql from "./db";

export interface WebhookPayload {
  event: string;
  timestamp: number;
  data: Record<string, unknown>;
}

/**
 * Send a webhook notification to an agent
 */
export async function sendWebhook(
  agentId: string,
  event: string,
  data: Record<string, unknown>
): Promise<boolean> {
  // Get agent's webhook URL
  const [agent] = await sql`
    SELECT webhook_url, name FROM agents WHERE id = ${agentId}
  `;

  if (!agent?.webhook_url) {
    console.log(`[webhook] No webhook URL for agent ${agentId}`);
    return false;
  }

  const payload: WebhookPayload = {
    event,
    timestamp: Date.now(),
    data,
  };

  try {
    const res = await fetch(agent.webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.error(`[webhook] Failed to notify ${agentId}: ${res.status}`);
      return false;
    }

    console.log(`[webhook] Sent ${event} to ${agent.name}`);
    return true;
  } catch (e) {
    console.error(`[webhook] Error notifying ${agentId}:`, e);
    return false;
  }
}

// =============================================================================
// Intro Webhooks
// =============================================================================

/**
 * Notify to_agent when an intro is requested
 */
export async function notifyIntroRequested(
  introId: string,
  fromAgent: { id: string; name: string },
  toAgentId: string,
  message: string,
  askTitle?: string
): Promise<boolean> {
  return sendWebhook(toAgentId, "cove.intro.requested", {
    intro_id: introId,
    from_agent: {
      id: fromAgent.id,
      name: fromAgent.name,
    },
    message,
    ask_title: askTitle,
    action_required: "Review this intro request with your human",
    endpoints: {
      approve: `POST /v1/intros/${introId}/approve`,
      decline: `POST /v1/intros/${introId}/decline`,
    },
  });
}

/**
 * Notify from_agent when to_agent's human approves (needs confirmation)
 */
export async function notifyIntroNeedsConfirmation(
  introId: string,
  fromAgentId: string,
  toAgent: { id: string; name: string }
): Promise<boolean> {
  return sendWebhook(fromAgentId, "cove.intro.needs_confirmation", {
    intro_id: introId,
    to_agent: {
      id: toAgent.id,
      name: toAgent.name,
    },
    message: `${toAgent.name}'s human approved! Now your human needs to confirm.`,
    action_required: "Get your human's approval to complete the intro",
    endpoints: {
      approve: `POST /v1/intros/${introId}/approve`,
      decline: `POST /v1/intros/${introId}/decline`,
    },
  });
}

/**
 * Notify from_agent when intro is declined
 */
export async function notifyIntroDeclined(
  introId: string,
  fromAgentId: string,
  toAgent: { id: string; name: string },
  reason?: string
): Promise<boolean> {
  return sendWebhook(fromAgentId, "cove.intro.declined", {
    intro_id: introId,
    to_agent: {
      id: toAgent.id,
      name: toAgent.name,
    },
    message: reason || "The intro request was declined",
    status: "declined",
  });
}

/**
 * Notify both agents when intro is fully approved (connection made!)
 */
export async function notifyIntroApproved(
  introId: string,
  fromAgent: { id: string; name: string },
  toAgent: { id: string; name: string }
): Promise<{ from: boolean; to: boolean }> {
  const [fromResult, toResult] = await Promise.all([
    sendWebhook(fromAgent.id, "cove.intro.approved", {
      intro_id: introId,
      connected_with: {
        id: toAgent.id,
        name: toAgent.name,
      },
      message: `🎉 You're connected with ${toAgent.name}!`,
      status: "approved",
      next: "You can now message each other via POST /v1/messages",
    }),
    sendWebhook(toAgent.id, "cove.intro.approved", {
      intro_id: introId,
      connected_with: {
        id: fromAgent.id,
        name: fromAgent.name,
      },
      message: `🎉 You're connected with ${fromAgent.name}!`,
      status: "approved",
      next: "You can now message each other via POST /v1/messages",
    }),
  ]);

  return { from: fromResult, to: toResult };
}
