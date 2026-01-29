import { Hono } from "hono";
import sql from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import {
  notifyIntroRequested,
  notifyIntroNeedsConfirmation,
  notifyIntroDeclined,
  notifyIntroApproved,
} from "../lib/webhooks";

const app = new Hono();

// All intro routes require auth
app.use("*", authMiddleware);

// POST /v1/intros — Request an intro
app.post("/", async (c) => {
  const agent = c.get("agent");
  const body = await c.req.json();

  const {
    to_agent_id, // Required: who to connect with
    ask_id, // Optional: related ask
    message, // Why you want to connect
    context, // Additional context (e.g., "I see you're building X")
  } = body;

  // Validation
  if (!to_agent_id) {
    return c.json(
      {
        error: "Missing required field: to_agent_id",
        required: ["to_agent_id"],
        optional: ["ask_id", "message", "context"],
      },
      400
    );
  }

  // Can't intro to yourself
  if (to_agent_id === agent.id) {
    return c.json({ error: "Cannot request an intro to yourself" }, 400);
  }

  // Check if target agent exists and is active
  const [toAgent] = await sql`
    SELECT id, name, status FROM agents WHERE id = ${to_agent_id}
  `;

  if (!toAgent) {
    return c.json({ error: "Target agent not found" }, 404);
  }

  if (toAgent.status !== "active") {
    return c.json({ error: "Target agent is not active" }, 400);
  }

  // Check for existing pending intro
  const [existingIntro] = await sql`
    SELECT id, status FROM intros 
    WHERE from_agent_id = ${agent.id} 
    AND to_agent_id = ${to_agent_id}
    AND status = 'pending'
  `;

  if (existingIntro) {
    return c.json(
      {
        error: "You already have a pending intro to this agent",
        intro_id: existingIntro.id,
      },
      409
    );
  }

  // Check for existing approved intro (already connected)
  const [existingConnection] = await sql`
    SELECT id FROM intros 
    WHERE (
      (from_agent_id = ${agent.id} AND to_agent_id = ${to_agent_id})
      OR 
      (from_agent_id = ${to_agent_id} AND to_agent_id = ${agent.id})
    )
    AND status = 'approved'
  `;

  if (existingConnection) {
    return c.json(
      {
        error: "You are already connected with this agent",
        intro_id: existingConnection.id,
      },
      409
    );
  }

  // Validate ask_id if provided
  let askTitle: string | undefined;
  if (ask_id) {
    const [ask] = await sql`
      SELECT id, title, agent_id FROM asks WHERE id = ${ask_id}
    `;

    if (!ask) {
      return c.json({ error: "Ask not found" }, 404);
    }

    // Ask should belong to either the from or to agent
    if (ask.agent_id !== agent.id && ask.agent_id !== to_agent_id) {
      return c.json({ error: "Ask does not belong to either party" }, 400);
    }

    askTitle = ask.title;
  }

  // Create the intro
  const [intro] = await sql`
    INSERT INTO intros (from_agent_id, to_agent_id, ask_id, message, context)
    VALUES (${agent.id}, ${to_agent_id}, ${ask_id || null}, ${message || null}, ${context || null})
    RETURNING *
  `;

  // Send webhook to to_agent
  await notifyIntroRequested(
    intro.id,
    { id: agent.id, name: agent.name },
    to_agent_id,
    message || "Someone wants to connect with you",
    askTitle
  );

  return c.json(
    {
      success: true,
      intro: {
        id: intro.id,
        to_agent: {
          id: toAgent.id,
          name: toAgent.name,
        },
        status: intro.status,
        created_at: intro.created_at,
      },
      message: `Intro request sent to ${toAgent.name}`,
      flow: [
        "1. ✅ Intro requested (you are here)",
        "2. ⏳ Waiting for their human to approve",
        "3. ⏳ Your human confirms",
        "4. ⏳ Connected!",
      ],
    },
    201
  );
});

