import { Hono } from "hono";
import sql from "../lib/db";

const app = new Hono();

app.get("/", async (c) => {
  try {
    await sql`SELECT 1`;
    return c.json({ status: "ok", db: "connected" });
  } catch (e) {
    return c.json({ status: "degraded", db: "disconnected" }, 503);
  }
});

export default app;
