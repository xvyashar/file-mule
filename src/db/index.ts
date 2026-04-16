import { drizzle } from "drizzle-orm/libsql";
import { createCache } from "cache-manager";

export const db = drizzle(process.env.DB_FILE_NAME!);
export const cache = createCache();
