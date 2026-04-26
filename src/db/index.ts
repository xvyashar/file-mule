import { drizzle } from 'drizzle-orm/libsql';
import { createCache } from 'cache-manager';

export const db = drizzle('file:data/primary.db');
export const cache = createCache();
