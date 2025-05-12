// TODO
// - Create function to store all knoledge about a contact for a given day [ ]
// - - Create a function to get chats for a given contact for a given day and render them [ ]
// - - Create a function that extracts structured and unstructured knowledge from a chat with LLM [ ]
// - - - Maps out relationships with other possible contacts & projects (future todo, after we have 1 week knowledge of everyone)
// - - - Finds relation to current tasks [ ]
// - - - Has a brief description of the contact, their category (close-friend) [ ]
// - - Update the current knowledge with today's knowledge (with another LLM call) [ ]
// - - Store the knowledge in firestore, with versioning, and latest version [ ]

import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { getAllChatsForDay } from "../helpers/chat-fns.js";
import { renderMessages } from "../helpers/renderMessages.js";
import type { FirestoreMessage } from "../types.js";

import { firestore } from "../services/firestore.js";

import { z } from "zod";
import { config } from "dotenv";
import { DocumentSnapshot } from "firebase-admin/firestore";
import { DocumentData } from "firebase-admin/firestore";

import dayjs from "dayjs";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";

config();

const MAIN_PERSON_NAME = "Ace Jernberg";
const MAIN_PERSON_CONTEXT = `
Ace Blond (Jesper Jernberg) is a Swedish male entrepreneur based in Marbella, Spain.
He is the founder of Content Currency, a team of 3 people that provides videography, editing, AI solutions and development services.
Besides that, he has many different projects and ventures, as well as personal projects and interests.

Do not hesitate to also include personal information about the contact or project - as not every relationship is professional.
`;

const ContactKnowledgeSchema = z.object({
  relationToMainPerson: z
    .string()
    .describe(
      `A brief description of how the contact is related to ${MAIN_PERSON_NAME}.`
    ),
  fullDescription: z
    .string()
    .describe(
      `A detailed description of the contact based on the interaction.`
    ),
  shortDescription: z
    .string()
    .describe(
      `A short description of the contact - 1-3 sentences giving a general overview.`
    ),
});

const SCHEMA_DESCRIPTION = `
- relationToMainPerson: A brief description of how the contact is related to ${MAIN_PERSON_NAME}.
This should be a short description, 1-3 sentences, explaining the dynamic of the relationship.

- fullDescription: A detailed description of the contact based on the interaction.
This detailed description should include:
    - Different projects/ventures the contact is involved in with ${MAIN_PERSON_NAME} and their current status(if applicable)
    - Key events that happened between the contact and ${MAIN_PERSON_NAME}, with specified date (if applicable)
    - Other key figures that are relevant to know about the contact and have a relationship to them in any way
    - A full detailed profile of the contact, including the dynamic between the contact and ${MAIN_PERSON_NAME}, notes about their personality, behaviour and anything else that is relevant.

- shortDescription: A short summary of the description of the contact - 1-3 sentences giving a general brief overview of the contact.
`;

const CONTACT_KNOWLEDGE_FOR_DAY_INITIAL_SYSTEM = `
--Goal--
You are an expert chat analyst that extracts knowledge about a specific contact of ${MAIN_PERSON_NAME}.
Your goal is to note down everything you learn about this contact in a structured format.

--Context--
${MAIN_PERSON_CONTEXT}

--Instructions--
You will be given a list of messages between ${MAIN_PERSON_NAME} and the contact for a given day.
Your job is to extract a full knowledge profile about the contact based on the interaction, adhering to the following schema:

${SCHEMA_DESCRIPTION} 
      --`;

const CONTACT_KNOWLEDGE_FOR_DAY_UPDATE_SYSTEM = `
--Goal--
You are an expert chat analyst that analyzes new chat data and updates a knowledge profile about a specific contact of ${MAIN_PERSON_NAME}.
Your goal is to analyze the chat with the contact, and update the already existing knowledge profile about the contact.
IMPORTANT: Retain current information about the contact - you can update what is new or has changed, or change the way you understand the relationship, but do not remove any information.

--Context--
${MAIN_PERSON_CONTEXT}

--Instructions--
You will be given a list of messages between ${MAIN_PERSON_NAME} and the contact for a given day, as well as the already existing knowledge profile about the contact.
Your job is to analyze the chat with the contact, and knowing the already existing knowledge, update or add anything that's necessary, according to the following schema:

${SCHEMA_DESCRIPTION}

You need to update these specified fields, adding any new information and correcting or enriching knowledge about existing information.
You also need to update the understanding of the relationship between the contact and ${MAIN_PERSON_NAME}, now knowing today's interactions.
`;

