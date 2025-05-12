import "dotenv/config";
import { z } from "zod";
import dayjs from "dayjs";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { firestore } from "../services/firestore"; // Assuming firestore is initialized and exported from here
import type { Timestamp } from "firebase-admin/firestore";

// Define the schema for documents in the 'overviewKnowledge' collection
const OverviewKnowledgeSchema = z.object({
  startDate: z.date(),
  endDate: z.date(),
  compiledOverviewText: z
    .string()
    .describe("The compiled overview of developments over the period."),
  sourceSummaryIds: z
    .array(z.string())
    .describe("IDs of the daily summaries used (format DD-MM-YYYY)."),
  createdAt: z.date(),
  // previousOverviewDocId: z.string().optional().describe("ID of the overview document this one updates, if applicable."),
});

type OverviewKnowledge = z.infer<typeof OverviewKnowledgeSchema>;

// Define MAIN_PERSON_NAME and MAIN_PERSON_CONTEXT
const MAIN_PERSON_NAME = "Ace Jernberg"; // Ensure this matches your main user
const MAIN_PERSON_CONTEXT = `
Ace Blond (Jesper Jernberg) is a Swedish male entrepreneur based in Marbella, Spain.
He is the founder of Content Currency, a team of 3 people (Veli, Casper, and himself) that provides videography, editing, AI solutions and development services.
Besides that, he has many different projects and ventures including E-commerce (Scandinaviansmiles or "Scandi", a dental ecommerce brand owned by Javid and Elias), as well as personal projects and interests.
Ace values understanding the development of his projects, client relations, and team dynamics over time to make informed decisions.
This overview is for ${MAIN_PERSON_NAME} to quickly get up to speed on how things have evolved.
Do not hesitate to also include personal information if relevant to the developments, as not every relationship or project is strictly professional.
`;

// --- LLM Prompts ---
const INITIAL_OVERVIEW_SYSTEM_PROMPT = `
--Goal--
You are an expert analyst tasked with creating a comprehensive overview and knowledgebase of ${MAIN_PERSON_NAME}'s activities and developments over the last 30 days, based on a series of his daily summaries.
This overview will help ${MAIN_PERSON_NAME} understand trends, progress, and key changes and serve as a powerful knowledgebase mapping out his entire complex life.

--Context about ${MAIN_PERSON_NAME}--
${MAIN_PERSON_CONTEXT}

--Instructions--
You will be given a series of daily summaries of ${MAIN_PERSON_NAME}'s entire days. These summaries are derived from all of his WhatsApp chats.
Synthesize these into a single, coherent, comprehensive in-depth knowledgebase overview and analysis.
Structure your overivew with the following sections, but feel free to adapt or add subsections if the content warrants it:

1.  **Life & Network Overview :** A general overview of ${MAIN_PERSON_NAME}'s lifestyle, personality, situation, and a breakdown of his network and inner circle.
2.  **Key Projects & Clients:**
    *   For each major project or client, detail its progress, any significant events, decisions made, challenges faced, and overall status change during this period. Go in-depth, and for each one include a brief summary as well as detailed report and mention specific milestones that are relevant and important.
3.  **Task & Operational Development:**
    *   Summarize all important ongoing tasks or operational aspects not tied to a specific project and progress on them. (e.g., internal process improvements, new tools adopted). 
4.  **Relationship & Team Overview:**
    *   Do a full breakdown of relationships with key contacts, team members, or partners - map out his close circle, relationships, and key contacts and how different people are connected to each other and projects in detail. Make sure to develop a full profile of each person. Describe the progress of relationships and how they evolve.
5.  **Overall Trends & Strategic Insights:**
    *   Identify any overarching trends, emerging opportunities or threats, and strategic insights ${MAIN_PERSON_NAME} should be aware of based on the collective information from these days.

Also focus on how things have *developed or changed* over this period.
Highlight trends, significant events, progress made, and any emerging challenges or opportunities.
The output should be a long multi-page report, well-structured text in markdown format. Use headings (e.g., ## Key Projects & Clients) for clarity.
`;

const UPDATE_OVERVIEW_SYSTEM_PROMPT = `
--Goal--
You are an expert analyst tasked with updating an existing knowledgebase of ${MAIN_PERSON_NAME}'s activities with information from new daily summaries.
You will be given an in-depth document derived from many daily WhatsApp chats of ${MAIN_PERSON_NAME}.
This updated overview will help ${MAIN_PERSON_NAME} stay current on trends, progress, and key changes.

--Context about ${MAIN_PERSON_NAME}--
${MAIN_PERSON_CONTEXT}

--Instructions--
You are given:
1.  An existing overview that summarizes developments up to a certain point.
2.  A new set of daily summaries for subsequent days.

Your task is to integrate the information from the new daily summaries into the existing overview, extending its coverage to the new end date.
Follow the same structure as the original overview (Executive Summary, Key Projects & Clients, Task & Operational Development, Relationship Dynamics, Overall Trends & Strategic Insights).

Focus on:
*   Incorporating new developments from the new summaries into the relevant sections.
*   Updating the status or trajectory of items from the previous overview based on new information.
*   Identifying any new key projects, clients, tasks, or relationships that emerged in the latest summaries and adding them to the appropriate sections.
*   Revising the "Executive Summary" and "Overall Trends & Strategic Insights" to reflect the entire period covered by the updated overview.

Ensure the final output is a single, coherent, and updated overview in markdown format, covering the entire period (original start date to new end date).
Maintain the style and level of detail of the original overview. Use headings (e.g., ## Key Projects & Clients) for clarity.
`;

