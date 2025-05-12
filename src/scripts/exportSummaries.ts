import * as fs from "fs";
import * as path from "path";
import { firestore } from "../services/firestore";
import { Timestamp } from "firebase-admin/firestore";

interface Summary {
  date: Timestamp;
  [key: string]: any; // Allow for other properties in the summary
}

async function exportSummaries(): Promise<void> {
  try {
    console.log("Starting export of summaries...");

    // Get all documents from the summaries collection
    const snapshot = await firestore
      .collection("summaries")
      .orderBy("date", "asc") // Sort by date in ascending order (oldest first)
      .get();

    if (snapshot.empty) {
      console.log("No summaries found in the collection.");
      return;
    }

    // Transform the documents to include their IDs
    const summaries: Array<Summary & { id: string }> = [];
    snapshot.forEach((doc) => {
      summaries.push({
        id: doc.id,
        ...(doc.data() as Summary),
      });
    });

    console.log(`Retrieved ${summaries.length} summaries from Firestore.`);

    // Create the output directory if it doesn't exist
    const outputDir = path.join(process.cwd(), "output");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Generate a timestamp for the filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputPath = path.join(outputDir, `summaries-${timestamp}.json`);

    // Write the summaries to a JSON file
    fs.writeFileSync(
      outputPath,
      JSON.stringify(
        summaries,
        (key, value) => {
          // Convert Timestamp objects to ISO string dates for better readability
          if (value && value.toDate && typeof value.toDate === "function") {
            return value.toDate().toISOString();
          }
          return value;
        },
        2
      )
    );

    console.log(`Successfully exported summaries to: ${outputPath}`);
  } catch (error) {
    console.error("Error exporting summaries:", error);
    process.exit(1);
  }
}

exportSummaries()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });

export { exportSummaries };
