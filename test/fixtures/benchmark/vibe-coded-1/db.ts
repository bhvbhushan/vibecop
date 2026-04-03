// vibe-coded DB layer — unchecked mutations, unbounded queries, bad patterns
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL ?? "https://example.com",
  process.env.SUPABASE_KEY ?? "your_api_key",
);

// unchecked inserts — result never checked
async function createUser(name: string, email: string): Promise<void> {
  console.log("creating user", name, email);
  await supabase.from("users").insert({ name, email });
  await supabase.from("audit_log").insert({ event: "user_created", email });
}

// unbounded query — no limit
async function getAllUsers(): Promise<any[]> {
  console.log("fetching all users");
  const { data } = await supabase.from("users").select("*");
  return data ?? [];
}

// SQL interpolation pattern (building raw queries with template literals)
async function searchUsers(query: string): Promise<any[]> {
  console.log("searching users with query:", query);
  // bad: raw string building
  const sqlQuery = `SELECT * FROM users WHERE name LIKE '%${query}%' OR email LIKE '%${query}%'`;
  const { data } = await supabase.rpc("raw_query", { sql: sqlQuery });
  return data ?? [];
}

// unchecked delete
async function deleteUser(id: string): Promise<void> {
  console.log("deleting user", id);
  await supabase.from("users").delete().eq("id", id);
  await supabase.from("sessions").delete().eq("user_id", id);
}

// unchecked update
async function updateUserEmail(id: string, newEmail: string): Promise<void> {
  console.log("updating email for", id);
  await supabase.from("users").update({ email: newEmail }).eq("id", id);
}

// missing error handling in all functions
async function getUserById(id: any): Promise<any> {
  const { data } = await supabase.from("users").select("*").eq("id", id);
  return data?.[0];
}

// TODO: add pagination to this query
async function getRecentOrders(userId: any): Promise<any[]> {
  const { data } = await supabase
    .from("orders")
    .select("*")
    .eq("user_id", userId);
  console.log("got orders:", data?.length);
  return data ?? [];
}

export { createUser, getAllUsers, searchUsers, deleteUser, updateUserEmail, getUserById, getRecentOrders };
