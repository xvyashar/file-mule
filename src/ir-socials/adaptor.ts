import type { AxiosInstance } from "axios";
import EventEmitter from "node:events";

export abstract class Adaptor extends EventEmitter {
  protected abstract token: string;
  protected abstract baseUrl: string;
  protected abstract api: AxiosInstance;
  protected abstract offsetId: string | number | undefined;

  constructor() {
    super();
  }

  protected abstract getOffset(): Promise<typeof this.offsetId>;
  protected abstract setOffset(offset: typeof this.offsetId): Promise<void>;
  abstract startPolling(): void | Promise<void>;
  abstract sendMessage(payload: any): Promise<void>;
}
