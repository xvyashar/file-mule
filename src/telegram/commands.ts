import { bot } from "./index.js";
import { db, cache } from "../db/index.js";
import { queueTable, usersTable } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import fs, { createWriteStream } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { pipeline } from "stream/promises";
import got from "got";
import { createHash } from "node:crypto";
import { InlineKeyboard } from "grammy";
import path from "node:path";
import { spawn } from "node:child_process";
import { BaleAdaptor } from "../ir-socials/bale.adaptor.js";
import { RubikaAdaptor } from "../ir-socials/rk.adaptor.js";

export async function registerCommands() {
  bot.command("start", async (ctx) => {
    try {
      if (!ctx.from) throw new Error("ctx.from does not exist");

      if (!(await isValidUser(ctx.from.id.toString())))
        return ctx.reply("Sorry! This is a private bot. You can't use it!", {
          reply_parameters: { message_id: ctx.msg.message_id },
        });

      const user = (
        await db
          .select({ irSocialId: usersTable.irSocialId })
          .from(usersTable)
          .where(eq(usersTable.telegramId, ctx.from?.id!))
      )[0];

      if (!user?.irSocialId)
        return ctx.reply(
          "In order to use this bot you should link your telegram account to either your bale or your rubika account.\nPlease choose one of them:",
          {
            reply_parameters: { message_id: ctx.msg.message_id },
            reply_markup: makeIRSocialChoiceKeyboard(),
          },
        );

      ctx.reply("You're ready to go!", {
        reply_parameters: { message_id: ctx.msg.message_id },
      });
    } catch (error: any) {
      ctx.reply(
        `Something went wrong!\n\`\`\`plain\n${error.stack ?? error}\n\`\`\``,
        {
          parse_mode: "MarkdownV2",
          reply_parameters: { message_id: ctx.msg.message_id },
        },
      );
    }
  });

  bot.command("relink", async (ctx) => {
    try {
      if (!ctx.from) throw new Error("ctx.from does not exist");

      if (
        !(await isValidUser(ctx.from.id.toString()!)) ||
        !(await isUserLinked(ctx.from.id))
      )
        return;

      await db
        .update(usersTable)
        .set({ irSocialId: null })
        .where(eq(usersTable.telegramId, ctx.from.id));

      ctx.reply(
        "In order to use this bot you should link your telegram account to either your bale or your rubika account.\nPlease choose one of them:",
        {
          reply_parameters: { message_id: ctx.msg.message_id },
          reply_markup: makeIRSocialChoiceKeyboard(),
        },
      );
    } catch (error: any) {
      ctx.reply(
        `Something went wrong!\n\`\`\`plain\n${error.stack ?? error}\n\`\`\``,
        {
          parse_mode: "MarkdownV2",
          reply_parameters: { message_id: ctx.msg.message_id },
        },
      );
    }
  });

  bot.command("ping_bale", async (ctx) => {
    const pingMsg = await ctx.reply("Pinging...", {
      reply_parameters: { message_id: ctx.msg.message_id },
    });

    const result = await BaleAdaptor.getInstance().httpPing();

    bot.api.editMessageText(
      ctx.chatId,
      pingMsg.message_id,
      `${emojifyStatusCode(result)} Ping Result: ${result}`,
    );
  });

  bot.command("ping_rubika", async (ctx) => {
    const pingMsg = await ctx.reply("Pinging...", {
      reply_parameters: { message_id: ctx.msg.message_id },
    });

    const result = await RubikaAdaptor.getInstance().httpPing();

    bot.api.editMessageText(
      ctx.chatId,
      pingMsg.message_id,
      `${emojifyStatusCode(result)} Ping Result: ${result}`,
    );
  });

  bot.command("queue", async (ctx) => {
    try {
      if (!ctx.from) throw new Error("ctx.from does not exist");

      if (
        !(await isValidUser(ctx.from.id.toString()!)) ||
        !(await isUserLinked(ctx.from.id))
      )
        return;

      const userQueue = await db
        .select({ fileHash: queueTable.fileHash })
        .from(queueTable)
        .where(eq(queueTable.userTg, ctx.from.id))
        .limit(10);

      let replyMsg = `*Upload Queue*\n\n${escapeMarkdownV2("----------")}`;
      if (!userQueue.length) replyMsg += "\n_empty list_";
      else
        for (const item of userQueue) {
          replyMsg += `\n🆔 \`${escapeMarkdownV2(item.fileHash!)}\``;
        }
      replyMsg += `\n${escapeMarkdownV2("----------")}\n\nTo process an item in queue send \`/queue_item {ITEM_ID}\` command\\.`;

      ctx.reply(
        replyMsg,
        userQueue.length >= 10
          ? {
              parse_mode: "MarkdownV2",
              reply_markup: makeQueueListKeyboard(0, true),
            }
          : {
              parse_mode: "MarkdownV2",
            },
      );
    } catch (error: any) {
      ctx.reply(
        `Something went wrong!\n\`\`\`plain\n${error.stack ?? error}\n\`\`\``,
        {
          parse_mode: "MarkdownV2",
          reply_parameters: { message_id: ctx.msg.message_id },
        },
      );
    }
  });

  bot.command("queue_item", async (ctx) => {
    try {
      if (!ctx.from) throw new Error("ctx.from does not exist");

      if (
        !(await isValidUser(ctx.from.id.toString()!)) ||
        !(await isUserLinked(ctx.from.id))
      )
        return;

      const [_command, hash] = ctx.message?.text.split(" ")!;

      if (!hash)
        return ctx.reply(
          "Provide an item id after this command like this:\n`/queue_item {ITEM_ID}`",
          {
            parse_mode: "MarkdownV2",
            reply_parameters: { message_id: ctx.msg.message_id },
          },
        );

      const item = (
        await db
          .select({
            addresses: queueTable.addresses,
            completedChunks: queueTable.completedChunks,
            lastChunkStatus: queueTable.lastChunkStatus,
          })
          .from(queueTable)
          .where(
            and(
              eq(queueTable.userTg, ctx.from.id),
              eq(queueTable.fileHash, hash!),
            ),
          )
      )[0];
      if (!item)
        throw new Error(`item does not exist in db: ${ctx.from.id}:${hash}`);

      const files = item.addresses?.split(",")!;
      let completedCounter = item.completedChunks || 0;
      let uploadMsg = `${item.lastChunkStatus === "UPLOADING" ? "*Uploading\\.\\.\\.*" : "*Ready to upload\\!*"}\n\nChunks:`;
      for (let i = 0; i < files.length; i++) {
        uploadMsg += escapeMarkdownV2(
          `\n${completedCounter-- > 0 ? "🟢" : i == item.completedChunks ? getChunkStatusCharacter(item.lastChunkStatus!) : "⚪️"} - ${path.basename(files[i]!)}`,
        );
      }

      return ctx.reply(uploadMsg, {
        parse_mode: "MarkdownV2",
        reply_markup: makeUploadKeyboard(
          hash!,
          item.lastChunkStatus != "UPLOADING",
          item.lastChunkStatus == "FAILED",
        ),
      });
    } catch (error: any) {
      ctx.reply(
        `Something went wrong!\n\`\`\`plain\n${error.stack ?? error}\n\`\`\``,
        {
          parse_mode: "MarkdownV2",
          reply_parameters: { message_id: ctx.msg.message_id },
        },
      );
    }
  });

  bot.api.setMyCommands([
    {
      command: "relink",
      description:
        "Relink your telegram account with either your bale or your rubika account",
    },
    {
      command: "ping_bale",
      description: "HTTP ping bale api to see if its reachable",
    },
    {
      command: "ping_rubika",
      description: "HTTP ping rubika api to see if its reachable",
    },
    { command: "queue", description: "Shows your pending uploads queue" },
    { command: "queue_item", description: "Manage an item in the queue" },
  ]);

  bot.on("message:entities:url", async (ctx) => {
    let currentHash;
    try {
      if (
        !(await isValidUser(ctx.from.id.toString()!)) ||
        !(await isUserLinked(ctx.from.id))
      )
        return;

      if (!isValidURL(ctx.message.text))
        return ctx.reply("Not a valid url!", {
          reply_parameters: { message_id: ctx.message.message_id },
        });

      const hash = await md5(ctx.message.text);

      const isInQueue = (
        await db
          .select({ id: queueTable.id })
          .from(queueTable)
          .where(
            and(
              eq(queueTable.userTg, ctx.from.id),
              eq(queueTable.fileHash, hash),
            ),
          )
      )[0]?.id!!;
      if (isInQueue)
        return ctx.reply(
          "This link exists in the queue without finishing its process!",
          {
            reply_parameters: { message_id: ctx.message.message_id },
          },
        );

      const reply = await ctx.reply("Retrieving link metadata...", {
        reply_parameters: { message_id: ctx.msg.message_id },
      });

      let metadata: {
        contentLength: number;
        contentType: string;
      };
      try {
        metadata = await getUrlMetadata(ctx.message.text).finally(() => {
          return bot.api.deleteMessage(ctx.chatId, reply.message_id);
        });
      } catch (error: any) {
        if (error.message?.startsWith("❌"))
          return ctx.reply(error.message, {
            reply_parameters: { message_id: ctx.msg.message_id },
          });

        throw error;
      }

      const irSocial = getUserIRSocial(ctx.from.id) as unknown as
        | "bale"
        | "rubika";
      const chunkSize =
        parseInt(
          irSocial === "bale"
            ? process.env.BALE_FILE_CHUNK_SIZE!
            : process.env.RK_FILE_CHUNK_SIZE!,
        ) *
        1024 *
        1024;
      const chunksCount = Math.ceil(metadata.contentLength / chunkSize);

      await cache.set(`downReqOptions:${ctx.from.id}:${hash}`, {
        compression: true,
        url: ctx.message.text,
        metadata,
        chunksCount,
      });

      currentHash = hash;

      ctx.reply(
        `*URL Download Request:*\n\n🆔 *Name*: ${escapeMarkdownV2(hash)}\n📂 *Mimetype*: ${escapeMarkdownV2(metadata.contentType!)}\n📏 *Potential Size*: ${escapeMarkdownV2(formatFileSize(metadata.contentLength))}\n📐 *Chunk Size*: ${escapeMarkdownV2(formatFileSize(chunkSize))}\n🧩 *Potential File Chunks*: ${chunksCount}`,
        {
          parse_mode: "MarkdownV2",
          reply_parameters: { message_id: ctx.message.message_id },
          reply_markup: makeRequestKeyboard(hash, true, chunksCount > 1),
        },
      );
    } catch (error: any) {
      if (currentHash)
        cache.del(`downReqOptions:${ctx.from.id}:${currentHash}`);
      ctx.reply(
        `Something went wrong\\!\n\`\`\`plain\n${error.stack ?? error}\n\`\`\``,
        {
          parse_mode: "MarkdownV2",
          reply_parameters: { message_id: ctx.message.message_id },
        },
      );
    }
  });

  bot.on("message:file", async (ctx) => {
    let currentHash = "";
    try {
      if (
        !(await isValidUser(ctx.from.id.toString()!)) ||
        !(await isUserLinked(ctx.from.id))
      )
        return;

      const fileObj =
        ctx.msg.document ||
        ctx.msg.photo?.[0] ||
        ctx.msg.video ||
        ctx.msg.audio ||
        ctx.msg.voice ||
        ctx.msg.video_note ||
        ctx.msg.animation ||
        ctx.msg.sticker;

      if (!fileObj)
        return ctx.reply("❌ Something went wrong!\nUnsupported file type");

      if (!fileObj.file_size)
        return ctx.reply("❌ Something went wrong!\nNo metadata provided");

      const fileSizeLimit =
        parseInt(process.env.TG_FILE_SIZE_LIMIT!) * 1024 * 1024;

      if (fileObj.file_size > fileSizeLimit)
        return ctx.reply(
          `❌ Your file is too big you can only download files under ${process.env.TG_FILE_SIZE_LIMIT} MB`,
        );

      const hash = await md5(fileObj.file_unique_id);

      const isInQueue = !!(
        await db
          .select({ id: queueTable.id })
          .from(queueTable)
          .where(
            and(
              eq(queueTable.userTg, ctx.from.id),
              eq(queueTable.fileHash, hash),
            ),
          )
      )[0]?.id;
      if (isInQueue)
        return ctx.reply(
          "This link exists in the queue without finishing its process!",
          {
            reply_parameters: { message_id: ctx.message.message_id },
          },
        );

      const localMode = process.env.LOCAL_MODE == "true";
      const irSocial = getUserIRSocial(ctx.from.id) as unknown as
        | "bale"
        | "rubika";
      const chunkSize =
        parseInt(
          irSocial === "bale"
            ? process.env.BALE_FILE_CHUNK_SIZE!
            : process.env.RK_FILE_CHUNK_SIZE!,
        ) *
        1024 *
        1024;
      const chunksCount = Math.ceil(fileObj.file_size / chunkSize);

      await cache.set(`downReqOptions:${ctx.from.id}:${hash}`, {
        compression: true,
        localMode,
        fileId: fileObj.file_id,
        metadata: {
          contentLength: fileObj.file_size,
        },
        chunksCount,
      });

      currentHash = hash;

      ctx.reply(
        `*Telegram Download Request:*\n\n🆔 *Name*: ${escapeMarkdownV2(hash)}\n📏 *Potential Size*: ${escapeMarkdownV2(formatFileSize(fileObj.file_size))}\n📐 *Chunk Size*: ${escapeMarkdownV2(formatFileSize(chunkSize))}\n🧩 *Potential File Chunks*: ${chunksCount}`,
        {
          parse_mode: "MarkdownV2",
          reply_parameters: { message_id: ctx.message.message_id },
          reply_markup: makeRequestKeyboard(hash, true, chunksCount > 1),
        },
      );
    } catch (error: any) {
      if (currentHash)
        cache.del(`downReqOptions:${ctx.from.id}:${currentHash}`);

      ctx.reply(
        `Something went wrong\\!\n\`\`\`plain\n${error.stack ?? error}\n\`\`\``,
        {
          parse_mode: "MarkdownV2",
          reply_parameters: { message_id: ctx.message.message_id },
        },
      );
    }
  });

  bot.callbackQuery("forceCompression", (ctx) => {
    return ctx.answerCallbackQuery({
      show_alert: true,
      text: "It's a large file, compression is unavoidable!",
    });
  });

  bot.callbackQuery("linkReqBale", async (ctx) => {
    try {
      await ctx.answerCallbackQuery();

      if (!(await isValidUser(ctx.from.id.toString()!))) return;

      const userExist = !!(
        await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.telegramId, ctx.from.id))
      )[0];

      if (userExist)
        await db
          .update(usersTable)
          .set({ irSocial: "bale" })
          .where(eq(usersTable.telegramId, ctx.from.id));
      else
        await db
          .insert(usersTable)
          .values({ telegramId: ctx.from?.id!, irSocial: "bale" });

      const reqId =
        (await cache.get<string>(`baleLinkReq:${ctx.from?.id}`)) ?? ulid();
      cache.set(`baleLinkReq:${ctx.from?.id}`, reqId, 60000);
      cache.set(`baleLinkId:${reqId}`, ctx.from?.id, 60000);

      bot.api.editMessageText(
        ctx.chatId!,
        ctx.callbackQuery.message?.message_id!,
        `Link your account to your bale account by sending this command in bale bot:\n\`/link ${reqId}\``,
        {
          parse_mode: "MarkdownV2",
          reply_markup: new InlineKeyboard(),
        },
      );
    } catch (error: any) {
      bot.api.editMessageText(
        ctx.chatId!,
        ctx.callbackQuery.message?.message_id!,
        `Something went wrong\\!\n\`\`\`${escapeMarkdownV2(error.stack ?? error)}\n\`\`\``,
        { parse_mode: "MarkdownV2", reply_markup: new InlineKeyboard() },
      );
    }
  });

  bot.callbackQuery("linkReqRubika", async (ctx) => {
    try {
      await ctx.answerCallbackQuery();

      if (!(await isValidUser(ctx.from.id.toString()!))) return;

      const userExist = !!(
        await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.telegramId, ctx.from.id))
      )[0];

      if (userExist)
        await db
          .update(usersTable)
          .set({ irSocial: "rubika" })
          .where(eq(usersTable.telegramId, ctx.from.id));
      else
        await db
          .insert(usersTable)
          .values({ telegramId: ctx.from.id, irSocial: "rubika" });

      const reqId =
        (await cache.get<string>(`rkLinkReq:${ctx.from?.id}`)) ?? ulid();
      cache.set(`rkLinkReq:${ctx.from?.id}`, reqId, 60000);
      cache.set(`rkLinkId:${reqId}`, ctx.from?.id, 60000);

      bot.api.editMessageText(
        ctx.chatId!,
        ctx.callbackQuery.message?.message_id!,
        `Link your account to your rubika account by sending this command in rubika bot:\n\`/link ${reqId}\``,
        {
          parse_mode: "MarkdownV2",
          reply_markup: new InlineKeyboard(),
        },
      );
    } catch (error: any) {
      bot.api.editMessageText(
        ctx.chatId!,
        ctx.callbackQuery.message?.message_id!,
        `Something went wrong\\!\n\`\`\`${escapeMarkdownV2(error.stack ?? error)}\n\`\`\``,
        { parse_mode: "MarkdownV2", reply_markup: new InlineKeyboard() },
      );
    }
  });

  bot.on("callback_query:data", async (ctx) => {
    let currentHash = "";
    let currentFile = "";
    try {
      await ctx.answerCallbackQuery();

      if (
        !(await isValidUser(ctx.from.id.toString()!)) ||
        !(await isUserLinked(ctx.from.id))
      )
        return;

      if (ctx.callbackQuery.data.startsWith("toggleCompression")) {
        const [_command, hash] = ctx.callbackQuery.data.split(":");
        currentHash = hash!;
        const ops = (await cache.get(
          `downReqOptions:${ctx.from.id}:${hash}`,
        )) as any;
        ops.compression = !ops.compression;
        await cache.set(`downReqOptions:${ctx.from.id}:${hash}`, ops);

        await bot.api.editMessageReplyMarkup(
          ctx.chatId!,
          ctx.callbackQuery.message?.message_id!,
          {
            reply_markup: makeRequestKeyboard(hash!, ops.compression, false),
          },
        );

        return;
      }

      if (ctx.callbackQuery.data.startsWith("cancelReq")) {
        const [_command, hash] = ctx.callbackQuery.data.split(":");
        await cache.del(`downReqOptions:${ctx.from.id}:${hash}`);
        currentHash = hash!;

        await bot.api.editMessageText(
          ctx.chatId!,
          ctx.callbackQuery.message?.message_id!,
          "❌ Request has been canceled!",
          { reply_markup: new InlineKeyboard() },
        );

        return;
      }

      if (ctx.callbackQuery.data.startsWith("confirmReq")) {
        const [_command, hash] = ctx.callbackQuery.data.split(":");
        currentHash = hash!;
        const ops = (await cache.get(
          `downReqOptions:${ctx.from.id}:${hash}`,
        )) as any;

        await bot.api.editMessageText(
          ctx.chatId!,
          ctx.callbackQuery.message?.message_id!,
          `Downloading...\n${createProgressBar(0)} ${0}%`,
          { reply_markup: new InlineKeyboard() },
        );

        //* Download Section
        let outPath: string | undefined;
        if (ops.url || !ops.localMode) {
          let url = ops.url;
          if (!url) {
            const { file_path } = await bot.api.getFile(ops.fileId);
            url = `https://api.telegram.org/file/bot${process.env.TG_TOKEN}/${file_path}`;
          }

          let prevPercent = "0";
          outPath = await startDownload(ops.url, hash!, (percent) => {
            let percentStr = percent.toFixed(1);
            if (prevPercent === percentStr) return;
            prevPercent = percentStr;

            if (percent % 5 === 0)
              bot.api.editMessageText(
                ctx.chatId!,
                ctx.callbackQuery.message?.message_id!,
                `Downloading...\n${createProgressBar(percent)} ${percentStr}%`,
              );
          });
        } else {
          const { file_path } = await bot.api.getFile(ops.fileId);
          outPath = file_path;
        }

        if (!outPath) throw new Error("outPath is undefined");
        currentFile = outPath;

        let readyFiles = [outPath];

        //* Compression Section
        if (ops.compression) {
          await bot.api.editMessageText(
            ctx.chatId!,
            ctx.callbackQuery.message?.message_id!,
            "⚙️ Compressing...",
          );

          const irSocial = getUserIRSocial(ctx.from.id) as unknown as
            | "bale"
            | "rubika";
          const chunkSize = parseInt(
            irSocial === "bale"
              ? process.env.BALE_FILE_CHUNK_SIZE!
              : process.env.RK_FILE_CHUNK_SIZE!,
          );
          const compressedDir = path.join(
            outPath,
            "..",
            "..",
            "compressed",
            hash!,
          );
          await compressFile(
            outPath,
            compressedDir,
            chunkSize,
            process.env.COMPRESSED_PASS!,
          );

          await rm(outPath);
          currentFile = compressedDir;

          const files = await readdir(compressedDir);
          for (let i = 0; i < files.length; i++) {
            readyFiles[i] = path.join(compressedDir, files[i]!);
          }
        }

        await db.insert(queueTable).values({
          userTg: ctx.from.id,
          fileHash: hash,
          chunks: readyFiles.length,
          addresses: readyFiles.join(","),
        });

        cache.del(`downReqOptions:${ctx.from.id}:${hash}`);
        currentHash = "";
        currentFile = "";

        await bot.api.deleteMessage(
          ctx.chatId!,
          ctx.callbackQuery.message?.message_id!,
        );

        let uploadMsg = `*Ready to upload\\!*\n\nChunks:`;
        for (const file of readyFiles) {
          uploadMsg += escapeMarkdownV2(`\n⚪️ - ${path.basename(file)}`);
        }

        return ctx.reply(uploadMsg, {
          parse_mode: "MarkdownV2",
          reply_markup: makeUploadKeyboard(hash!, true),
        });
      }

      if (ctx.callbackQuery.data.startsWith("queue")) {
        const [_command, index] = ctx.callbackQuery.data.split(":");

        const userQueue = await db
          .select({ fileHash: queueTable.fileHash })
          .from(queueTable)
          .where(eq(queueTable.userTg, ctx.from.id))
          .offset(parseInt(index!))
          .limit(10);

        let replyMsg = `*Upload Queue*\n\n${escapeMarkdownV2("----------")}`;
        if (!userQueue.length) replyMsg += "\n_empty list_";
        else
          for (const item of userQueue) {
            replyMsg += `\n🆔 \`${escapeMarkdownV2(item.fileHash!)}\``;
          }
        replyMsg += `\n${escapeMarkdownV2("----------")}\n\nTo process an item in queue send \`/queue_item {ITEM_ID}\` command\\.`;

        return bot.api.editMessageText(
          ctx.chatId!,
          ctx.callbackQuery.message?.message_id!,
          replyMsg,
          {
            reply_markup: makeQueueListKeyboard(
              parseInt(index!),
              userQueue.length >= 10,
            ),
          },
        );
      }

      if (ctx.callbackQuery.data.startsWith("giveUp")) {
        const [_command, hash] = ctx.callbackQuery.data.split(":");
        const item = (
          await db
            .select({ addresses: queueTable.addresses })
            .from(queueTable)
            .where(
              and(
                eq(queueTable.userTg, ctx.from.id),
                eq(queueTable.fileHash, hash!),
              ),
            )
        )[0];

        if (!item)
          return bot.api.editMessageText(
            ctx.chatId!,
            ctx.callbackQuery.message?.message_id!,
            "The file that you're looking for is removed already!",
          );

        const addresses: string[] = item.addresses?.split(",") as string[];
        const toGetRemoved = addresses[0]?.includes("compressed")
          ? path.dirname(addresses[0]!)
          : addresses[0]!;

        await rm(toGetRemoved, { recursive: true });
        await db
          .delete(queueTable)
          .where(
            and(
              eq(queueTable.userTg, ctx.from.id),
              eq(queueTable.fileHash, hash!),
            ),
          );

        return bot.api.editMessageText(
          ctx.chatId!,
          ctx.callbackQuery.message?.message_id!,
          "The file has been removed from your queue successfully!",
        );
      }

      if (ctx.callbackQuery.data.startsWith("uploadReq")) {
        const [_command, hash] = ctx.callbackQuery.data.split(":");
        const item = (
          await db
            .select({
              id: queueTable.id,
              fileHash: queueTable.fileHash,
              addresses: queueTable.addresses,
              completedChunks: queueTable.completedChunks,
              lastChunkStatus: queueTable.lastChunkStatus,
            })
            .from(queueTable)
            .where(
              and(
                eq(queueTable.userTg, ctx.from.id),
                eq(queueTable.fileHash, hash!),
              ),
            )
        )[0];

        if (!item)
          return bot.api.editMessageText(
            ctx.chatId!,
            ctx.callbackQuery.message?.message_id!,
            "The file that you're looking for is removed!",
          );

        if (
          item.lastChunkStatus != "NOT-STARTED" &&
          item.lastChunkStatus != "FAILED"
        )
          return bot.api.editMessageText(
            ctx.chatId!,
            ctx.callbackQuery.message?.message_id!,
            "Another process is uploading this file. If this is a mistake give up and start over :)",
          );

        const addresses: string[] = item.addresses?.split(",") as string[];

        const user = (
          await db
            .select({
              irSocial: usersTable.irSocial,
              irSocialId: usersTable.irSocialId,
            })
            .from(usersTable)
            .where(eq(usersTable.telegramId, ctx.from.id))
        )[0];

        let completedChunks = item.completedChunks || 0;
        for (let i = item.completedChunks || 0; i < addresses.length; i++) {
          //? update states
          await db
            .update(queueTable)
            .set({ lastChunkStatus: "UPLOADING" })
            .where(eq(queueTable.id, item.id));

          let completedCounter = completedChunks;
          let uploadMsg = "*Uploading\\.\\.\\.*\n\nChunks:";
          for (let j = 0; j < addresses.length; j++) {
            uploadMsg += escapeMarkdownV2(
              `\n${completedCounter-- > 0 ? "🟢" : j == completedChunks ? "🟡" : "⚪️"} - ${path.basename(addresses[j]!)}`,
            );
          }

          await bot.api.editMessageText(
            ctx.chatId!,
            ctx.callbackQuery.message?.message_id!,
            uploadMsg,
            {
              parse_mode: "MarkdownV2",
              reply_markup: makeUploadKeyboard(item.fileHash!, false),
            },
          );

          const res: { success: boolean; reason?: any } = await (
            user?.irSocial === "bale"
              ? BaleAdaptor.getInstance()
              : RubikaAdaptor.getInstance()
          ).uploadFile({
            filePath: addresses[i]!,
            chat_id: user?.irSocialId!,
          });

          if (res.success)
            await db
              .update(queueTable)
              .set({
                lastChunkStatus: "NOT-STARTED",
                completedChunks: ++completedChunks,
              })
              .where(eq(queueTable.id, item.id));
          else {
            await db
              .update(queueTable)
              .set({
                lastChunkStatus: "FAILED",
              })
              .where(eq(queueTable.id, item.id));

            let completedCounter = completedChunks;
            let uploadMsg = "*Failed to upload\\!*\n\nChunks:";
            for (let j = 0; j < addresses.length; j++) {
              uploadMsg += escapeMarkdownV2(
                `\n${completedCounter-- > 0 ? "🟢" : j == completedChunks ? "🔴" : "⚪️"} - ${path.basename(addresses[j]!)}`,
              );
            }
            uploadMsg += `\n\n\`\`\`${res.reason.stack ?? res.reason}\`\`\``;

            return bot.api.editMessageText(
              ctx.chatId!,
              ctx.callbackQuery.message?.message_id!,
              uploadMsg,
              {
                parse_mode: "MarkdownV2",
                reply_markup: makeUploadKeyboard(item.fileHash!, true, true),
              },
            );
          }
        }

        const toGetRemoved = addresses[0]?.includes("compressed")
          ? path.dirname(addresses[0]!)
          : addresses[0]!;

        await rm(toGetRemoved, { recursive: true });

        await db
          .delete(queueTable)
          .where(
            and(
              eq(queueTable.userTg, ctx.from.id),
              eq(queueTable.fileHash, hash!),
            ),
          );

        return bot.api.editMessageText(
          ctx.chatId!,
          ctx.callbackQuery.message?.message_id!,
          "✅ Congratulations! Your file got uploaded successfully.",
        );
      }
    } catch (error: any) {
      if (currentHash)
        cache.del(`downReqOptions:${ctx.from.id}:${currentHash}`);
      if (currentFile) rm(currentFile, { recursive: true });

      bot.api.editMessageText(
        ctx.chatId!,
        ctx.callbackQuery.message?.message_id!,
        `Something went wrong\\!\n\`\`\`${escapeMarkdownV2(error.stack ?? error)}\n\`\`\``,
        { parse_mode: "MarkdownV2" },
      );
    }
  });
}

