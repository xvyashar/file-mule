export enum UpdateTypeEnum {
  NewMessage = "NewMessage",
  StartedBot = "StartedBot",
}

export type Update = {
  type: UpdateTypeEnum;
  chat_id: string;
  new_message?: Message;
};

export type Message = {
  message_id: string;
  text?: string;
  sender_type: "User" | "Bot";
  sender_id: string;
  aux_data: {
    start_id?: string;
  };
};

export type SendMessage = {
  chat_id: string;
  text: string;
  reply_to_message_id?: string;
};
