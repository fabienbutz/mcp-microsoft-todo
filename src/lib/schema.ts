import { z } from "zod";

const SYSTEM_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** Graph `dateTimeTimeZone` object as stored/returned by the API. */
export const DateTimeTimeZone = z.object({
  dateTime: z.string(),
  timeZone: z.string(),
});
export type DateTimeTimeZone = z.infer<typeof DateTimeTimeZone>;

/**
 * Tool-facing date-time input: either a bare ISO-8601 string (interpreted in the host's
 * timezone) or an explicit `{ dateTime, timeZone }` pair.
 */
export const DateTimeInput = z.union([
  z.string().describe("ISO-8601 local date-time, e.g. 2026-05-20T17:00:00 (host timezone)"),
  z.object({
    dateTime: z.string().describe("ISO-8601 date-time without offset, e.g. 2026-05-20T17:00:00"),
    timeZone: z.string().default(SYSTEM_TZ).describe("IANA timezone name, e.g. Europe/Berlin"),
  }),
]);
export type DateTimeInput = z.infer<typeof DateTimeInput>;

export function toGraphDateTime(input: DateTimeInput | undefined): DateTimeTimeZone | undefined {
  if (input === undefined) return undefined;
  if (typeof input === "string") return { dateTime: input, timeZone: SYSTEM_TZ };
  return { dateTime: input.dateTime, timeZone: input.timeZone };
}

export const Importance = z.enum(["low", "normal", "high"]);
export type Importance = z.infer<typeof Importance>;

export const TaskStatus = z.enum(["notStarted", "inProgress", "completed", "waitingOnOthers", "deferred"]);
export type TaskStatus = z.infer<typeof TaskStatus>;
