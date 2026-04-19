export type BaleUpdate = {
  update_id: number;
  message?: BaleMessage;
};

export type BaleMessage = {
  message_id: number;
  from?: BaleUser;
  chat: BaleChat;
  text?: string;
};

export type BaleUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
};

export type BaleChat = {
  id: number;
  type: string;
};

export type BaleSendMessage = {
  chat_id: number;
  text: string;
  reply_to_message_id?: number;
};

export enum RKUpdateTypeEnum {
  NewMessage = "NewMessage",
  StartedBot = "StartedBot",
}

export type RKUpdate = {
  type: RKUpdateTypeEnum;
  chat_id: string;
  new_message?: RKMessage;
};

export type RKMessage = {
  message_id: string;
  text?: string;
  sender_type: "User" | "Bot";
  sender_id: string;
  aux_data: {
    start_id?: string;
  };
};

export type RKSendMessage = {
  chat_id: string;
  text: string;
  reply_to_message_id?: string;
};
