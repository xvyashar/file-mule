import EventEmitter from "node:events";
import axios from "axios";
import { UpdateTypeEnum, type SendMessage } from "./types.js";
import { db } from "../db/index.js";
import { statesTable } from "../db/schema.js";
import { eq } from "drizzle-orm";

export class RubikaAdaptor extends EventEmitter {
  static instance: RubikaAdaptor;
  private token = process.env.RK_TOKEN;
  private intervalId: NodeJS.Timeout | undefined;
  private offsetId: string | undefined;

  constructor(offset: string | undefined) {
    super();
    this.offsetId = offset;
  }

  // singleton
  static async getInstance() {
    if (!RubikaAdaptor.instance) {
      RubikaAdaptor.instance = new RubikaAdaptor(await this.getOffset());
    }

    return RubikaAdaptor.instance;
  }

  private static async getOffset() {
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

  private static setOffset(offset: string) {
    return db
      .update(statesTable)
      .set({ value: offset })
      .where(eq(statesTable.key, "rubikaOffsetId"));
  }

  startPolling() {
    if (this.intervalId) return;

    this.intervalId = setInterval(async () => {
      try {
        const {
          data: {
            data: { next_offset_id, updates },
          },
        } = await axios.post(
          `https://botapi.rubika.ir/v3/${this.token}/getUpdates`,
          { offset_id: this.offsetId },
        );

        this.offsetId = next_offset_id ?? this.offsetId;
        await RubikaAdaptor.setOffset(this.offsetId!);

        for (const update of updates) {
          if (
            update.type != UpdateTypeEnum.NewMessage &&
            update.type != UpdateTypeEnum.StartedBot
          )
            continue;

          this.emit("message", update);
        }
      } catch (error) {
        console.log(error);
      }
    }, 2000);
  }

  sendMessage(payload: SendMessage) {
    return axios.post(
      `https://botapi.rubika.ir/v3/${this.token}/sendMessage`,
      payload,
    );
  }
}