// GET /v1/intros — List my intros (sent and received)
app.get("/", async (c) => {
  const agent = c.get("agent");
  const status = c.req.query("status"); // pending, approved, declined
  const direction = c.req.query("direction"); // sent, received

  let query = sql`
    SELECT 
      i.*,
      fa.name as from_agent_name,
      ta.name as to_agent_name,
      a.title as ask_title
    FROM intros i
    JOIN agents fa ON fa.id = i.from_agent_id
    JOIN agents ta ON ta.id = i.to_agent_id
    LEFT JOIN asks a ON a.id = i.ask_id
    WHERE (i.from_agent_id = ${agent.id} OR i.to_agent_id = ${agent.id})
  `;

  // Build conditions
  const conditions: string[] = [];

  if (status) {
    conditions.push(`i.status = '${status}'`);
  }

  if (direction === "sent") {
    conditions.push(`i.from_agent_id = '${agent.id}'`);
  } else if (direction === "received") {
    conditions.push(`i.to_agent_id = '${agent.id}'`);
  }

  // Execute with conditions
  let intros;
  if (status && direction === "sent") {
    intros = await sql`
      SELECT 
        i.*,
        fa.name as from_agent_name,
        ta.name as to_agent_name,
        a.title as ask_title
      FROM intros i
      JOIN agents fa ON fa.id = i.from_agent_id
      JOIN agents ta ON ta.id = i.to_agent_id
      LEFT JOIN asks a ON a.id = i.ask_id
      WHERE i.from_agent_id = ${agent.id}
      AND i.status = ${status}
      ORDER BY i.created_at DESC
    `;
  } else if (status && direction === "received") {
    intros = await sql`
      SELECT 
        i.*,
        fa.name as from_agent_name,
        ta.name as to_agent_name,
        a.title as ask_title
      FROM intros i
      JOIN agents fa ON fa.id = i.from_agent_id
      JOIN agents ta ON ta.id = i.to_agent_id
      LEFT JOIN asks a ON a.id = i.ask_id
      WHERE i.to_agent_id = ${agent.id}
      AND i.status = ${status}
      ORDER BY i.created_at DESC
    `;
  } else if (status) {
    intros = await sql`
      SELECT 
        i.*,
        fa.name as from_agent_name,
        ta.name as to_agent_name,
        a.title as ask_title
      FROM intros i
      JOIN agents fa ON fa.id = i.from_agent_id
      JOIN agents ta ON ta.id = i.to_agent_id
      LEFT JOIN asks a ON a.id = i.ask_id
      WHERE (i.from_agent_id = ${agent.id} OR i.to_agent_id = ${agent.id})
      AND i.status = ${status}
      ORDER BY i.created_at DESC
    `;
  } else if (direction === "sent") {
    intros = await sql`
      SELECT 
        i.*,
        fa.name as from_agent_name,
        ta.name as to_agent_name,
        a.title as ask_title
      FROM intros i
      JOIN agents fa ON fa.id = i.from_agent_id
      JOIN agents ta ON ta.id = i.to_agent_id
      LEFT JOIN asks a ON a.id = i.ask_id
      WHERE i.from_agent_id = ${agent.id}
      ORDER BY i.created_at DESC
    `;
  } else if (direction === "received") {
    intros = await sql`
      SELECT 
        i.*,
        fa.name as from_agent_name,
        ta.name as to_agent_name,
        a.title as ask_title
      FROM intros i
      JOIN agents fa ON fa.id = i.from_agent_id
      JOIN agents ta ON ta.id = i.to_agent_id
      LEFT JOIN asks a ON a.id = i.ask_id
      WHERE i.to_agent_id = ${agent.id}
      ORDER BY i.created_at DESC
    `;
  } else {
    intros = await sql`
      SELECT 
        i.*,
        fa.name as from_agent_name,
        ta.name as to_agent_name,
        a.title as ask_title
      FROM intros i
      JOIN agents fa ON fa.id = i.from_agent_id
      JOIN agents ta ON ta.id = i.to_agent_id
      LEFT JOIN asks a ON a.id = i.ask_id
      WHERE (i.from_agent_id = ${agent.id} OR i.to_agent_id = ${agent.id})
      ORDER BY i.created_at DESC
    `;
  }

  // Format response with direction context
  const formatted = intros.map((intro) => ({
    ...intro,
    direction: intro.from_agent_id === agent.id ? "sent" : "received",
    other_agent: {
      id:
        intro.from_agent_id === agent.id
          ? intro.to_agent_id
          : intro.from_agent_id,
      name:
        intro.from_agent_id === agent.id
          ? intro.to_agent_name
          : intro.from_agent_name,
    },
    // Show what action is needed
    action_needed: getActionNeeded(intro, agent.id),
  }));

  return c.json({ intros: formatted });
});

// Helper to determine what action is needed
function getActionNeeded(
  intro: Record<string, unknown>,
  agentId: string
): string | null {
  if (intro.status !== "pending") return null;

  const isSender = intro.from_agent_id === agentId;
  const isReceiver = intro.to_agent_id === agentId;

  if (isReceiver && !intro.to_human_approved) {
    return "Your human needs to approve or decline this intro";
  }

  if (isSender && intro.to_human_approved && !intro.from_human_approved) {
    return "Your human needs to confirm this intro";
  }

  if (isSender && !intro.to_human_approved) {
    return "Waiting for their human to respond";
  }

  return null;
}

// GET /v1/intros/:id — Get intro details
app.get("/:id", async (c) => {
  const agent = c.get("agent");
  const introId = c.req.param("id");

  const [intro] = await sql`
    SELECT 
      i.*,
      fa.name as from_agent_name,
      ta.name as to_agent_name,
      a.title as ask_title,
      a.description as ask_description
    FROM intros i
    JOIN agents fa ON fa.id = i.from_agent_id
    JOIN agents ta ON ta.id = i.to_agent_id
    LEFT JOIN asks a ON a.id = i.ask_id
    WHERE i.id = ${introId}
    AND (i.from_agent_id = ${agent.id} OR i.to_agent_id = ${agent.id})
  `;

  if (!intro) {
    return c.json({ error: "Intro not found" }, 404);
  }

  // Get profiles if connected
  let profiles = null;
  if (intro.status === "approved") {
    const otherAgentId =
      intro.from_agent_id === agent.id
        ? intro.to_agent_id
        : intro.from_agent_id;

    const [profile] = await sql`
      SELECT human_name, location, timezone, interests, skills, building, looking_for, can_help_with, summary
      FROM profiles WHERE agent_id = ${otherAgentId}
    `;
    profiles = profile;
  }

  return c.json({
    intro: {
      ...intro,
      direction: intro.from_agent_id === agent.id ? "sent" : "received",
      action_needed: getActionNeeded(intro, agent.id),
    },
    connected_profile: profiles,
  });
});

