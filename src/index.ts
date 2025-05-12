import "dotenv/config";

import { processRecentContactKnowledge } from "./process/contactKnowledge.js";

import { processMissingSummaries } from "./process/summarizeDay.js";

await processRecentContactKnowledge();
await processMissingSummaries();

console.log("All processes completed successfully");
