import { endOfDay } from "date-fns";
import { startOfDay } from "date-fns";
import { firestore } from "../services/firestore";
import { FirestoreMessage } from "../types";

export async function getAllChatsForDay(
  day?: Date
): Promise<Map<string, FirestoreMessage[]>> {
  console.log("getting daily chats");
  const today = day ?? new Date();
  const messagesRef = firestore.collection("messages_ace");

  const snapshot = await messagesRef
    .where("timestamp", ">=", startOfDay(today)) // subtract 2 hours from start
    .where(
      "timestamp",
      "<=",
      new Date(endOfDay(today).getTime() + 2 * 60 * 60 * 1000)
    ) // add 2 hours to end
    .orderBy("timestamp", "asc")
    .get();

  // Group messages by chatId
  const chatMap = new Map<string, FirestoreMessage[]>();

  snapshot.forEach((doc) => {
    const message = doc.data() as FirestoreMessage;

    // Skip messages with chatId "status@broadcast"
    if (message.chatId === "status@broadcast") {
      return;
    }

    const existingChat = chatMap.get(message.chatId) || [];
    chatMap.set(message.chatId, [...existingChat, message]);
  });

  console.log(`got ${chatMap.size} chats`);
  return chatMap;
}
