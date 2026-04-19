import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const usersTable = sqliteTable("Users", {
  id: int().primaryKey({ autoIncrement: true }),
  telegramId: int().notNull().unique(),
  irSocial: text().notNull(),
  irSocialId: text(),
});

export const statesTable = sqliteTable("States", {
  key: text().primaryKey(),
  value: text(),
});

export const queueTable = sqliteTable("Queue", {
  id: int().primaryKey({ autoIncrement: true }),
  userTg: int().notNull(),
  fileHash: text(),
  chunks: int(),
  completedChunks: int().default(0),
  lastChunkStatus: text().default("NOT-STARTED"),
  addresses: text().default(""),
});
