import postgres from "postgres";

const connectionString = process.env.DATABASE_URL || "postgres://localhost:5432/cove";

export const sql = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export default sql;
