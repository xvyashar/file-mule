import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { inspect } from 'node:util';
import axios, { AxiosError, type AxiosInstance } from 'axios';
import FormData from 'form-data';
import { eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { statesTable } from '../db/schema.js';
import { Adaptor } from './adaptor.js';
import type { BaleSendMessage, BaleUpdate, FileType } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';
const logLabel = { label: 'BaleAdaptor' };

export class BaleAdaptor extends Adaptor {
  protected baseUrl = `https://tapi.bale.ai/bot${config.env.BALE_BOT_TOKEN}`;
  protected api: AxiosInstance;
  protected offsetId: number | undefined;
  static instance: BaleAdaptor;
  private intervalId: NodeJS.Timeout | undefined;

  constructor() {
    super();
    this.api = axios.create({
      baseURL: this.baseUrl,
    });
  }

  //? singleton
  static getInstance() {
    if (!BaleAdaptor.instance) {
      BaleAdaptor.instance = new BaleAdaptor();
    }

    return BaleAdaptor.instance;
  }

  protected async getOffset() {
    const state = (
      await db
        .select({ value: statesTable.value })
        .from(statesTable)
        .where(eq(statesTable.key, 'baleOffsetId'))
    )[0];

    if (!state) {
      await db.insert(statesTable).values({ key: 'baleOffsetId' });
      return undefined;
    }

    return state.value ? parseInt(state.value) : undefined;
  }

  protected async setOffset(offset: number) {
    await db
      .update(statesTable)
      .set({ value: offset.toString() })
      .where(eq(statesTable.key, 'baleOffsetId'));
    return;
  }

  async httpPing() {
    try {
      const { status } = await this.api.post('/getUpdates', {
        limit: 1,
      });
      return status.toString();
    } catch (error) {
      if (error instanceof AxiosError) {
        return `${error.response?.status ?? error.status}`;
      }
      return 'undefined';
    }
  }

  async startPolling() {
    if (this.intervalId) return;
    if (!this.offsetId) this.offsetId = await this.getOffset();

    this.intervalId = setInterval(async () => {
      try {
        const {
          data: { result: updates },
        } = await this.api.post('/getUpdates', {
          offset: this.offsetId,
        });

        let lastUpdateId = undefined;
        for (const update of updates as BaleUpdate[]) {
          lastUpdateId = Math.max(lastUpdateId ?? 0, update.update_id);

          if (
            update.message?.from &&
            !update.message.from.is_bot &&
            update.message?.text
          )
            this.emit('message', update);
        }

        this.offsetId = lastUpdateId;
        if (lastUpdateId) await this.setOffset(lastUpdateId);
      } catch (error: any) {
        if (error instanceof AxiosError) {
          logger.error(
            `Bale: getUpdates method call failed -> ${error.status}`,
            logLabel,
          );
        }
      }
    }, 5000);
  }

  sendMessage(payload: BaleSendMessage) {
    return this.api.post('/sendMessage', payload) as Promise<void>;
  }

  async uploadFile({
    filePath,
    fileType,
    chat_id,
  }: {
    filePath: string;
    fileType: FileType;
    chat_id: string;
  }) {
    try {
      await this.retry(
        async () => {
          const formData = new FormData();
          const fileBuffer = await readFile(filePath);

          if (fileType == 'file') {
            formData.append('document', fileBuffer, {
              filename: path.basename(filePath),
            });
            formData.append('chat_id', chat_id);

            await this.api.post('/sendDocument', formData);
          } else if (fileType == 'photo') {
            formData.append('photo', fileBuffer, {
              filename: path.basename(filePath),
            });
            formData.append('chat_id', chat_id);
            formData.append('from_chat_id', chat_id);

            await this.api.post('/sendPhoto', formData);
          } else if (fileType == 'video') {
            formData.append('video', fileBuffer, {
              filename: path.basename(filePath),
            });
            formData.append('chat_id', chat_id);

            await this.api.post('/sendVideo', formData);
          } else if (fileType == 'audio') {
            formData.append('audio', fileBuffer, {
              filename: path.basename(filePath),
            });
            formData.append('chat_id', chat_id);

            await this.api.post('/sendAudio', formData);
          } else if (fileType == 'voice') {
            formData.append('voice', fileBuffer, {
              filename: path.basename(filePath),
            });
            formData.append('chat_id', chat_id);

            await this.api.post('/sendVoice', formData);
          }
        },
        3,
        5000,
      );

      return { success: true };
    } catch (error: any) {
      logger.error(`Bale Upload Error: ${inspect(error)}`, logLabel);
      return { success: false, reason: error };
    }
  }

  private async retry(
    job: () => any | Promise<any>,
    maxTries: number,
    retryDelay: number,
  ) {
    for (let i = 0; i < maxTries; i++) {
      try {
        return await job();
      } catch (error) {
        if (i == maxTries - 1) throw error;
        else await this.sleep(retryDelay);
      }
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
