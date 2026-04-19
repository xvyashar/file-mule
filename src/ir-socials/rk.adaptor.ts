import axios, { AxiosError, type AxiosInstance } from "axios";
import { RKUpdateTypeEnum, type RKSendMessage } from "./types.js";
import { db } from "../db/index.js";
import { statesTable } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { Adaptor } from "./adaptor.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import FormData from "form-data";

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
            `Rubika: getUpdates method call failed -> ${error.response?.status || error.status}`,
          );
        }
      }
    }, 5000);
  }

  async sendMessage(payload: RKSendMessage) {
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
      let uploadUrl: string | any;
      let file_id: string | any;
      await this.retry(
        async () => {
          if (!uploadUrl) {
            const {
              data: { data },
            } = await this.api.post("/requestSendFile", {
              type: "File",
            });
            uploadUrl = data.upload_url;
          }

          if (!file_id) {
            const formData = new FormData();

            const fileBuffer = await readFile(filePath);
            formData.append("file", fileBuffer, {
              filename: path.basename(filePath),
            });

            const {
              data: {
                data: { file_id: fileId },
              },
            } = await axios.post(uploadUrl, formData);

            file_id = fileId;
          }

          await this.api.post("/sendFile", {
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
