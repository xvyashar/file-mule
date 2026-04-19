import axios, { AxiosError, type AxiosInstance } from "axios";
import { RKUpdateTypeEnum, type RKSendMessage } from "./types.js";
import { db } from "../db/index.js";
import { statesTable } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { Adaptor } from "./adaptor.js";

export class RubikaAdaptor extends Adaptor {
  protected token = process.env.RK_TOKEN!;
  protected baseUrl: string = `https://botapi.rubika.ir/v3/${this.token}`;
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

  // singleton
  static async getInstance() {
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
        .where(eq(statesTable.key, "rubikaOffsetId"))
    )[0];

    if (!state) {
      await db.insert(statesTable).values({ key: "rubikaOffsetId" });
      return undefined;
    }

    return state.value || undefined;
  }

  protected async setOffset(offset: string) {
    await db
      .update(statesTable)
      .set({ value: offset })
      .where(eq(statesTable.key, "rubikaOffsetId"));
    return;
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
        } = await this.api.post("/getUpdates", { offset_id: this.offsetId });

        this.offsetId = next_offset_id ?? this.offsetId;
        await this.setOffset(this.offsetId!);

        for (const update of updates) {
          if (
            update.type != RKUpdateTypeEnum.NewMessage &&
            update.type != RKUpdateTypeEnum.StartedBot
          )
            continue;

          this.emit("message", update);
        }
      } catch (error) {
        if (error instanceof AxiosError) {
          console.log(
            `Rubika: getUpdates method call failed -> ${error.status}`,
          );
        }
      }
    }, 5000);
  }

  async sendMessage(payload: RKSendMessage) {
    await this.api.post("/sendMessage", payload);
    return;
  }
}