async function isValidUser(id: string) {
  return (await cache.get<string[]>("allowedUsers"))!.includes(id);
}

async function isUserLinked(id: number) {
  return !!(
    await db
      .select({ irSocialId: usersTable.irSocialId })
      .from(usersTable)
      .where(eq(usersTable.telegramId, id))
  )[0]?.irSocialId;
}

function isValidURL(url: string) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function md5(str: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("md5");
    hash.on("error", reject);
    hash.end(str, () => {
      resolve(hash.read().toString("hex"));
    });
  });
}

function emojifyStatusCode(code: string) {
  const n = parseInt(code);
  if (!n || Number.isNaN(n)) return "🔴";

  return n >= 200 && n < 400 ? "🟢" : "🔴";
}

function formatFileSize(bytes: number, decimals = 2) {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  if (i === 0) {
    return bytes + " B";
  }

  const value = bytes / Math.pow(k, i);

  return parseFloat(value.toFixed(decimals)) + " " + sizes[i];
}

function escapeMarkdownV2(text: string) {
  if (typeof text !== "string") return "";

  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

async function getUrlMetadata(url: string) {
  const headRes = await got.head(url, {
    followRedirect: true,
  });

  if (
    !headRes.headers["content-length"] ||
    Number.isNaN(parseInt(headRes.headers["content-length"]!)) ||
    !headRes.headers["content-type"]
  )
    throw new Error("❌ Error: Not enough metadata!");

  return {
    contentLength: parseInt(headRes.headers["content-length"]!),
    contentType: headRes.headers["content-type"],
  };
}

async function getUserIRSocial(tgId: number) {
  return (
    await db
      .select({ irSocial: usersTable.irSocial })
      .from(usersTable)
      .where(eq(usersTable.telegramId, tgId))
  )[0]?.irSocial;
}

async function startDownload(
  url: string,
  hash: string,
  onProgress: (percent: number) => void | Promise<void>,
) {
  if (!fs.existsSync(path.join(import.meta.dirname, "..", "..", "downloads")))
    fs.mkdirSync(path.join(import.meta.dirname, "..", "..", "downloads"));

  const downloadStream = got
    .stream(url, { followRedirect: true })
    .on("downloadProgress", ({ percent }) => onProgress(percent));

  let format = url.substring(url.lastIndexOf("/") + 1);
  format = format.substring(
    0,
    format.includes("?") ? format.indexOf("?") : format.length,
  );
  format = format.substring(format.lastIndexOf("."));

  const outPath = path.join(
    import.meta.dirname,
    "..",
    "..",
    "downloads",
    `${hash}${format}`,
  );
  await pipeline(downloadStream, createWriteStream(outPath));

  return outPath;
}

function createProgressBar(percent: number, barLength = 20) {
  percent = Math.min(Math.max(percent, 0), 100); // Clamp between 0-100

  const filledLength = Math.round((barLength * percent) / 100);
  const emptyLength = barLength - filledLength;

  const filledChar = "█";
  const emptyChar = "░";

  return `[${filledChar.repeat(filledLength) + emptyChar.repeat(emptyLength)}]`;
}

async function compressFile(
  inputFile: string,
  outputDir: string,
  chunkSize: number,
  password: string,
) {
  if (!fs.existsSync(outputDir)) await mkdir(outputDir, { recursive: true });

  const fileName = path.basename(inputFile, path.extname(inputFile));
  const outputBase = path.join(outputDir, `${fileName}.zip`);

  const args = [
    "a",
    "-t7z",
    `-v${chunkSize}m`,
    "-mx=5",
    `-p${password}`,
    "-mhe=on",
    outputBase,
    inputFile,
  ];

  return new Promise((resolve, reject) => {
    const sevenZip = spawn("7z", args);

    sevenZip.on("close", async (code) => {
      if (code === 0) resolve(outputBase);
      else reject(new Error(`7z exited with code ${code}`));
    });

    sevenZip.on("error", (err) => {
      reject(
        new Error(
          `Failed to run 7z: ${err.message}. Make sure 7-Zip is installed.`,
        ),
      );
    });
  });
}

function makeIRSocialChoiceKeyboard() {
  return new InlineKeyboard()
    .text("Bale", "linkReqBale")
    .text("Rubika", "linkReqRubika");
}

function makeQueueListKeyboard(currentIndex: number, nextPage = true) {
  let keyboard = new InlineKeyboard();
  if (currentIndex) keyboard = keyboard.text("<-", `queue:${currentIndex - 1}`);
  keyboard = keyboard.text(`${currentIndex + 1}`, "ignored");
  if (nextPage) keyboard = keyboard.text("->", `queue:${currentIndex + 1}`);
  return keyboard;
}

function makeRequestKeyboard(
  hash: string,
  compression: boolean,
  forceCompression: boolean,
) {
  return new InlineKeyboard()
    .text(
      `Compression: ${compression ? "ON" : "OFF"}`,
      forceCompression ? "forceCompression" : `toggleCompression:${hash}`,
    )
    .style("primary")
    .row()
    .text("❌ Cancel", `cancelReq:${hash}`)
    .style("danger")
    .text("✅ Confirm", `confirmReq:${hash}`)
    .style("success");
}

function makeUploadKeyboard(hash: string, startButton: boolean, retry = false) {
  let keyboard = new InlineKeyboard()
    .text("Give up!", `giveUp:${hash}`)
    .style("danger");

  if (startButton)
    keyboard = keyboard
      .text(retry ? "Retry" : "Start", `uploadReq:${hash}`)
      .style("primary");

  return keyboard;
}

function getChunkStatusCharacter(status: string) {
  const statusMap: any = {
    "NOT-STARTED": "⚪️",
    UPLOADING: "🟡",
    DONE: "🟢",
    FAILED: "🔴",
  };

  return statusMap[status];
}
