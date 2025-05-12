import type { MessageType, WAMessage } from "@whiskeysockets/baileys";
import type { Timestamp } from "firebase-admin/firestore";

export type FirestoreMessage = WAMessage & {
  // Additional fields added during storage
  chatId: string;
  timestamp: Timestamp;
  upsertType: "append" | "notify";
  processResult: string | null;
  isMedia: boolean;
  messageType: MessageType;
  mimeType: string | null;
};
