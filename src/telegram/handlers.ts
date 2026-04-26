import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { Api, Bot, Context, InlineKeyboard, type RawApi } from 'grammy';
import { sequentialize } from '@grammyjs/runner';
import PQueue from 'p-queue';

import { db, cache } from '../db/index.js';
import { queueTable, usersTable } from '../db/schema.js';
import { BaleAdaptor } from '../ir-socials/bale.adaptor.js';
import { RubikaAdaptor } from '../ir-socials/rk.adaptor.js';
import {
  makeCopyPasswordKeyboard,
  makeIRSocialChoiceKeyboard,
  makeQueueListKeyboard,
  makeRequestKeyboard,
  makeUploadKeyboard,
} from './keyboards.js';
import {
  BotError,
  compressFile,
  emojifyStatusCode,
  escapeMarkdownV2,
  formatFileSize,
  generateProgressBar,
  generateQueueList,
  generateUploadMessage,
  getFileMetadata,
  getUrlMetadata,
  getUserIRSocial,
  isUserLinked,
  isUserWhitelisted,
  isValidURL,
  md5,
  startDownload,
} from './utils.js';
import config from '../config.js';
import {
  ChunkStatus,
  type DownloadRequest,
  type FileType,
} from '../types/index.js';
import logger from '../logger.js';
const logLabel = { label: 'telegram/handlers' };

const dQueue = new PQueue({ concurrency: 4 });

