import { bot } from "./index.js";
import { db, cache } from "../db/index.js";
import { usersTable } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";

export function registerCommands() {
  bot.command("start", async (ctx) => {
    const user = (
      await db
        .select({ rubikaId: usersTable.rubikaId })
        .from(usersTable)
        .where(eq(usersTable.telegramId, ctx.from?.id!))
    )[0];

    if (!user) {
      if (
        !(await cache.get<string[]>("allowedUsers"))!.includes(
          ctx.from?.id.toString()!,
        )
      ) {
        ctx.reply("Sorry! This is a private bot. You can't use it!", {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
        return;
      }

      await db.insert(usersTable).values({ telegramId: ctx.from?.id! });
    }

    if (!user?.rubikaId) {
      const reqId =
        (await cache.get<string>(`link_req:${ctx.from?.id}`)) ?? ulid();
      cache.set(`link_req:${ctx.from?.id}`, reqId, 60000);
      cache.set(`link_id:${reqId}`, ctx.from?.id, 60000);

      ctx.reply(
        `Link your account to your rubika account by sending:\n\`/link ${reqId}\``,
        {
          parse_mode: "MarkdownV2",
          reply_parameters: { message_id: ctx.msg.message_id },
        },
      );

      return;
    }

    ctx.reply("You're ready to go!", {
      reply_parameters: { message_id: ctx.msg.message_id },
    });
  });
}
