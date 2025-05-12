import { renderMessages } from "../helpers/renderMessages.js";

import { FirestoreMessage } from "../types.js";
import { firestore } from "../services/firestore.js";
import { startOfDay } from "date-fns";

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

import { z } from "zod";
import { getAllChatsForDay } from "../helpers/chat-fns.js";
import dayjs from "dayjs";
import { config } from "dotenv";
import { HumanMessage } from "@langchain/core/messages";
import { SystemMessage } from "@langchain/core/messages";

config();

interface ChatData {
  chatId: string;
  chatDate: Date;
  chatTitle: string;
  renderedMessages: string;
  last10MessagesRendered: string;
  chatKnowledge: any;
}

export async function processDailyChats(day: Date) {
  try {
    // Get all chats from today
    const chatMap = await getAllChatsForDay(day);
    // TODO: FIX ANY TYPE
    const processedChats: any[] = [];

    // Process each chat

    for (const [chatId, messages] of chatMap.entries()) {
      console.log(`Processing chat ${chatId}`);
      const renderedMessages = renderMessages(messages);
      const chatRef = firestore
        .collection(process.env.FIRESTORE_CHATS_COLLECTION!)
        .doc(chatId);
      const chat = await chatRef.get();
      const chatName = chat.data()?.isGroup ? chat.data()?.name : chat.id;
      const chatKnowledge = chat.data()?.knowledge;
      // get the last 10 messages before the day for context
      const last10Messages = await getLastMessagesFromChatBeforeDate(
        chatId,
        startOfDay(day),
        10
      );
      const last10MessagesRendered = renderMessages(last10Messages);
      const chatTitle = `${chatName} (${chatId}) - ${dayjs(day).format(
        "DD-MM-YYYY"
      )}\n`;
      // // CHECK IF CHAT HAS ALREADY BEEN PROCESSED, by searching documents in the processedDailyChats collection with the same chatId and chatDate
      // const processedChatRef = await firestore
      //   .collection("processedDailyChats")
      //   .where("chatId", "==", chatId)
      //   .where("chatDate", ">=", startOfDay(day))
      //   .where("chatDate", "<=", endOfDay(day))
      //   .get();
      // if (processedChatRef.docs.length > 0) {
      //   console.log(`chat ${chatId} already processed`);
      //   const processedChat = processedChatRef.docs[0].data() as ChatData;
      //   processedChats.push(processedChat);
      //   continue;
      // }
      // const processedChat = await processChat(
      //   renderedMessages,
      //   last10MessagesRendered,
      //   chatTitle,
      //   messages,
      //   day
      // );
      const chatData: ChatData = {
        chatId,
        chatDate: day,
        chatTitle,
        renderedMessages,
        last10MessagesRendered,
        chatKnowledge,
      };
      processedChats.push(chatData);
    }

    const MAIN_PERSON_NAME = "Ace Jernberg";
    const MAIN_PERSON_CONTEXT = `
    Ace Blond (Jesper Jernberg) is the driving force behind Content Currency, a versatile agency based in Marbella that specializes in luxury videography, AI solutions, and development services.
    Working closely with his team—Veli handling AI and software engineering, and Casper focusing on videography and editing—Ace manages multiple client relationships and projects simultaneously.
    Forward-thinking and data-driven, Ace values leveraging communication intelligence to enhance business operations, which is why he's implemented a system to capture and analyze WhatsApp conversations.
    This approach reflects his commitment to connecting the bigger picture, maintaining comprehensive knowledge of his business ecosystem, and optimizing relationship management across his professional network.
    `;

    const ReminderSchema = z.object({
      reminderTitle: z
        .string()
        .describe("A concise and clear title for the reminder."),
      reminderDetails: z
        .string()
        .describe(
          "A more detailed description of the reminder, including any important details, context, and any other relevant information."
        ),
    });

    const KeyProgressSchema = z.object({
      projectName: z.string().describe("The name of the project/task/client."),
      progressSummary: z
        .string()
        .describe(
          "A concise 1-2 sentence summary of the progress made today on the project/task/client."
        ),
      progressDetails: z
        .string()
        .describe(
          "A more detailed description of the progress made today on the project/task/client, including any important details, context, and any other relevant information."
        ),
    });

    const SummarySchema = z.object({
      briefWalkthroughOfTheDay: z
        .string()
        .describe(
          "A quick introdcution plain text chronological walkthrough of the day, max 3-4 sentences."
        ),
      keyReminders: z
        .array(ReminderSchema)
        .describe(
          `Any key reminders for ${MAIN_PERSON_NAME}, such as important meetings, deadlines, or anything else he should be aware of.`
        ),
      forwardPlanning: z
        .array(z.string())
        .describe(
          "A short list of creative forward-planning future suggestions/ideas formatted as concise action steps."
        ),
      keyProgressMade: z
        .array(KeyProgressSchema)
        .describe(
          "A list of key progress made today for different projects/tasks/clients."
        ),
      fullSummary: z
        .string()
        .describe(
          "A full in-depthcomprehensive and detailed summary of the day in markdown format. No title."
        ),
    });

    const SUMMARY_SYSTEM = `
--Goal--
You are an expert WhatsApp chat analyst and consultant for ${MAIN_PERSON_NAME}. You generate detailed summaries and insights of his daily conversations, with attention to detail.
You help ${MAIN_PERSON_NAME} connect the dots between the different conversations and get reminded of anything he might be forgetting.

--Context--
${MAIN_PERSON_CONTEXT}

--Instructions--
You will receive a list of ALL whatsapp conversations of ${MAIN_PERSON_NAME} for a day (${day.toLocaleDateString()}).
You need to reason extensively about the different conversations, people and projects and how they are related to each other.
Your job is to generate a comprehensive and detailed summary of the day in the specific output schema outlined here using the provided tools!:

  - "briefWalkthroughOfTheDay" - A quick introdcution plain text chronological walkthrough of the day, max 3-4 sentences.
  In this walkthrough, talk to Ace as if you are his personal assistant, and give a quick overview of the day, chronologically, including any important events and "plot twists".

  - "keyReminders" - Any key reminders for ${MAIN_PERSON_NAME}, such as important meetings, deadlines, or anything else he should be aware of. Formatted in an array of objects with the following schema:
    - "reminderTitle" - A concise and clear title for the reminder.
    - "reminderDetails" - A more detailed description of the reminder, including any important details, context, and any other relevant information.

  - "forwardPlanning" - A short list of creative forward-planning future suggestions/ideas formatted as concise action steps for the near future. Ideas that ${MAIN_PERSON_NAME} might have not thought of.

  - "keyProgressMade" - A list of key progress made today for different projects/tasks/clients, formatted in an array of objects with the following schema:
    - "projectName" - The name of the project/task/client.
    - "progressSummary" - A concise 1-2 sentence summary of the progress made today on the project/task/client.
    - "progressDetails" - A more detailed description of the progress made today on the project/task/client, including any important details, context, and any other relevant information.

  - "fullSummary" - A full in-depth detailed summary of the day in markdown format.
  Write a comprehensive document that breaks down the following (but not limited to):
  - Key events and conversations, and a breakdown.
  - Key decisions made
  - Key insights gained
  - Key bottlenecks and room for improvement
  - Team dynamics - communication, task tracking, delegation...
  - Relationships between different people, projects and clients
  - Critical conversations, events and developments

  Do not only write bullet points - instead have more detailed paragraphs.

  MARKDOWN REQUIREMENTS:
  - Valid parsable markdown format
  - Do not start the summary off with a title or introduction, start directly with the content.
  - Do not include any # (big title) tags, since we don't have a title.
  - You have creative freedom over the exact structure of the summary, since every day is different and nuanced.
`;

    //     const summaryTypes = [
    //       {
    //         name: "default",
    //         prompt: "",
    //       },
    //       {
    //         name: "projects",
    //         prompt: `You will analyze Ace Blond's WhatsApp conversations from ${day.toLocaleDateString()}.
    // Organize the summary by active projects (Content Currency, client videography, AI solutions, etc.).
    // For each project:
    // - Summarize key developments and decisions
    // - Identify blockers or challenges mentioned
    // - Extract action items with owners and deadlines
    // - Note cross-project dependencies or resource conflicts
    // Conclude with a meta-analysis of overall project health and priorities.`,
    //       },
    //       {
    //         name: "clients",
    //         prompt: `Review all WhatsApp conversations from ${day.toLocaleDateString()} for Ace Blond.
    // Create a client-centered summary that:
    // - Identifies all client interactions and their context
    // - Analyzes client sentiment and satisfaction signals
    // - Extracts explicit and implicit client needs
    // - Highlights follow-up requirements and deadlines
    // - Suggests relationship maintenance actions
    // Organize by client priority and flag at-risk relationships.`,
    //       },
    //       {
    //         name: "team",
    //         prompt: `Analyze Ace's WhatsApp conversations from ${day.toLocaleDateString()}.
    // Generate a team dynamics summary that:
    // - Maps communication patterns between Ace, Veli, Casper, and collaborators
    // - Tracks task delegation and acceptance
    // - Identifies potential miscommunications or unacknowledged messages
    // - Suggests coordination improvements
    // - Highlights successful collaboration instances
    // Include a visual representation of information flow and potential bottlenecks.`,
    //       },
    //       {
    //         name: "business-intelligence",
    //         prompt: `Examine all WhatsApp conversations from ${day.toLocaleDateString()}.
    // Create a strategic business intelligence report that:
    // - Identifies market insights and competitive intelligence
    // - Spots emerging opportunities and potential threats
    // - Analyzes resource allocation across business activities
    // - Extracts insights about business performance
    // - Suggests strategic pivots or optimizations
    // Conclude with recommendations for business focus areas.`,
    //       },
    //       {
    //         name: "knowledge-graph",
    //         prompt: `Process Ace's WhatsApp conversations from ${day.toLocaleDateString()}.
    // Build a knowledge graph summary that:
    // - Identifies key entities (people, projects, concepts, tools)
    // - Maps relationships between these entities
    // - Tracks how knowledge about each entity evolved
    // - Connects new information to previously established facts
    // - Identifies knowledge gaps requiring clarification
    // Format output as interconnected topics with relationship descriptions.`,
    //       },
    //       {
    //         name: "action-planner",
    //         prompt: `Analyze WhatsApp conversations from ${day.toLocaleDateString()}.
    // Generate a forward-looking summary that:
    // - Predicts upcoming deadlines and critical events
    // - Identifies tasks likely to require attention soon
    // - Forecasts potential bottlenecks or resource constraints
    // - Suggests proactive actions to prevent issues
    // - Prioritizes opportunities requiring immediate action
    // Include confidence levels for predictions and time horizons.`,
    //       },
    //       {
    //         name: "decision-documentation",
    //         prompt: `Review all WhatsApp conversations from ${day.toLocaleDateString()}.
    // Create a decision-focused summary that:
    // - Documents all decisions made (explicit and implicit)
    // - Records context and factors considered for each decision
    // - Identifies decision makers and stakeholders
    // - Notes implementation requirements for each decision
    // - Tracks decision revisions or refinements
    // Organize by impact level and implementation timeline.`,
    //       },
    //       {
    //         name: "contextual-timeline",
    //         prompt: `Analyze Ace's WhatsApp conversations from ${day.toLocaleDateString()}.
    // Construct a narrative timeline that:
    // - Sequences key events and conversations chronologically
    // - Identifies cause-effect relationships between events
    // - Provides context by connecting to previous day's activities
    // - Highlights pivotal moments that shifted priorities or understanding
    // - Creates a coherent story of the day's professional journey
    // Include emotional arcs and "plot twists" in the day's development.`,
    //       },
    //       {
    //         name: "resource-allocation",
    //         prompt: `Process WhatsApp conversations from ${day.toLocaleDateString()}.
    // Generate a resource-focused summary that:
    // - Tracks time commitments made by team members
    // - Identifies tools, assets, and resources discussed
    // - Maps financial discussions and commitments
    // - Highlights potential resource conflicts or shortages
    // - Suggests resource optimization opportunities
    // Visualize resource allocation across projects and activities.`,
    //       },
    //       {
    //         name: "multi-level-pyramid",
    //         prompt: `Analyze WhatsApp conversations from ${day.toLocaleDateString()}.
    // Create a multi-level summary with increasing detail:
    // - Level 1: Executive summary (3 bullet points of critical information)
    // - Level 2: Key areas overview (projects, clients, team, opportunities)
    // - Level 3: Detailed breakdown of important conversations
    // - Level 4: Comprehensive analysis with all relevant details
    // Include navigation system allowing Ace to drill down into areas of interest.
    // Each level should preserve critical information while adding context and detail.`,
    //       },
    //     ];

    // Generate a clean template for each chat
    const generateChatTemplate = (chat: ChatData) => {
      const contextSection = chat.chatKnowledge?.shortDescription
        ? `\n---\nRelevant Context about the contact (THIS IS GENERAL INFORMATION ABOUT THE CONTACT, NOT THE CHAT - USE IT AS CONTEXT FOR THE PERSON BUT DON'T INCLUDE IT IN THE SUMMARY):\n${chat.chatKnowledge.shortDescription}`
        : "";

      return `--------------------------------
Chat Title: ${chat.chatTitle}
${contextSection}
---
Last 10 Chat Messages Before Today:
${chat.last10MessagesRendered}
---
Chat Messages From Today:
${chat.renderedMessages}

`;
    };

    // Combine all chat templates into a single string for the LLM input
    const chatTemplates = processedChats.map(generateChatTemplate).join("\n");

    // fs.writeFileSync(`./${dayjs(day).format("DD-MM-YYYY")}.md`, chatTemplates);
    // return;

    // const model = new ChatAnthropic({
    //   model: "claude-3-7-sonnet-latest",
    //   maxTokens: 64000,

    //   apiKey: process.env.ANTHROPIC_API_KEY,
    //   streaming: true,
    // }).withStructuredOutput(SummarySchema);

    const model = new ChatGoogleGenerativeAI({
      model: "gemini-2.5-pro-preview-05-06",
      apiKey: process.env.GOOGLE_API_KEY,
      temperature: 1,
      maxRetries: 6,
    }).withStructuredOutput(SummarySchema);

    const summary = await model.invoke([
      new SystemMessage(SUMMARY_SYSTEM),
      new HumanMessage(JSON.stringify(chatTemplates)),
    ]);

    // Store all summaries in Firebase
    const formattedDate = dayjs(day).format("DD-MM-YYYY");

    await firestore.collection("summaries").doc(formattedDate).set({
      date: day,
      summary,
      input: chatTemplates,
    });

    // return {
    //   processedChats,
    //   dailySummary,
    // };
  } catch (error) {
    console.error("Error processing daily chats:", error);
    throw error;
  }
}

