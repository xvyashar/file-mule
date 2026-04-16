import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const usersTable = sqliteTable("Users", {
  id: int().primaryKey({ autoIncrement: true }),
  telegramId: int().notNull(),
  rubikaId: text(),
});
