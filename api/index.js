// Simple Node.js serverless function for Vercel
const { Hono } = require("hono");
const { handle } = require("@hono/node-server/vercel");

const app = new Hono();

// CORS middleware
app.use("*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (c.req.method === "OPTIONS") {
    return c.text("", 204);
  }
  await next();
});

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Root
app.get("/", (c) => c.json({ 
  name: "Cove API",
  version: "0.1.0"
}));

module.exports = handle(app);
