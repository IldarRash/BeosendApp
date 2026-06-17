import { z } from "zod";

/**
 * Calendar-feed contracts (connectors §6). A feed is an account-light signed-token
 * .ics URL for a trainer's or client's upcoming trainings.
 */

/** Whose feed: a trainer's roster or a single client's bookings. */
export const calendarSubject = z.enum(["trainer", "client"]);
export type CalendarSubject = z.infer<typeof calendarSubject>;

/** The signed feed URL the admin/bot UI displays for a subject. */
export const calendarFeedLinkSchema = z.object({
  subject: calendarSubject,
  url: z.string().url()
});
export type CalendarFeedLink = z.infer<typeof calendarFeedLinkSchema>;