interface DailySummaryData {
  id: string; // Formatted date "DD-MM-YYYY"
  date: Date;
  fullSummary: string;
}

async function getDailySummaries(
  startDate: Date,
  endDate: Date
): Promise<DailySummaryData[]> {
  const snapshot = await firestore
    .collection("summaries")
    .where("date", ">=", startDate)
    .where("date", "<=", endDate)
    .orderBy("date", "asc")
    .get();

  if (snapshot.empty) {
    return [];
  }

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    // The 'summaries' collection stores the daily summary object under a 'summary' field,
    // and the actual text is in 'summary.fullSummary'.
    // The document ID is the formatted date string "DD-MM-YYYY".
    // The 'date' field in Firestore is a Timestamp.
    return {
      id: doc.id,
      date: (data.date as Timestamp).toDate(),
      fullSummary: data.summary?.fullSummary || "",
    };
  });
}

async function compileHistoricalOverview(
  summariesToCompile: DailySummaryData[]
): Promise<OverviewKnowledge | null> {
  if (summariesToCompile.length === 0) {
    console.log("No summaries provided for initial compilation.");
    return null;
  }

  const firstSummary = summariesToCompile[0];
  const lastSummary = summariesToCompile[summariesToCompile.length - 1];

  const concatenatedSummaries = summariesToCompile
    .map(
      (s) =>
        `Summary for ${dayjs(s.date).format("DD-MM-YYYY")}:\n${s.fullSummary}`
    )
    .join("\n\n---\n\n");

  const model = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-pro-preview-05-06",
    apiKey: process.env.GOOGLE_API_KEY,
    temperature: 0.7,
    maxRetries: 6,
  });

  console.log(
    `Compiling initial overview from ${dayjs(firstSummary.date).format(
      "DD-MM-YYYY"
    )} to ${dayjs(lastSummary.date).format("DD-MM-YYYY")}`
  );

  const response = await model.invoke([
    new SystemMessage(INITIAL_OVERVIEW_SYSTEM_PROMPT),
    new HumanMessage(concatenatedSummaries),
  ]);

  const compiledText =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  const overviewData: OverviewKnowledge = {
    startDate: firstSummary.date,
    endDate: lastSummary.date,
    compiledOverviewText: compiledText,
    sourceSummaryIds: summariesToCompile.map((s) => s.id),
    createdAt: new Date(),
  };

  OverviewKnowledgeSchema.parse(overviewData); // Validate before saving

  const overviewDocId = `overview_${dayjs(overviewData.startDate).format(
    "YYYYMMDD"
  )}_${dayjs(overviewData.endDate).format("YYYYMMDD")}_${Date.now()}`;
  await firestore
    .collection("overviewKnowledge")
    .doc(overviewDocId)
    .set(overviewData);
  console.log(`Stored initial overview with ID: ${overviewDocId}`);
  return overviewData;
}

async function updateExistingOverview(
  latestOverview: OverviewKnowledge & { id: string },
  newDailySummaries: DailySummaryData[]
): Promise<OverviewKnowledge | null> {
  if (newDailySummaries.length === 0) {
    console.log("No new daily summaries to update the overview.");
    return null;
  }

  const lastNewSummary = newDailySummaries[newDailySummaries.length - 1];

  const newSummariesText = newDailySummaries
    .map(
      (s) =>
        `New summary for ${dayjs(s.date).format("DD-MM-YYYY")}:\n${
          s.fullSummary
        }`
    )
    .join("\n\n---\n\n");

  const model = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-pro-preview-05-06",
    apiKey: process.env.GOOGLE_API_KEY,
    temperature: 0.7,
    maxRetries: 6,
  });

  console.log(
    `Updating overview (ID: ${latestOverview.id}, ends ${dayjs(
      latestOverview.endDate
    ).format("DD-MM-YYYY")}) with ${
      newDailySummaries.length
    } new summaries up to ${dayjs(lastNewSummary.date).format("DD-MM-YYYY")}`
  );

  const humanMessageContent = `
Previous Overview (covering ${dayjs(latestOverview.startDate).format(
    "DD-MM-YYYY"
  )} to ${dayjs(latestOverview.endDate).format(
    "DD-MM-YYYY"
  )} - please adhere to its structure):
${latestOverview.compiledOverviewText}

---
New Daily Summaries to integrate:
${newSummariesText}
  `;

  const response = await model.invoke([
    new SystemMessage(UPDATE_OVERVIEW_SYSTEM_PROMPT),
    new HumanMessage(humanMessageContent),
  ]);

  const updatedText =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  const updatedOverviewData: OverviewKnowledge = {
    startDate: latestOverview.startDate,
    endDate: lastNewSummary.date,
    compiledOverviewText: updatedText,
    sourceSummaryIds: [
      ...latestOverview.sourceSummaryIds,
      ...newDailySummaries.map((s) => s.id),
    ],
    createdAt: new Date(),
  };

  OverviewKnowledgeSchema.parse(updatedOverviewData);

  const overviewDocId = `overview_${dayjs(updatedOverviewData.startDate).format(
    "YYYYMMDD"
  )}_${dayjs(updatedOverviewData.endDate).format("YYYYMMDD")}_${Date.now()}`;
  await firestore
    .collection("overviewKnowledge")
    .doc(overviewDocId)
    .set(updatedOverviewData);
  console.log(`Stored updated overview with ID: ${overviewDocId}`);
  return updatedOverviewData;
}

