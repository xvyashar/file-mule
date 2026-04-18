import { bot } from "./index.js";
import { db, cache } from "../db/index.js";
import { usersTable } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import fs, { createWriteStream } from "node:fs";
import { mkdir, readdir, unlink } from "node:fs/promises";
import { pipeline } from "stream/promises";
import got from "got";
import { createHash } from "node:crypto";
import { InlineKeyboard } from "grammy";
import path from "node:path";
import { spawn } from "node:child_process";

export function registerCommands() {
  bot.command("start", async (ctx) => {
    try {
      const user = (
        await db
          .select({ rubikaId: usersTable.rubikaId })
          .from(usersTable)
          .where(eq(usersTable.telegramId, ctx.from?.id!))
      )[0];

      if (!user) {
        if (!(await isValidUser(ctx.from?.id.toString()!))) {
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
          `Link your account to your rubika account by sending this command in rubika bot:\n\`/link ${reqId}\``,
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

  bot.on("message:entities:url", async (ctx) => {
    let currentHash;
    try {
      if (!(await isValidUser(ctx.from.id.toString()))) return;

      if (!isValidURL(ctx.message.text))
        return ctx.reply("Not a valid url!", {
          reply_parameters: { message_id: ctx.message.message_id },
        });

      const hash = await md5(ctx.message.text);

      // TODO: first check for duplication

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

      const chunkSize = parseInt(process.env.RK_FILE_CHUNK_SIZE!) * 1024 * 1024;
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
          reply_markup: new InlineKeyboard()
            .text(
              "Compression: ON",
              chunksCount > 1
                ? "forceCompression"
                : `toggleCompression:${hash}`,
            )
            .style("primary")
            .row()
            .text("❌ Cancel", `cancelReq:${hash}`)
            .style("danger")
            .text("✅ Confirm", `confirmReq:${hash}`)
            .style("success"),
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
      if (!(await isValidUser(ctx.from.id.toString()))) return;

      const file = await ctx.getFile();
      const hash = await md5(file.file_unique_id);

      if (!file.file_size)
        return ctx.reply("❌ Something went wrong\\!\n> No metadata provided", {
          parse_mode: "MarkdownV2",
        });

      // TODO: first check for duplication

      const url = `https://api.telegram.org/file/bot${process.env.TG_TOKEN}/${file.file_path}`;
      const chunkSize = parseInt(process.env.RK_FILE_CHUNK_SIZE!) * 1024 * 1024;
      const chunksCount = Math.ceil(file.file_size / chunkSize);

      await cache.set(`downReqOptions:${ctx.from.id}:${hash}`, {
        compression: true,
        url,
        metadata: {
          contentLength: file.file_size,
        },
        chunksCount,
      });

      currentHash = hash;

      ctx.reply(
        `*Telegram Download Request:*\n\n🆔 *Name*: ${escapeMarkdownV2(hash)}\n📏 *Potential Size*: ${escapeMarkdownV2(formatFileSize(file.file_size))}\n📐 *Chunk Size*: ${escapeMarkdownV2(formatFileSize(chunkSize))}\n🧩 *Potential File Chunks*: ${chunksCount}`,
        {
          parse_mode: "MarkdownV2",
          reply_parameters: { message_id: ctx.message.message_id },
          reply_markup: new InlineKeyboard()
            .text(
              "Compression: ON",
              chunksCount > 1
                ? "forceCompression"
                : `toggleCompression:${hash}`,
            )
            .style("primary")
            .row()
            .text("❌ Cancel", `cancelReq:${hash}`)
            .style("danger")
            .text("✅ Confirm", `confirmReq:${hash}`)
            .style("success"),
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

  bot.on("callback_query:data", async (ctx) => {
    let currentHash = "";
    let currentFile = "";
    try {
      await ctx.answerCallbackQuery();

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
            reply_markup: new InlineKeyboard()
              .text(
                `Compression: ${ops.compression ? "ON" : "OFF"}`,
                `toggleCompression:${hash}`,
              )
              .style("primary")
              .row()
              .text("❌ Cancel", `cancelReq:${hash}`)
              .style("danger")
              .text("✅ Confirm", `confirmReq:${hash}`)
              .style("success"),
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

        let prevPercent = "0";
        const outPath = await startDownload(ops.url, hash!, (percent) => {
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

        if (!outPath) return;
        currentFile = outPath;

        // bot.api.editMessageText(
        //   ctx.chatId!,
        //   ctx.callbackQuery.message?.message_id!,
        //   "✅ Successfully downloaded!",
        // );

        // TODO: handle compression
        let readyFiles = [outPath];
        if (ops.compression) {
          await bot.api.editMessageText(
            ctx.chatId!,
            ctx.callbackQuery.message?.message_id!,
            "⚙️ Compressing...",
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
            parseInt(process.env.RK_FILE_CHUNK_SIZE!),
            process.env.COMPRESSED_PASS!,
          );

          await unlink(outPath);
          currentFile = compressedDir;

          const files = await readdir(compressedDir);
          for (let i = 0; i < files.length; i++) {
            readyFiles[i] = files[i]!;
          }
        }
      }
    } catch (error: any) {
      if (currentHash)
        cache.del(`downReqOptions:${ctx.from.id}:${currentHash}`);
      if (currentFile) unlink(currentFile);

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

    sevenZip.on("close", (code) => {
      if (code === 0) {
        resolve(outputBase);
      } else {
        reject(new Error(`7z exited with code ${code}`));
      }
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
