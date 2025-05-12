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

import { getAllChatsForDay } from "../helpers/chat-fns";
import { renderMessages } from "../helpers/renderMessages";
import type { FirestoreMessage } from "../types";

import { firestore } from "../services/firestore";

import { z } from "zod";
import { config } from "dotenv";
import { DocumentSnapshot } from "firebase-admin/firestore";
import { DocumentData } from "firebase-admin/firestore";

import dayjs from "dayjs";

config();

const MAIN_PERSON_NAME = "Ace Jernberg";
const MAIN_PERSON_CONTEXT = `
Ace Blond (Jesper Jernberg) is a male entrepreneur based in Marbella, Spain.
He is the founder of Content Currency, a team of 3 people that provides videography, editing, AI solutions and development services.
Besides that, he has many different projects and ventures, as well as personal projects and interests.
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

const processContactKnowledgeForDay = async (
  jid: string,
  day: Date,
  messages: FirestoreMessage[],
  chatDoc: DocumentSnapshot<DocumentData>
) => {
  console.log(`- - Processing knowledge for ${jid}`);
  // Render Firestore messages to plain text string for LLM
  const renderedMessages = renderMessages(messages);

  const contactData = chatDoc.data();

  if (!contactData) {
    throw new Error(`- - Contact data not found for ${jid}`);
  }

  const contactName = contactData.name || jid;

  const existingKnowledge = contactData.knowledge;
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
        : ""
    ),
    new HumanMessage(
      `Chat between ${MAIN_PERSON_NAME} and ${contactName} on ${dayjs(
        day
      ).format("DD-MM-YYYY")}:\n${renderedMessages}`
    ),
  ];

  const model = new ChatAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: "claude-3-7-sonnet-20250219",
    temperature: 0.0,
    maxTokens: 10000,
  }).withStructuredOutput(ContactKnowledgeSchema);

  // TODO: Add relationship to other contacts mapping
  // TODO: Add updating of tasks

  const response = await model.invoke(prompt);
  console.log(`- - Knowledge for ${contactName} processed`);
  return response;
};

// loop for every day between run it for april 14th 2025 and april 19th 2025
for (
  let day = new Date("2025-04-20");
  day <= new Date("2025-05-06");
  day.setDate(day.getDate() + 1)
) {
  await updateAllContactsKnowledgeForDay(day);
}