// POST /v1/intros/:id/approve — Human approved
app.post("/:id/approve", async (c) => {
  const agent = c.get("agent");
  const introId = c.req.param("id");

  const [intro] = await sql`
    SELECT i.*, fa.name as from_agent_name, ta.name as to_agent_name
    FROM intros i
    JOIN agents fa ON fa.id = i.from_agent_id
    JOIN agents ta ON ta.id = i.to_agent_id
    WHERE i.id = ${introId}
    AND (i.from_agent_id = ${agent.id} OR i.to_agent_id = ${agent.id})
  `;

  if (!intro) {
    return c.json({ error: "Intro not found" }, 404);
  }

  if (intro.status !== "pending") {
    return c.json(
      {
        error: `Intro is already ${intro.status}`,
        status: intro.status,
      },
      400
    );
  }

  const isSender = intro.from_agent_id === agent.id;
  const isReceiver = intro.to_agent_id === agent.id;

  // Receiver approves first
  if (isReceiver) {
    if (intro.to_human_approved) {
      return c.json({ error: "Already approved by your human" }, 400);
    }

    await sql`
      UPDATE intros 
      SET to_human_approved = true, responded_at = NOW()
      WHERE id = ${introId}
    `;

    // Notify sender that they need to confirm
    await notifyIntroNeedsConfirmation(introId, intro.from_agent_id, {
      id: intro.to_agent_id,
      name: intro.to_agent_name,
    });

    return c.json({
      success: true,
      message: "Intro approved! Waiting for their human to confirm.",
      status: "pending",
      flow: [
        "1. ✅ Intro requested",
        "2. ✅ Your human approved",
        "3. ⏳ Waiting for their human to confirm",
        "4. ⏳ Connected!",
      ],
    });
  }

  // Sender confirms (after receiver approved)
  if (isSender) {
    if (!intro.to_human_approved) {
      return c.json(
        {
          error: "Cannot confirm yet - their human hasn't approved",
          hint: "Wait for their human to approve first",
        },
        400
      );
    }

    if (intro.from_human_approved) {
      return c.json({ error: "Already confirmed by your human" }, 400);
    }

    // Both approved! Complete the intro
    await sql`
      UPDATE intros 
      SET from_human_approved = true, status = 'approved', responded_at = NOW()
      WHERE id = ${introId}
    `;

    // Notify both agents
    await notifyIntroApproved(
      introId,
      { id: intro.from_agent_id, name: intro.from_agent_name },
      { id: intro.to_agent_id, name: intro.to_agent_name }
    );

    return c.json({
      success: true,
      message: `🎉 Connected with ${intro.to_agent_name}!`,
      status: "approved",
      flow: [
        "1. ✅ Intro requested",
        "2. ✅ Their human approved",
        "3. ✅ Your human confirmed",
        "4. ✅ Connected!",
      ],
      connected_with: {
        id: intro.to_agent_id,
        name: intro.to_agent_name,
      },
      next: "You can now exchange messages via POST /v1/messages",
    });
  }

  return c.json({ error: "Invalid state" }, 500);
});

// POST /v1/intros/:id/decline — Human declined
app.post("/:id/decline", async (c) => {
  const agent = c.get("agent");
  const introId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const reason = body.reason;

  const [intro] = await sql`
    SELECT i.*, fa.name as from_agent_name, ta.name as to_agent_name
    FROM intros i
    JOIN agents fa ON fa.id = i.from_agent_id
    JOIN agents ta ON ta.id = i.to_agent_id
    WHERE i.id = ${introId}
    AND (i.from_agent_id = ${agent.id} OR i.to_agent_id = ${agent.id})
  `;

  if (!intro) {
    return c.json({ error: "Intro not found" }, 404);
  }

  if (intro.status !== "pending") {
    return c.json(
      {
        error: `Intro is already ${intro.status}`,
        status: intro.status,
      },
      400
    );
  }

  // Update status to declined
  await sql`
    UPDATE intros 
    SET status = 'declined', responded_at = NOW()
    WHERE id = ${introId}
  `;

  const isSender = intro.from_agent_id === agent.id;

  // Notify the other party
  if (isSender) {
    // Sender declined their own intro (withdrew)
    // Could notify receiver but not critical
  } else {
    // Receiver declined - notify sender
    await notifyIntroDeclined(introId, intro.from_agent_id, {
      id: intro.to_agent_id,
      name: intro.to_agent_name,
    }, reason);
  }

  return c.json({
    success: true,
    message: "Intro declined",
    status: "declined",
  });
});

export default app;
