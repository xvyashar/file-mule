import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { ChunkStatus } from '../types/index.js';

export const usersTable = sqliteTable('Users', {
  id: int().primaryKey({ autoIncrement: true }),
  telegramId: int().notNull().unique(),
  irSocial: text().notNull(),
  irSocialId: text(),
});

export const statesTable = sqliteTable('States', {
  key: text().primaryKey(),
  value: text(),
});

export const queueTable = sqliteTable('Queue', {
  id: int().primaryKey({ autoIncrement: true }),
  userTg: int().notNull(),
  fileType: text().notNull(),
  fileHash: text().notNull(),
  filePassword: text(),
  chunks: int().default(1),
  completedChunks: int().default(0),
  lastChunkStatus: text().default(ChunkStatus['NOT-STARTED']),
  addresses: text().default(''),
  lastTouched: text().notNull(),
});