export async function manageOverviewCompilation() {
  console.log("Managing overview compilation process...");

  const latestOverviewSnapshot = await firestore
    .collection("overviewKnowledge")
    .orderBy("endDate", "desc")
    .orderBy("createdAt", "desc") // In case multiple have the same endDate
    .limit(1)
    .get();

  let latestOverviewDocument: (OverviewKnowledge & { id: string }) | null =
    null;

  if (!latestOverviewSnapshot.empty) {
    const doc = latestOverviewSnapshot.docs[0];
    const data = doc.data();
    latestOverviewDocument = {
      id: doc.id,
      startDate: (data.startDate as Timestamp).toDate(),
      endDate: (data.endDate as Timestamp).toDate(),
      compiledOverviewText: data.compiledOverviewText,
      sourceSummaryIds: data.sourceSummaryIds,
      createdAt: (data.createdAt as Timestamp).toDate(),
    };
    console.log(
      `Found latest overview (ID: ${
        latestOverviewDocument.id
      }) ending on: ${dayjs(latestOverviewDocument.endDate).format(
        "DD-MM-YYYY"
      )}`
    );
  } else {
    console.log(
      "No existing compiled overview found. Will attempt to create an initial 30-day compilation."
    );
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0); // Consider summaries up to end of today

  if (!latestOverviewDocument) {
    // Initial compilation: Use last 30 days ending today
    const endDateInitial = new Date(today);
    const startDateInitial = new Date(endDateInitial);
    startDateInitial.setDate(endDateInitial.getDate() - 29); // 14 days in total

    console.log(
      `Fetching daily summaries for initial compilation: ${dayjs(
        startDateInitial
      ).format("DD-MM-YYYY")} to ${dayjs(endDateInitial).format("DD-MM-YYYY")}`
    );
    const summariesForInitial = await getDailySummaries(
      startDateInitial,
      endDateInitial
    );

    if (summariesForInitial.length > 0) {
      await compileHistoricalOverview(summariesForInitial);
    } else {
      console.log(
        "No daily summaries found for the initial 30-day period. Cannot create overview."
      );
    }
  } else {
    // Update existing overview
    const dayAfterLastOverview = new Date(latestOverviewDocument.endDate);
    dayAfterLastOverview.setDate(dayAfterLastOverview.getDate() + 1);
    dayAfterLastOverview.setHours(0, 0, 0, 0);

    if (dayAfterLastOverview > today) {
      console.log(
        "Latest overview is already up-to-date (covers through yesterday or today). No new summaries to process."
      );
      return;
    }

    console.log(
      `Fetching new daily summaries from ${dayjs(dayAfterLastOverview).format(
        "DD-MM-YYYY"
      )} to ${dayjs(today).format("DD-MM-YYYY")} for update.`
    );
    const newDailySummaries = await getDailySummaries(
      dayAfterLastOverview,
      today
    );

    if (newDailySummaries.length === 0) {
      console.log(
        "No new daily summaries found since the last overview compilation."
      );
      return;
    }

    const MAX_SUMMARIES_PER_UPDATE = 3;
    const summariesToUpdateWith = newDailySummaries.slice(
      0,
      MAX_SUMMARIES_PER_UPDATE
    );

    if (summariesToUpdateWith.length > 0) {
      await updateExistingOverview(
        latestOverviewDocument,
        summariesToUpdateWith
      );
    } else {
      // This case should ideally not be hit if newDailySummaries.length > 0 check passed
      console.log("No summaries selected for this update iteration.");
    }
  }
  console.log("Overview compilation management finished.");
}

// To run this script:
// Ensure Firestore is initialized (admin.initializeApp(...) etc.)
// Call the main function

manageOverviewCompilation()
  .then(() => {
    console.log("Script finished successfully.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  });
