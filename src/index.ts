import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import agents from "./routes/agents";
import profile from "./routes/profile";
import asks from "./routes/asks";
import intros from "./routes/intros";
import health from "./routes/health";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", cors());

// Routes
app.route("/v1/agents", agents);
app.route("/v1/profile", profile);
app.route("/v1/asks", asks);
app.route("/v1/intros", intros);
app.route("/health", health);

// Root
app.get("/", (c) => c.json({ 
  name: "Cove API",
  version: "0.1.0",
  docs: "https://cove.sh/docs"
}));

const port = process.env.PORT || 3000;
console.log(`🏝️  Cove API running on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
