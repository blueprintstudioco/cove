import { Hono } from "hono";
import { handle } from "@hono/node-server/vercel";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import agents from "../src/routes/agents";
import profile from "../src/routes/profile";
import asks from "../src/routes/asks";
import intros from "../src/routes/intros";
import health from "../src/routes/health";

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

export default handle(app);
