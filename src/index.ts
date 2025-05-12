import express from "express";
import { processDailyChats } from "./process";

const app = express();

app.get("/daily-summary", async (req, res) => {
  try {
    const result = await processDailyChats(new Date());

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to generate daily summary" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