export const updateAllContactsKnowledgeForDay = async (day: Date) => {
  console.log(
    `Updating knowledge for all contacts for ${dayjs(day).format("DD-MM-YYYY")}`
  );
  const chatMap = await getAllChatsForDay(day);

  for (const [chatId, messages] of chatMap.entries()) {
    // Fetch the contact data from firestore
    const chatDoc = await firestore
      .collection(process.env.FIRESTORE_CHATS_COLLECTION!)
      .doc(chatId)
      .get();

    const contactData = chatDoc.data();

    // TODO: Add support for group chats. Skip for now.
    if (contactData?.isGroup || chatId.endsWith("@broadcast")) {
      console.log(`- Skipping chat ${chatId}`);
      continue;
    }
    const contactKnowledge = await processContactKnowledgeForDay(
      chatId,
      day,
      messages,
      chatDoc
    );

    // store knowledge in a subcollection of the chat doc
    await firestore
      .collection(process.env.FIRESTORE_CHATS_COLLECTION!)
      .doc(chatId)
      .collection("knowledge")
      .doc(dayjs(day).format("DD-MM-YYYY"))
      .set(contactKnowledge);

    // Update the contact knowledge in the contacts collection
    await firestore
      .collection(process.env.FIRESTORE_CHATS_COLLECTION!)
      .doc(chatId)
      .update({
        knowledge: contactKnowledge,
      });
  }
};

/**
 * Process contact knowledge sequentially day by day, ensuring each day builds on previous knowledge
 */
export async function processSequentialContactKnowledge(
  startDate: Date,
  endDate: Date
) {
  try {
    console.log(
      `Processing sequential contact knowledge from ${dayjs(startDate).format(
        "DD-MM-YYYY"
      )} to ${dayjs(endDate).format("DD-MM-YYYY")}`
    );

    // For each day in range
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const formattedDate = dayjs(currentDate).format("DD-MM-YYYY");
      console.log(`Processing contact knowledge for ${formattedDate}`);

      // Get all chats for the current day
      const chatMap = await getAllChatsForDay(currentDate);

      for (const [chatId, messages] of chatMap.entries()) {
        // Skip group chats
        const chatDoc = await firestore
          .collection(process.env.FIRESTORE_CHATS_COLLECTION!)
          .doc(chatId)
          .get();

        const contactData = chatDoc.data();
        if (
          !contactData ||
          contactData.isGroup ||
          chatId.endsWith("@broadcast")
        ) {
          console.log(`- Skipping chat ${chatId}`);
          continue;
        }

        const contactName = contactData.name || chatId;

        // Check if knowledge already exists for this day
        const knowledgeDoc = await firestore
          .collection(process.env.FIRESTORE_CHATS_COLLECTION!)
          .doc(chatId)
          .collection("knowledge")
          .doc(formattedDate)
          .get();

        if (knowledgeDoc.exists) {
          console.log(
            `- Knowledge for ${contactName} on ${formattedDate} already exists, skipping.`
          );
          continue;
        }

        // Find the most recent knowledge before this day
        let previousDate = new Date(currentDate);
        previousDate.setDate(previousDate.getDate() - 1);
        let previousKnowledge = null;

        // Look back up to 30 days to find previous knowledge
        for (let i = 0; i < 30; i++) {
          const prevFormattedDate = dayjs(previousDate).format("DD-MM-YYYY");
          const prevKnowledgeDoc = await firestore
            .collection(process.env.FIRESTORE_CHATS_COLLECTION!)
            .doc(chatId)
            .collection("knowledge")
            .doc(prevFormattedDate)
            .get();

          if (prevKnowledgeDoc.exists) {
            previousKnowledge = prevKnowledgeDoc.data();
            console.log(
              `- Found previous knowledge for ${contactName} from ${prevFormattedDate}`
            );
            break;
          }

          previousDate.setDate(previousDate.getDate() - 1);
        }

        // If no previous knowledge was found, use any existing knowledge in the contact document
        if (!previousKnowledge && contactData.knowledge) {
          previousKnowledge = contactData.knowledge;
          console.log(`- Using existing contact knowledge for ${contactName}`);
        }

        // Process contact knowledge for current day based on previous knowledge
        console.log(
          `- Processing knowledge for ${contactName} on ${formattedDate}`
        );
        const newKnowledge = await processContactKnowledgeForDay(
          chatId,
          currentDate,
          messages,
          chatDoc,
          previousKnowledge
        );

        // Store knowledge in subcollection with current date
        await firestore
          .collection(process.env.FIRESTORE_CHATS_COLLECTION!)
          .doc(chatId)
          .collection("knowledge")
          .doc(formattedDate)
          .set(newKnowledge);

        // Update the contact with latest knowledge
        await firestore
          .collection(process.env.FIRESTORE_CHATS_COLLECTION!)
          .doc(chatId)
          .update({
            knowledge: newKnowledge,
          });

        console.log(
          `- Knowledge for ${contactName} on ${formattedDate} updated successfully`
        );
      }

      // Move to the next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    console.log("Sequential contact knowledge processing complete.");
  } catch (error) {
    console.error("Error processing sequential contact knowledge:", error);
    throw error;
  }
}

