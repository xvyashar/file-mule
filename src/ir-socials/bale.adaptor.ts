import axios, { AxiosError, type AxiosInstance } from "axios";
import { db } from "../db/index.js";
import { statesTable } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { Adaptor } from "./adaptor.js";
import type { BaleSendMessage, BaleUpdate } from "./types.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import FormData from "form-data";

export class BaleAdaptor extends Adaptor {
  protected token = process.env.BALE_TOKEN!;
  protected baseUrl = `https://tapi.bale.ai/bot${this.token}`;
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

  // singleton
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
        .where(eq(statesTable.key, "baleOffsetId"))
    )[0];

    if (!state) {
      await db.insert(statesTable).values({ key: "baleOffsetId" });
      return undefined;
    }

    return state.value ? parseInt(state.value) : undefined;
  }

  protected async setOffset(offset: number) {
    await db
      .update(statesTable)
      .set({ value: offset.toString() })
      .where(eq(statesTable.key, "baleOffsetId"));
    return;
  }

  async httpPing() {
    try {
      const { status } = await this.api.post("/getUpdates", {
        limit: 1,
      });
      return status.toString();
    } catch (error) {
      if (error instanceof AxiosError) {
        return `${error.response?.status ?? error.status}`;
      }
      return "undefined";
    }
  }

  async startPolling() {
    if (this.intervalId) return;
    if (!this.offsetId) this.offsetId = await this.getOffset();

    this.intervalId = setInterval(async () => {
      try {
        const {
          data: { result: updates },
        } = await this.api.post("/getUpdates", {
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
            this.emit("message", update);
        }

        this.offsetId = lastUpdateId;
        if (lastUpdateId) await this.setOffset(lastUpdateId);
      } catch (error: any) {
        if (error instanceof AxiosError) {
          console.log(`Bale: getUpdates method call failed -> ${error.status}`);
        }
      }
    }, 5000);
  }

  async sendMessage(payload: BaleSendMessage) {
    await this.api.post("/sendMessage", payload);
    return;
  }

  async uploadFile({
    filePath,
    chat_id,
  }: {
    filePath: string;
    chat_id: string;
  }) {
    try {
      await this.retry(
        async () => {
          const formData = new FormData();

          const fileBuffer = await readFile(filePath);
          formData.append("document", fileBuffer, {
            filename: path.basename(filePath),
          });
          formData.append("chat_id", chat_id);

          await this.api.post("/sendDocument", formData);
        },
        3,
        5000,
      );

      return { success: true };
    } catch (error: any) {
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
