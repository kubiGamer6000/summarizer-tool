#!/usr/bin/env ts-node

import { exportSummaries } from "./exportSummaries";

(async () => {
  console.log("Starting the summaries export process...");
  await exportSummaries();
  console.log("Export process completed.");
})();