// Update the processContactKnowledgeForDay function to accept previousKnowledge parameter
const processContactKnowledgeForDay = async (
  jid: string,
  day: Date,
  messages: FirestoreMessage[],
  chatDoc: DocumentSnapshot<DocumentData>,
  previousKnowledge: any = null
) => {
  console.log(`- - Processing knowledge for ${jid}`);
  // Render Firestore messages to plain text string for LLM
  const renderedMessages = renderMessages(messages);

  const contactData = chatDoc.data();

  if (!contactData) {
    throw new Error(`- - Contact data not found for ${jid}`);
  }

  // Skip if there are no messages to process for the day
  if (!renderedMessages || renderedMessages.trim() === "") {
    console.log(
      `- - No new messages for ${jid} on ${dayjs(day).format(
        "DD-MM-YYYY"
      )}. Skipping LLM call.`
    );
    // Return previous knowledge or a default structure if no new messages
    return (
      previousKnowledge ||
      contactData.knowledge || {
        relationToMainPerson: "No new interaction to update.",
        fullDescription: "No new interaction to update.",
        shortDescription: "No new interaction to update.",
      }
    );
  }

  const contactName = contactData.name || jid;

  // Use provided previous knowledge or fall back to existing knowledge
  const existingKnowledge = previousKnowledge || contactData.knowledge;
  console.log(
    existingKnowledge
      ? `- - Existing knowledge found for ${contactName}. Updating...`
      : `- - No existing knowledge found for ${contactName}. Creating new...`
  );

  const prompt = [
    new SystemMessage(
      existingKnowledge
        ? CONTACT_KNOWLEDGE_FOR_DAY_UPDATE_SYSTEM
        : CONTACT_KNOWLEDGE_FOR_DAY_INITIAL_SYSTEM
    ),
    new HumanMessage(
      existingKnowledge
        ? `Existing knowledge about ${contactName}:\n${JSON.stringify(
            existingKnowledge,
            null,
            2
          )}`
        : "No existing knowledge found."
    ),
    new HumanMessage(
      `Chat between ${MAIN_PERSON_NAME} and ${contactName} on ${dayjs(
        day
      ).format("DD-MM-YYYY")}:\n${renderedMessages}`
    ),
  ];

  const geminiModel = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-pro-preview-05-06",
    apiKey: process.env.GOOGLE_API_KEY,
    temperature: 0.5,
    maxRetries: 6, // Reduced retries for faster fallback
  }).withStructuredOutput(ContactKnowledgeSchema);

  const openaiModel = new ChatOpenAI({
    modelName: "gpt-4o",
    apiKey: process.env.OPENAI_API_KEY,
    temperature: 0.5,
    maxRetries: 3,
  }).withStructuredOutput(ContactKnowledgeSchema);

  let response;
  try {
    console.log(`- - - Attempting to process with Gemini for ${contactName}`);
    response = await geminiModel.invoke(prompt);
    console.log(`- - - Gemini processed successfully for ${contactName}`);
  } catch (geminiError) {
    console.error(`- - - Gemini failed for ${contactName}:`, geminiError);
    console.log(`- - - Attempting fallback to GPT-4o for ${contactName}`);
    try {
      response = await openaiModel.invoke(prompt);
      console.log(`- - - GPT-4o processed successfully for ${contactName}`);
    } catch (openaiError) {
      console.error(
        `- - - GPT-4o also failed for ${contactName}:`,
        openaiError
      );
      throw openaiError; // Re-throw if both models fail
    }
  }

  console.log(`- - Knowledge for ${contactName} processed`);
  return response;
};

// Function to process the last 14 days sequentially
export async function processRecentContactKnowledge() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const startDate = new Date(yesterday);
  startDate.setDate(startDate.getDate() - 3); // 14 days ago including yesterday

  await processSequentialContactKnowledge(startDate, yesterday);
}

// Replace the specific date range loop with the sequential processing
// for (
//   let day = new Date("2025-04-20");
//   day <= new Date("2025-05-06");
//   day.setDate(day.getDate() + 1)
// ) {
//   await updateAllContactsKnowledgeForDay(day);
// }

processRecentContactKnowledge();