// async function generateDailySummary(
//   processedChats: ChatData[],
//   day: Date,
//   prompt?: string,
//   schema?: z.AnyZodObject
// ) {
//   const DAILY_SUMMARY_SYSTEM = `You will receive a list of ALL whatsapp conversations of Ace Blond (Jernberg) for a day (${day.toLocaleDateString()}) in a raw format.
//   Your job is to reason and generate a comprehensive and detailed overview of the day.
//   You need to reason extensively about the different conversations, how they are related to each other, and what the key points are.
//   You need to first give a general overview of the day, then explore each point of importance in detail.
//   You need to connect the dots between the different conversations, and explain the bigger picture.
//   You need to give any possible reminders for the future, or any other important information that came up during the day.
//   Chats may have suggested events, which you need to also add to the summary, as events you suggest Ace might add to his calendar.
//   `;

//   const generateChatTemplate = (chat: ChatData) => {
//     return `--------------------------------
//     Chat Title: ${chat.chatTitle}
//     ---
//     Relevant Context about the contact:
//     ${chat.contactContext}
//     ---
//     Last 10 Chat Messages Before Today:
//     ${chat.last10MessagesRendered}
//     ---
//     Chat Messages From Today:
//     ${chat.renderedMessages}
//     ${
//       chat.possibleEvents && chat.possibleEvents.length > 0
//         ? `Suggested Events:
//     ${JSON.stringify(chat.possibleEvents)}`
//         : ""
//     }
//     --------------------------------
//     `;
//   };