export async function registerHandlers(bot: Bot<Context, Api<RawApi>>) {
  bot.use(sequentialize((ctx) => ctx.chatId?.toString() ?? 'global'));
  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      await catchError(bot, ctx, error);
    }
  });

  bot.use(async (ctx, next) => {
    if (!ctx.from) return await next();

    if (!ctx.from.is_bot && isUserWhitelisted(ctx.from.id.toString()))
      return await next();

    throw new BotError("Sorry! This is a private bot. You can't use it!", {
      action: 'send',
      replyTo: ctx.msgId,
    });
  });

  bot.command('start', async (ctx) => {
    const user = (
      await db
        .select({ irSocialId: usersTable.irSocialId })
        .from(usersTable)
        .where(eq(usersTable.telegramId, ctx.from?.id!))
    )[0];

    if (!user?.irSocialId)
      return ctx.reply(
        'In order to use this bot you should link your telegram account to either your bale or your rubika account.\nPlease choose one of them:',
        {
          reply_parameters: { message_id: ctx.msg.message_id },
          reply_markup: makeIRSocialChoiceKeyboard(),
        },
      );

    return ctx.reply("You're ready to go!", {
      reply_parameters: { message_id: ctx.msg.message_id },
    });
  });

  bot.callbackQuery('linkReqBale', async (ctx) => {
    await ctx.answerCallbackQuery();

    const userExist = !!(
      await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.telegramId, ctx.from.id))
    )[0];

    if (userExist)
      await db
        .update(usersTable)
        .set({ irSocial: 'bale' })
        .where(eq(usersTable.telegramId, ctx.from.id));
    else
      await db
        .insert(usersTable)
        .values({ telegramId: ctx.from?.id!, irSocial: 'bale' });

    const reqId =
      (await cache.get<string>(`baleLinkReq:${ctx.from?.id}`)) ?? ulid();
    cache.set(`baleLinkReq:${ctx.from?.id}`, reqId, 60000);
    cache.set(`baleLinkId:${reqId}`, ctx.from?.id, 60000);

    return bot.api.editMessageText(
      ctx.chatId!,
      ctx.callbackQuery.message?.message_id!,
      `Link your account to your bale account by sending this command in bale bot:\n\`/link ${reqId}\``,
      {
        parse_mode: 'MarkdownV2',
        reply_markup: new InlineKeyboard(),
      },
    );
  });

  bot.callbackQuery('linkReqRubika', async (ctx) => {
    await ctx.answerCallbackQuery();

    const userExist = !!(
      await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.telegramId, ctx.from.id))
    )[0];

    if (userExist)
      await db
        .update(usersTable)
        .set({ irSocial: 'rubika' })
        .where(eq(usersTable.telegramId, ctx.from.id));
    else
      await db
        .insert(usersTable)
        .values({ telegramId: ctx.from.id, irSocial: 'rubika' });

    const reqId =
      (await cache.get<string>(`rkLinkReq:${ctx.from?.id}`)) ?? ulid();
    cache.set(`rkLinkReq:${ctx.from?.id}`, reqId, 60000);
    cache.set(`rkLinkId:${reqId}`, ctx.from?.id, 60000);

    return bot.api.editMessageText(
      ctx.chatId!,
      ctx.callbackQuery.message?.message_id!,
      `Link your account to your rubika account by sending this command in rubika bot:\n\`/link ${reqId}\``,
      {
        parse_mode: 'MarkdownV2',
        reply_markup: new InlineKeyboard(),
      },
    );
  });

  bot.use(async (ctx, next) => {
    if (!ctx.from) return await next();
    if (!ctx.from.is_bot && (await isUserLinked(ctx.from.id)))
      return await next();

    throw new BotError('Link your accounts first!', {
      action: 'send',
      replyTo: ctx.msgId,
    });
  });

  bot.command('relink', async (ctx) => {
    await db
      .update(usersTable)
      .set({ irSocialId: null })
      .where(eq(usersTable.telegramId, ctx.from?.id!));

    return ctx.reply(
      'In order to use this bot you should link your telegram account to either your bale or your rubika account.\nPlease choose one of them:',
      {
        reply_parameters: { message_id: ctx.msg.message_id },
        reply_markup: makeIRSocialChoiceKeyboard(),
      },
    );
  });

  bot.command('ping_bale', async (ctx) => {
    const pingMsg = await ctx.reply('Pinging...', {
      reply_parameters: { message_id: ctx.msg.message_id },
    });

    const result = await BaleAdaptor.getInstance().httpPing();

    await bot.api.editMessageText(
      ctx.chatId,
      pingMsg.message_id,
      `${emojifyStatusCode(result)} Ping Result: ${result}`,
    );
  });

  bot.command('ping_rubika', async (ctx) => {
    const pingMsg = await ctx.reply('Pinging...', {
      reply_parameters: { message_id: ctx.msg.message_id },
    });

    const result = await RubikaAdaptor.getInstance().httpPing();

    await bot.api.editMessageText(
      ctx.chatId,
      pingMsg.message_id,
      `${emojifyStatusCode(result)} Ping Result: ${result}`,
    );
  });

  bot.command('queue', async (ctx) => {
    const userQueue = await db
      .select({ fileHash: queueTable.fileHash })
      .from(queueTable)
      .where(eq(queueTable.userTg, ctx.from?.id!))
      .limit(10);

    return ctx.reply(
      generateQueueList(userQueue),
      userQueue.length >= 10
        ? {
            parse_mode: 'MarkdownV2',
            reply_markup: makeQueueListKeyboard(0, true),
          }
        : {
            parse_mode: 'MarkdownV2',
          },
    );
  });

  bot.command('queue_item', async (ctx) => {
    const [_command, hash] = ctx.message?.text.split(' ')!;

    if (!hash)
      throw new BotError(
        'Provide an item id after this command like this:\n`/queue_item {ITEM_ID}`',
        { action: 'send', replyTo: ctx.msgId, md: true },
      );

    const item = (
      await db
        .select({
          fileHash: queueTable.fileHash,
          addresses: queueTable.addresses,
          chunks: queueTable.chunks,
          completedChunks: queueTable.completedChunks,
          lastChunkStatus: queueTable.lastChunkStatus,
        })
        .from(queueTable)
        .where(
          and(
            eq(queueTable.userTg, ctx.from?.id!),
            eq(queueTable.fileHash, hash!),
          ),
        )
    )[0];
    if (!item)
      throw new BotError(`Item does not exist in db!`, {
        action: 'send',
        replyTo: ctx.msgId,
      });

    const files = item.addresses?.split(',')!;

    return ctx.reply(
      generateUploadMessage(
        item.chunks!,
        item.completedChunks!,
        files.length > 1
          ? path.basename(files[item.completedChunks!]!)
          : `${item.fileHash}${path.extname(files[item.completedChunks!]!)}`,
        item.lastChunkStatus!,
      ),
      {
        parse_mode: 'MarkdownV2',
        reply_markup: makeUploadKeyboard(
          hash!,
          item.lastChunkStatus != ChunkStatus.UPLOADING,
          item.lastChunkStatus == ChunkStatus.FAILED,
        ),
      },
    );
  });

  bot.on('message:file', async (ctx) => {
    if (await cache.get(`downReqOptions:${ctx.from.id}`))
      throw new BotError('You can have only 1 download request at a time!', {
        action: 'send',
        replyTo: ctx.msgId,
      });

    const fileObj = getFileMetadata(ctx);

    if (!fileObj)
      throw new BotError('Unsupported file type', {
        action: 'send',
        replyTo: ctx.msgId,
      });

    if (!fileObj.file_size)
      throw new BotError('No metadata provided', {
        action: 'send',
        systemIssue: true,
        replyTo: ctx.msgId,
      });

    if (fileObj.file_size > config.limits.downloads)
      throw new BotError(
        `❌ Your file is too big you can only download files under ${formatFileSize(config.limits.downloads)}`,
        { action: 'send', replyTo: ctx.msgId },
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
      throw new BotError(
        'This file exists in the queue without finishing its process!',
        { action: 'send', replyTo: ctx.msgId },
      );

    const irSocial = (await getUserIRSocial(ctx.from.id)) as unknown as
      | 'bale'
      | 'rubika';
    const chunkSize =
      (irSocial === 'bale'
        ? config.limits.chunks.bale
        : config.limits.chunks.rubika) *
      1024 *
      1024;
    const chunksCount = Math.ceil(fileObj.file_size / chunkSize);

    await cache.set(
      `downReqOptions:${ctx.from.id}`,
      {
        compression: true,
        localMode: config.telegram.botApi.localMode,
        id: fileObj.file_id,
        size: fileObj.file_size,
        type: fileObj.type,
        hash,
      },
      60 * 60 * 1000, //? 1 hour
    );

    return ctx
      .reply(
        `*Telegram Download Request:*\n\n🆔 *Name*: ${escapeMarkdownV2(hash)}\n📏 *Potential Size*: ${escapeMarkdownV2(formatFileSize(fileObj.file_size))}\n📐 *Chunk Size*: ${escapeMarkdownV2(formatFileSize(chunkSize))}\n🧩 *Potential File Chunks*: ${chunksCount}`,
        {
          parse_mode: 'MarkdownV2',
          reply_parameters: { message_id: ctx.message.message_id },
          reply_markup: makeRequestKeyboard(true, chunksCount > 1),
        },
      )
      .catch(async (err) => {
        await cache.del(`downReqOptions:${ctx.from.id}`);
        throw err;
      });
  });

  bot.on('message:entities:url', async (ctx) => {
    if (await cache.get(`downReqOptions:${ctx.from.id}`))
      throw new BotError('You can have only 1 download request at a time!', {
        action: 'send',
        replyTo: ctx.msgId,
      });

    if (!isValidURL(ctx.message.text))
      throw new BotError('Not a valid url!', {
        action: 'send',
        replyTo: ctx.msgId,
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
      throw new BotError(
        'This link exists in the queue without finishing its process!',
        { action: 'send', replyTo: ctx.msgId },
      );

    const reply = await ctx.reply('Retrieving link metadata...', {
      reply_parameters: { message_id: ctx.msg.message_id },
    });

    const metadata = await getUrlMetadata(ctx.message.text, reply.message_id);

    const irSocial = (await getUserIRSocial(ctx.from.id)) as unknown as
      | 'bale'
      | 'rubika';
    const chunkSize =
      (irSocial === 'bale'
        ? config.limits.chunks.bale
        : config.limits.chunks.rubika) *
      1024 *
      1024;
    const chunksCount = Math.ceil(metadata.contentLength / chunkSize);

    await cache.set(
      `downReqOptions:${ctx.from.id}`,
      {
        compression: true,
        url: ctx.message.text,
        size: metadata.contentLength,
        type: 'file',
        hash,
      },
      60 * 60 * 1000, //? 1 hour
    );

    return bot.api
      .editMessageText(
        ctx.chatId!,
        reply.message_id,
        `*URL Download Request:*\n\n🆔 *Name*: ${escapeMarkdownV2(hash)}\n📂 *Mimetype*: ${escapeMarkdownV2(metadata.contentType!)}\n📏 *Potential Size*: ${escapeMarkdownV2(formatFileSize(metadata.contentLength))}\n📐 *Chunk Size*: ${escapeMarkdownV2(formatFileSize(chunkSize))}\n🧩 *Potential File Chunks*: ${chunksCount}`,
        {
          parse_mode: 'MarkdownV2',
          reply_markup: makeRequestKeyboard(true, chunksCount > 1),
        },
      )
      .catch(async (err) => {
        await cache.del(`downReqOptions:${ctx.from.id}`);
        throw err;
      });
  });

  bot.callbackQuery('forceCompression', async (ctx) => {
    await ctx.answerCallbackQuery({
      show_alert: true,
      text: "It's a large file, compression is unavoidable!",
    });
  });

  bot.callbackQuery('toggleCompression', async (ctx) => {
    await ctx.answerCallbackQuery();

    const ops = (await cache.get(`downReqOptions:${ctx.from.id}`)) as any;
    ops.compression = !ops.compression;
    await cache.set(`downReqOptions:${ctx.from.id}`, ops);

    await bot.api.editMessageReplyMarkup(
      ctx.chatId!,
      ctx.callbackQuery.message?.message_id!,
      {
        reply_markup: makeRequestKeyboard(ops.compression, false),
      },
    );
  });

  bot.callbackQuery('cancelReq', async (ctx) => {
    await ctx.answerCallbackQuery();

    await cache.del(`downReqOptions:${ctx.from.id}`);

    await bot.api.editMessageText(
      ctx.chatId!,
      ctx.callbackQuery.message?.message_id!,
      '❌ Request has been canceled!',
      { reply_markup: new InlineKeyboard() },
    );
  });

  bot.callbackQuery('confirmReq', async (ctx) => {
    const ops = (await cache.get(`downReqOptions:${ctx.from.id}`)) as
      | DownloadRequest
      | undefined;

    if (!ops)
      return ctx.answerCallbackQuery({
        show_alert: true,
        text: 'Your download request has been expired! Try again.',
      });
    await ctx.answerCallbackQuery();

    await bot.api.editMessageText(
      ctx.chatId!,
      ctx.callbackQuery.message?.message_id!,
      'Waiting...',
      { reply_markup: new InlineKeyboard() },
    );

    dQueue.add(() => processDownload(bot, ctx, ops));
  });

  bot.on('callback_query:data', async (ctx) => {
    await ctx.answerCallbackQuery();

    if (ctx.callbackQuery.data.startsWith('queue')) {
      const [_command, index] = ctx.callbackQuery.data.split(':');

      const userQueue = await db
        .select({ fileHash: queueTable.fileHash })
        .from(queueTable)
        .where(eq(queueTable.userTg, ctx.from.id))
        .offset(parseInt(index!))
        .limit(10);

      return bot.api.editMessageText(
        ctx.chatId!,
        ctx.callbackQuery.message?.message_id!,
        generateQueueList(userQueue),
        {
          reply_markup: makeQueueListKeyboard(
            parseInt(index!),
            userQueue.length >= 10,
          ),
        },
      );
    }

    if (ctx.callbackQuery.data.startsWith('giveUp')) {
      const [_command, hash] = ctx.callbackQuery.data.split(':');
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

      const addresses: string[] = item.addresses?.split(',') as string[];
      const toGetRemoved = addresses[0]?.includes('compressed')
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
        'The file has been removed from your queue successfully!',
      );
    }

    if (ctx.callbackQuery.data.startsWith('uploadReq')) {
      const [_command, hash] = ctx.callbackQuery.data.split(':');

      await bot.api.editMessageText(
        ctx.chatId!,
        ctx.callbackQuery.message?.message_id!,
        'Waiting...',
        { reply_markup: new InlineKeyboard() },
      );

      processUpload(bot, ctx, hash!);
    }
  });

  bot.api.setMyCommands([
    {
      command: 'relink',
      description:
        'Relink your telegram account with either your bale or your rubika account',
    },
    {
      command: 'ping_bale',
      description: 'HTTP ping bale api to see if its reachable',
    },
    {
      command: 'ping_rubika',
      description: 'HTTP ping rubika api to see if its reachable',
    },
    { command: 'queue', description: 'Shows your pending uploads queue' },
    { command: 'queue_item', description: 'Manage an item in the queue' },
  ]);
}

async function catchError(
  bot: Bot<Context, Api<RawApi>>,
  ctx: Context,
  err: any,
) {
  try {
    if (err instanceof BotError) {
      if (err.systemIssue) logger.error(err.stack ?? err.message, logLabel);

      const message = err.systemIssue
        ? `❌ Something went wrong\\!\n\`\`\`error\n${escapeMarkdownV2(err.stack ?? err.message)}\`\`\``
        : err.md
          ? err.message
          : escapeMarkdownV2(err.message);
      switch (err.action) {
        case 'send':
          await bot.api.sendMessage(
            ctx.chatId!,
            message,
            err.replyTo
              ? {
                  parse_mode: 'MarkdownV2',
                  reply_parameters: { message_id: err.replyTo },
                }
              : { parse_mode: 'MarkdownV2' },
          );
          break;
        case 'delSend': {
          await bot.api.deleteMessage(ctx.chatId!, err.msgId ?? ctx.msgId!);
          await bot.api.sendMessage(
            ctx.chatId!,
            message,
            err.replyTo
              ? {
                  parse_mode: 'MarkdownV2',
                  reply_parameters: { message_id: err.replyTo },
                }
              : { parse_mode: 'MarkdownV2' },
          );
          break;
        }
        case 'edit':
          await bot.api.editMessageText(
            ctx.chatId!,
            err.msgId ?? ctx.msgId!,
            message,
            {
              parse_mode: 'MarkdownV2',
              reply_markup: err.replyMarkup ?? new InlineKeyboard(),
            },
          );
          break;
      }
    } else {
      const message = `Something went wrong\\!\n\`\`\`error\n${escapeMarkdownV2(err.stack ?? err.message)}\`\`\``;
      logger.error(err.stack ?? err.message, logLabel);
      if (ctx.msg?.from?.is_bot && ctx.msgId !== undefined) {
        await bot.api
          .editMessageText(ctx.chatId!, ctx.msgId, message, {
            parse_mode: 'MarkdownV2',
            reply_markup: new InlineKeyboard(),
          })
          .catch(async () => {
            await bot.api.sendMessage(ctx.chatId!, message, {
              parse_mode: 'MarkdownV2',
            });
          });
      } else if (ctx.msgId !== undefined) {
        await bot.api.sendMessage(ctx.chatId!, message, {
          parse_mode: 'MarkdownV2',
          reply_parameters: { message_id: ctx.msgId },
        });
      }
    }
  } catch (error: any) {
    logger.error(error.stack ?? JSON.stringify(error), logLabel);
  }
}

async function processDownload(
  bot: Bot<Context, Api<RawApi>>,
  ctx: Context,
  ops: DownloadRequest,
) {
  let currentFile;
  try {
    //* Download
    if (ops.url || !ops.localMode) {
      let url = ops.url;
      if (!url) {
        const { file_path } = await bot.api.getFile(ops.id!);
        url = `https://api.telegram.org/file/bot${config.env.TELEGRAM_BOT_TOKEN}/${file_path}`;
      }

      let prevPercent = '0';
      currentFile = await startDownload(url, ops.hash, async (percent) => {
        let percentStr = percent.toFixed(1);
        if (prevPercent === percentStr) return; //? prevent from "nothing changed" error from telegram

        if (parseInt(percentStr) >= parseInt(prevPercent) + 5) {
          prevPercent = percentStr;
          await bot.api.editMessageText(
            ctx.chatId!,
            ctx.callbackQuery!.message?.message_id!,
            `Downloading...\n${generateProgressBar(percent)} ${percentStr}%`,
          );
        }
      });
    } else {
      const { file_path } = await bot.api.getFile(ops.id!);
      if (!file_path)
        throw new BotError('file_path is undefined', {
          systemIssue: true,
          action: 'edit',
        });

      currentFile = file_path;
    }

    let readyFiles = [currentFile];

    //* Compression
    let filePassword;
    if (ops.compression) {
      await bot.api.editMessageText(
        ctx.chatId!,
        ctx.callbackQuery!.message?.message_id!,
        '⚙️ Compressing...',
      );

      const irSocial = (await getUserIRSocial(ctx.from!.id)) as unknown as
        | 'bale'
        | 'rubika';
      const chunkSize =
        irSocial === 'bale'
          ? config.limits.chunks.bale
          : config.limits.chunks.rubika;
      const compressedDir = path.join(
        currentFile,
        '..',
        '..',
        'compressed',
        ops.hash,
      );
      filePassword = ulid();
      await compressFile(currentFile, compressedDir, chunkSize, filePassword);

      await rm(currentFile);
      currentFile = compressedDir;

      const files = await readdir(compressedDir);
      for (let i = 0; i < files.length; i++) {
        readyFiles[i] = path.join(compressedDir, files[i]!);
      }
    }

    await db.insert(queueTable).values({
      userTg: ctx.from!.id,
      fileType: ops.compression ? 'file' : ops.type,
      fileHash: ops.hash,
      filePassword,
      chunks: readyFiles.length,
      addresses: readyFiles.join(','),
      lastTouched: new Date().toISOString(),
    });

    await cache.del(`downReqOptions:${ctx.from!.id}`);
    currentFile = '';

    await bot.api.deleteMessage(
      ctx.chatId!,
      ctx.callbackQuery!.message?.message_id!,
    );

    await ctx.reply(
      generateUploadMessage(
        readyFiles.length,
        0,
        readyFiles.length > 1
          ? path.basename(readyFiles[0]!)
          : `${ops.hash}${path.extname(readyFiles[0]!)}`,
        ChunkStatus['NOT-STARTED'],
      ),
      {
        parse_mode: 'MarkdownV2',
        reply_markup: makeUploadKeyboard(ops.hash, true),
      },
    );
  } catch (error) {
    await cache.del(`downReqOptions:${ctx.from!.id}`);
    if (currentFile)
      await rm(currentFile, { recursive: true }).catch((err) =>
        logger.error(err.stack ?? err, logLabel),
      );

    await catchError(bot, ctx, error);
  }
}

async function processUpload(
  bot: Bot<Context, Api<RawApi>>,
  ctx: Context,
  hash: string,
) {
  try {
    const item = (
      await db
        .select({
          id: queueTable.id,
          fileType: queueTable.fileType,
          fileHash: queueTable.fileHash,
          filePassword: queueTable.filePassword,
          addresses: queueTable.addresses,
          completedChunks: queueTable.completedChunks,
          lastChunkStatus: queueTable.lastChunkStatus,
        })
        .from(queueTable)
        .where(
          and(
            eq(queueTable.userTg, ctx.from!.id),
            eq(queueTable.fileHash, hash),
          ),
        )
    )[0];

    if (!item)
      throw new BotError("The file that you're looking for is removed!", {
        action: 'edit',
      });

    if (
      item.lastChunkStatus != ChunkStatus['NOT-STARTED'] &&
      item.lastChunkStatus != ChunkStatus.FAILED
    )
      throw new BotError(
        'Another process is uploading this file. If this is a mistake give up and start over :)',
        {
          action: 'edit',
          replyMarkup: makeUploadKeyboard(hash, true, true),
        },
      );

    await db
      .update(queueTable)
      .set({
        lastTouched: new Date().toISOString(),
      })
      .where(eq(queueTable.id, item.id));

    const addresses: string[] = item.addresses?.split(',') as string[];

    const user = (
      await db
        .select({
          irSocial: usersTable.irSocial,
          irSocialId: usersTable.irSocialId,
        })
        .from(usersTable)
        .where(eq(usersTable.telegramId, ctx.from!.id))
    )[0];

    let completedChunks = item.completedChunks || 0;
    for (let i = item.completedChunks || 0; i < addresses.length; i++) {
      //? update states
      await db
        .update(queueTable)
        .set({
          lastChunkStatus: ChunkStatus.UPLOADING,
          lastTouched: new Date().toISOString(),
        })
        .where(eq(queueTable.id, item.id));

      const fileName =
        addresses.length > 1
          ? path.basename(addresses[i]!)
          : `${item.fileHash}${path.extname(addresses[i]!)}`;

      await bot.api.editMessageText(
        ctx.chatId!,
        ctx.callbackQuery!.message?.message_id!,
        generateUploadMessage(
          addresses.length,
          completedChunks,
          fileName,
          ChunkStatus.UPLOADING,
        ),
        {
          parse_mode: 'MarkdownV2',
          reply_markup: makeUploadKeyboard(item.fileHash!, false),
        },
      );

      const res: { success: boolean; reason?: any } = await (
        user?.irSocial === 'bale'
          ? BaleAdaptor.getInstance()
          : RubikaAdaptor.getInstance()
      ).uploadFile({
        filePath: addresses[i]!,
        fileName,
        fileType: item.fileType as FileType,
        chat_id: user?.irSocialId!,
      });

      if (res.success)
        await db
          .update(queueTable)
          .set({
            lastChunkStatus: ChunkStatus['NOT-STARTED'],
            completedChunks: ++completedChunks,
            lastTouched: new Date().toISOString(),
          })
          .where(eq(queueTable.id, item.id));
      else {
        await db
          .update(queueTable)
          .set({
            lastChunkStatus: ChunkStatus.FAILED,
            lastTouched: new Date().toISOString(),
          })
          .where(eq(queueTable.id, item.id));

        return bot.api.editMessageText(
          ctx.chatId!,
          ctx.callbackQuery!.message?.message_id!,
          generateUploadMessage(
            addresses.length,
            completedChunks,
            fileName,
            ChunkStatus.FAILED,
          ) + `\n\n\`\`\`error\n${res.reason?.stack ?? res.reason}\`\`\``,
          {
            parse_mode: 'MarkdownV2',
            reply_markup: makeUploadKeyboard(item.fileHash!, true, true),
          },
        );
      }
    }

    const toGetRemoved = addresses[0]?.includes('compressed')
      ? path.dirname(addresses[0]!)
      : addresses[0]!;

    await rm(toGetRemoved, { recursive: true });

    await db
      .delete(queueTable)
      .where(
        and(
          eq(queueTable.userTg, ctx.from!.id),
          eq(queueTable.fileHash, hash!),
        ),
      );

    await bot.api.editMessageText(
      ctx.chatId!,
      ctx.callbackQuery!.message?.message_id!,
      '🌟 Congratulations! Your file got uploaded successfully.',
      item.filePassword
        ? {
            reply_markup: makeCopyPasswordKeyboard(item.filePassword),
          }
        : {},
    );
  } catch (error) {
    await catchError(bot, ctx, error);
  }
}
