import axios, { AxiosError, type AxiosInstance } from "axios";
import { db } from "../db/index.js";
import { statesTable } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { Adaptor } from "./adaptor.js";
import type { BaleSendMessage, BaleUpdate } from "./types.js";

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
  static async getInstance() {
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
}
