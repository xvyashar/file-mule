import fs from 'node:fs';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { pipeline } from 'stream/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import axios, { AxiosError } from 'axios';
import { eq } from 'drizzle-orm';
import type { Context } from 'grammy';
import type { InlineKeyboardMarkup } from 'grammy/types';
import got from 'got';

import config from '../config.js';
import { db } from '../db/index.js';
import { usersTable } from '../db/schema.js';
import { ChunkStatus } from '../types/index.js';

//* Classes
export class BotError extends Error {
  systemIssue: boolean;
  md: boolean;
  action: 'none' | 'edit' | 'send' | 'delSend';
  msgId: number | undefined;
  replyTo: number | undefined;
  replyMarkup: InlineKeyboardMarkup | undefined;

  constructor(
    message?: string,
    options?: Partial<{
      cause: string;
      systemIssue: boolean | undefined;
      md: boolean | undefined;
      action: 'none' | 'edit' | 'send' | 'delSend' | undefined;
      msgId: number | undefined;
      replyTo: number | undefined;
      replyMarkup: InlineKeyboardMarkup | undefined;
    }>,
  ) {
    super(message, { cause: options?.cause });

    this.systemIssue = !!options?.systemIssue;
    this.md = !!options?.md;
    this.action = options?.action ?? 'edit';
    this.msgId = options?.msgId;
    this.replyTo = options?.replyTo;
    this.replyMarkup = options?.replyMarkup;
  }
}

//* Functions
export async function logOut(token: string) {
  try {
    await axios.get(`https://api.telegram.org/bot${token}/logOut`);
  } catch (error) {
    if (error instanceof AxiosError) {
      if (error.response?.data.description !== 'Logged out') throw error;
    }
  }
}

export function isUserWhitelisted(id: string) {
  return !config.telegram.whitelist || config.telegram.whitelist.includes(id);
}

export async function isUserLinked(id: number) {
  return !!(
    await db
      .select({ irSocialId: usersTable.irSocialId })
      .from(usersTable)
      .where(eq(usersTable.telegramId, id))
  )[0]?.irSocialId;
}

export async function getUserIRSocial(tgId: number) {
  return (
    await db
      .select({ irSocial: usersTable.irSocial })
      .from(usersTable)
      .where(eq(usersTable.telegramId, tgId))
  )[0]?.irSocial;
}

export function isValidURL(url: string) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function md5(str: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    hash.on('error', reject);
    hash.end(str, () => {
      resolve(hash.read().toString('hex'));
    });
  });
}

export function getFileMetadata(ctx: Context) {
  if (ctx.msg?.document) return { ...ctx.msg.document, type: 'file' };
  else if (ctx.msg?.photo)
    return {
      ...ctx.msg.photo[ctx.msg.photo.length - 1]!,
      type: 'photo',
    };
  else if (ctx.msg?.video) return { ...ctx.msg.video, type: 'video' };
  else if (ctx.msg?.audio) return { ...ctx.msg.audio, type: 'audio' };
  else if (ctx.msg?.voice) return { ...ctx.msg.voice, type: 'voice' };
  else if (ctx.msg?.video_note) return { ...ctx.msg.video_note, type: 'video' };
}

export async function getUrlMetadata(url: string, editMessage?: number) {
  const headRes = await got.head(url, {
    followRedirect: true,
  });

  if (
    !headRes.headers['content-length'] ||
    Number.isNaN(parseInt(headRes.headers['content-length']!)) ||
    !headRes.headers['content-type']
  )
    throw new BotError('Not enough metadata!', {
      action: 'edit',
      msgId: editMessage,
    });

  return {
    contentLength: parseInt(headRes.headers['content-length']!),
    contentType: headRes.headers['content-type'],
  };
}

