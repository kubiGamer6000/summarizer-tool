import { z } from "zod";

export const SingleProcessedChatSchema = z.object({
  chatType: z.enum(["business", "personal"]),
  chatTypeConfidenceLevel: z.number().min(0).max(5),
  possibleEvents: z
    .array(
      z.object({
        eventName: z.string(),
        eventStartDateAndTime: z.string().describe("ISO 8601 format"),
        eventEndDateAndTime: z.string().describe("ISO 8601 format"),
        eventLocation: z.string().optional(),
        eventDescription: z.string(),
        eventParticipants: z.array(
          z.object({
            name: z.string(),
            id: z.string(),
          })
        ),
      })
    )
    .optional(),
});

export const SingleProcessedAndSummarizedChatSchema =
  SingleProcessedChatSchema.extend({
    fullDetailedSummary: z.string(),
  });
