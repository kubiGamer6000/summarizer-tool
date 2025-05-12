import { OpenAI } from "openai";
import { Anthropic } from "@anthropic-ai/sdk";
import Instructor from "@instructor-ai/instructor";
import dotenv from "dotenv";

dotenv.config();

// set up anthropic
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const oai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const openai = Instructor({
  client: oai,
  mode: "TOOLS",
});