export async function startDownload(
  url: string,
  hash: string,
  onProgress: (percent: number) => void | Promise<void>,
) {
  await mkdir(path.join(import.meta.dirname, '..', '..', 'downloads'), {
    recursive: true,
  });

  const downloadStream = got
    .stream(url, { followRedirect: true })
    .on('downloadProgress', ({ percent }) => onProgress(percent));

  const outPath = path.join(
    import.meta.dirname,
    '..',
    '..',
    'downloads',
    `${hash}${getFileFormat(url)}`,
  );
  await pipeline(downloadStream, fs.createWriteStream(outPath));

  return outPath;
}

export async function compressFile(
  inputFile: string,
  outputDir: string,
  fileName: string,
  chunkSize: number,
  password: string,
) {
  await mkdir(outputDir, { recursive: true });

  const outputBase = path.join(outputDir, `${fileName}.rar`);

  const args = [
    'a', //? add to archive
    '-o+', //? overwrite if exist
    '-ep1', //? exclude base dir
    '-m5', //? compression level (5 is maximum)
    `-v${chunkSize}m`, //? chunk size in MB
    `-hp${password}`, //? encrypt both data and headers
    outputBase,
    inputFile,
  ];

  return new Promise((resolve, reject) => {
    const rar = spawn('rar', args);

    rar.on('close', async (code) => {
      if (code === 0) resolve(outputBase);
      else reject(new Error(`rar exited with code ${code}`));
    });

    rar.on('error', (err) => {
      reject(
        new Error(
          `Failed to run rar: ${err.message}. Make sure rar is installed.`,
        ),
      );
    });
  });
}

export function emojifyChunkStatus(status: string) {
  const statusMap: any = {
    'NOT-STARTED': '⚪️',
    UPLOADING: '🟡',
    DONE: '✅',
    FAILED: '❌',
  };

  return statusMap[status];
}

export function emojifyStatusCode(code: string) {
  const n = parseInt(code);
  if (!n || Number.isNaN(n)) return '🔴';

  return n >= 200 && n < 400 ? '🟢' : '🔴';
}

export function escapeMarkdownV2(text: string) {
  if (typeof text !== 'string') return '';

  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

export function formatFileSize(bytes: number, decimals = 2) {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  if (i === 0) {
    return bytes + ' B';
  }

  const value = bytes / Math.pow(k, i);

  return parseFloat(value.toFixed(decimals)) + ' ' + sizes[i];
}

export function getFileFormat(path: string) {
  let format = path.substring(path.lastIndexOf('/') + 1);
  format = format.substring(
    0,
    format.includes('?') ? format.indexOf('?') : format.length,
  );
  return format.substring(format.lastIndexOf('.'));
}

export function generateQueueList(queue: { fileHash: string | null }[]) {
  let msg = `*Upload Queue*\n\n${escapeMarkdownV2('----------')}`;
  if (!queue.length) msg += '\n_empty_';
  else
    for (const item of queue) {
      msg += `\n🆔 \`${escapeMarkdownV2(item.fileHash!)}\``;
    }
  return (
    msg +
    `\n${escapeMarkdownV2('----------')}\n\nTo process an item in queue send \`/queue_item {ITEM_ID}\` command\\.`
  );
}

export function generateUploadMessage(
  totalChunks: number,
  completedChunks: number,
  currentChunkName: string,
  currentChunkStatus: string,
) {
  return `${currentChunkStatus === ChunkStatus.UPLOADING ? '*Uploading\\.\\.\\.*' : currentChunkStatus === ChunkStatus.FAILED ? '*Failed to upload\\!*' : '*Ready to upload\\!*'}\n\n✅ Completed Chunks: \\[${completedChunks}/${totalChunks}\\]\n${emojifyChunkStatus(currentChunkStatus)} Current Chunk: ${escapeMarkdownV2(currentChunkName)}`;
}

export function generateProgressBar(percent: number, barLength = 20) {
  percent = Math.min(Math.max(percent, 0), 100); // Clamp between 0-100

  const filledLength = Math.round((barLength * percent) / 100);
  const emptyLength = barLength - filledLength;

  const filledChar = '█';
  const emptyChar = '░';

  return `[${filledChar.repeat(filledLength) + emptyChar.repeat(emptyLength)}]`;
}