//   const chatTemplate = processedChats.map(generateChatTemplate).join("\n");

//   // const response = await openai.chat.completions.create({
//   //   model: "gpt-4.5-preview",
//   //   messages: [
//   //     {
//   //       role: "system",
//   //       content: prompt ?? DAILY_SUMMARY_SYSTEM,
//   //     },
//   //     {
//   //       role: "user",
//   //       content: chatTemplate,
//   //     },
//   //   ],
//   //   // response_model: {
//   //   //   schema:
//   //   //     schema ??
//   //   //     z.object({
//   //   //       content: z.string().describe("Markdown Response"),
//   //   //     }),
//   //   //   name: "Summary",
//   //   // },
//   // });

//   const stream = anthropic.beta.messages.stream({
//     model: "claude-3-7-sonnet-latest",
//     max_tokens: 64000,
//     thinking: {
//       type: "enabled",
//       budget_tokens: 32000,
//     },
//     system: prompt ?? DAILY_SUMMARY_SYSTEM,
//     messages: [{ role: "user", content: chatTemplate }],
//   });

//   const message = await stream.finalMessage();

//   return message.content[1];
// }

async function getLastMessagesFromChatBeforeDate(
  chatId: string,
  date: Date,
  amount: number
) {
  const messagesRef = firestore.collection("messages_ace");
  const snapshot = await messagesRef
    .where("chatId", "==", chatId)
    .where("timestamp", "<=", date)
    .orderBy("timestamp", "desc")
    .limit(amount)
    .get();

  const messages = snapshot.docs.map((doc) => doc.data() as FirestoreMessage);
  return messages.reverse();
}

