import postgres from "postgres";

const connectionString = process.env.DATABASE_URL || "postgres://localhost:5432/cove";

// Detect if we're using Supabase (supabase.co in URL or supabase pooler)
const isSupabase = connectionString.includes('supabase.co') || 
                   connectionString.includes('pooler.supabase.com');

export const sql = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  // SSL required for Supabase connections
  ssl: isSupabase ? 'require' : false,
  // Supabase pooler needs this for prepared statements
  prepare: isSupabase ? false : true,
});

export default sql;
