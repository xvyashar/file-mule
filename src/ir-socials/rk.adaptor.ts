import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { inspect } from 'node:util';
import FormData from 'form-data';
import axios, { AxiosError, type AxiosInstance } from 'axios';
import { eq } from 'drizzle-orm';

import { RKUpdateTypeEnum, type RKSendMessage } from '../types/index.js';
import { db } from '../db/index.js';
import { statesTable } from '../db/schema.js';
import { Adaptor } from './adaptor.js';
import config from '../config.js';
import logger from '../logger.js';
const logLabel = { label: 'RubikaAdaptor' };

export class RubikaAdaptor extends Adaptor {
  protected baseUrl: string = `https://botapi.rubika.ir/v3/${config.env.RUBIKA_BOT_TOKEN}`;
  protected api: AxiosInstance;
  protected offsetId: string | undefined;
  static instance: RubikaAdaptor;
  private intervalId: NodeJS.Timeout | undefined;

  constructor() {
    super();
    this.api = axios.create({
      baseURL: this.baseUrl,
      timeout: 5000,
    });
  }

  //? singleton
  static getInstance() {
    if (!RubikaAdaptor.instance) {
      RubikaAdaptor.instance = new RubikaAdaptor();
    }

    return RubikaAdaptor.instance;
  }

  protected async getOffset() {
    const state = (
      await db
        .select({ value: statesTable.value })
        .from(statesTable)
        .where(eq(statesTable.key, 'rubikaOffsetId'))
    )[0];

    if (!state) {
      await db.insert(statesTable).values({ key: 'rubikaOffsetId' });
      return undefined;
    }

    return state.value || undefined;
  }

  protected async setOffset(offset: string) {
    await db
      .update(statesTable)
      .set({ value: offset })
      .where(eq(statesTable.key, 'rubikaOffsetId'));
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
          data: {
            data: { next_offset_id, updates },
          },
        } = await this.api.post('/getUpdates', { offset_id: this.offsetId });

        this.offsetId = next_offset_id ?? this.offsetId;
        await this.setOffset(this.offsetId!);

        for (const update of updates) {
          if (
            update.type != RKUpdateTypeEnum.NewMessage &&
            update.type != RKUpdateTypeEnum.StartedBot
          )
            continue;

          this.emit('message', update);
        }
      } catch (error) {
        if (error instanceof AxiosError) {
          logger.error(
            `Rubika: getUpdates method call failed -> ${error.response?.status || error.status}`,
            logLabel,
          );
        }
      }
    }, 5000);
  }

  sendMessage(payload: RKSendMessage) {
    return this.api.post('/sendMessage', payload) as Promise<void>;
  }

  async uploadFile({
    filePath,
    chat_id,
  }: {
    filePath: string;
    chat_id: string;
  }) {
    try {
      let uploadUrl: string | any;
      let file_id: string | any;
      await this.retry(
        async () => {
          if (!uploadUrl) {
            const {
              data: { data },
            } = await this.api.post('/requestSendFile', {
              type: 'File',
            });
            uploadUrl = data.upload_url;
          }

          if (!file_id) {
            const formData = new FormData();

            const fileBuffer = await readFile(filePath);
            formData.append('file', fileBuffer, {
              filename: path.basename(filePath),
            });

            const {
              data: { data },
            } = await axios.post(uploadUrl, formData);

            if (!data.file_id)
              throw new Error(
                `undefined file_id.\ndata: ${JSON.stringify(data)}`,
              );
            file_id = data.file_id;
          }

          await this.api.post('/sendFile', {
            chat_id,
            file_id,
            text: path.basename(filePath),
          });
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