// Process daily chats for a date range
export async function processDailyChatsForDateRange(
  startDate: Date,
  endDate: Date
) {
  console.log(
    `Processing daily chats from ${startDate.toISOString().split("T")[0]} to ${
      endDate.toISOString().split("T")[0]
    }`
  );

  // Clone the start date to avoid modifying the original
  const currentDate = new Date(startDate);

  // Process each day in the range
  while (currentDate <= endDate) {
    console.log(
      `Processing chats for ${currentDate.toISOString().split("T")[0]}`
    );
    await processDailyChats(new Date(currentDate));

    // Move to the next day
    currentDate.setDate(currentDate.getDate() + 1);
  }
}

// To get yesterday's date:
export async function processDailyChatsForYesterday() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return await processDailyChats(yesterday);
}

/**
 * Process summaries for the past 14 days, filling in any missing days
 * and ensuring yesterday's summary is processed
 */
export async function processMissingSummaries() {
  try {
    console.log("Checking for missing summaries in the past 14 days...");

    // Calculate date range (14 days ago until yesterday)
    const yesterday = new Date();
    // yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0); // Set to start of day

    const startDate = new Date(yesterday);
    startDate.setDate(startDate.getDate() - 3); // 14 days ago including yesterday

    // Get all existing summaries for this date range
    const snapshot = await firestore
      .collection("summaries")
      .where("date", ">=", startDate)
      .where("date", "<=", yesterday)
      .get();

    // Create a map of existing summary dates (using formatted date as key)
    const existingSummaries = new Map<string, boolean>();
    snapshot.forEach((doc) => {
      existingSummaries.set(doc.id, true);
    });

    // Check each day in the range for missing summaries
    const currentDate = new Date(startDate);
    const processedDates: Date[] = [];

    while (currentDate <= yesterday) {
      const formattedDate = dayjs(currentDate).format("DD-MM-YYYY");

      if (!existingSummaries.has(formattedDate)) {
        console.log(`Missing summary for ${formattedDate}, processing...`);
        await processDailyChats(new Date(currentDate));
        processedDates.push(new Date(currentDate));
      } else {
        console.log(`Summary already exists for ${formattedDate}, skipping.`);
      }

      // Move to the next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Ensure yesterday's summary is processed (even if it already exists)
    const yesterdayFormatted = dayjs(yesterday).format("DD-MM-YYYY");
    if (
      !processedDates.some(
        (date) => dayjs(date).format("DD-MM-YYYY") === yesterdayFormatted
      )
    ) {
      console.log(`Processing yesterday's summary (${yesterdayFormatted})...`);
      await processDailyChats(yesterday);
    }

    console.log("All missing summaries have been processed.");
  } catch (error) {
    console.error("Error processing missing summaries:", error);
    throw error;
  }
}

// Replace the specific date call with the automated process
// processDailyChats(new Date("2025-05-07"));
processMissingSummaries();

// async function processChat(
//   renderedMessages: string,
//   last10MessagesRendered: string,
//   chatTitle: string,
//   messages: FirestoreMessage[],
//   day: Date
// ) {
//   const SINGLE_CHAT_SUMMARY_SYSTEM = `You will receive a WhatsApp chat conversation that Ace Blond (Jernberg) is involved in that happened on ${day.toLocaleDateString()}.
//   Your job is to thoroughly summarize and process the conversation
//             This could be a group chat or a personal chat.
//             You should summarize the conversation in a detailed manner, making sure not to leave out any key information! Be very detailed.
//             The full summary should include everything talked about in chronological order, any key points or conclusions made, especially if it was a business chat.
//             You will sort this conversation as either "business" or "personal", and also give a confidence level of your assessment (0-5)
//             You will also give a detailed summary of the conversation, including the context, the participants, and the key points.
//             Ace Blond is the founder of a marketing/videography/AI agency in Marbella called "Content Currency".
//             If the chat is from Veli or Casper, just know they are his business partners.
//             You should note down all explicitly scheduled meetings - if they have an agreed upon date and time, you should note them down in possibleEvents.
//             Do not assume any events, only note down what is explicitly scheduled or talked about.

//             You will receive all the messages for the day in a nicely rendered format, but also you will receive the last 10 messages before the day for additional context (if any).
//             These last 10 messages should NOT BE INCLUDED in the summary or processing, do not extract any events or information from them!! Just use them for context for the conversation.
//             `;
//   const SINGLE_CHAT_NO_SUMMARY_SYSTEM = `You will receive a WhatsApp chat conversation that Ace Blond (Jernberg) is involved in that happened on ${day.toLocaleDateString()}.
//             Your job is to process it, categorize it and extract any key information.
//             This chat could be a group chat or a personal chat.
//             You will sort this conversation as either "business" or "personal", and also give a confidence level of your assessment (0-5)
//             Ace Blond is the founder of a marketing/videography/AI agency in Marbella called "Content Currency".
//             If the chat is from Veli or Casper, just know they are his business partners.
//             You should note down all explicitly scheduled meetings - if they have an agreed upon date and time, you should note them down in possibleEvents.
//             Do not assume any events, only note down what is explicitly scheduled or talked about.

//             You will receive all the messages for the day in a nicely rendered format, but also you will receive the last 10 messages before the day for additional context (if any).
//             These last 10 messages should NOT BE INCLUDED in the processing, do not extract any events or information from them!! Just use them for context for the conversation.
//             `;

//   const processedChat = await openai.chat.completions.create({
//     model: "gpt-4o",
//     messages: [
//       {
//         role: "system",
//         content:
//           messages.length >= 20
//             ? SINGLE_CHAT_SUMMARY_SYSTEM
//             : SINGLE_CHAT_NO_SUMMARY_SYSTEM,
//       },
//       {
//         role: "user",
//         content: `Chat Info: ${chatTitle} \n
//             Last 10 messages before ${day.toLocaleDateString()}:\n
//             ${last10MessagesRendered}\n
//             --------------------------------
//             Chat Messages From today:\n
//             ${renderedMessages}`,
//       },
//     ],
//     response_model: {
//       schema:
//         messages.length >= 20
//           ? SingleProcessedAndSummarizedChatSchema
//           : SingleProcessedChatSchema,
//       name: "User",
//     },
//   });
//   // TEMPORARY: Remove the _meta field from the processedChat object
//   delete processedChat._meta;
//   return processedChat;
// }
