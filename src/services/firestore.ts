import { endOfDay } from "date-fns";
import admin from "firebase-admin";
import { FirestoreMessage } from "../types";
import { startOfDay } from "date-fns";
import { config } from "dotenv";

config();

if (!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  throw new Error(
    "FIREBASE_SERVICE_ACCOUNT_BASE64 environment variable is not set"
  );
}

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(
      Buffer.from(
        process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 as string,
        "base64"
      ).toString()
    )
  ),
});
export const firestore = admin.firestore();

firestore.settings({
  ignoreUndefinedProperties: true,
});
