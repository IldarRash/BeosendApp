export * as schema from "./schema";
export { schema as tables } from "./schema";
export { createDb } from "./client";
export type { Database } from "./client";
// Re-export the query operators repositories need so apps/api goes through
// @beosand/db only (drizzle-orm is not a direct api dependency).
export { asc, eq } from "drizzle-orm";
