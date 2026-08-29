import { z } from "zod";

export const CalendlyUrlSchema = z
  .string()
  .trim()
  .url("A valid Calendly URL is required.")
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "calendly.com";
    } catch {
      return false;
    }
  }, "Calendly URL must use HTTPS and the calendly.com host.");

export const OptionalCalendlyUrlSchema = z
  .union([CalendlyUrlSchema, z.literal(""), z.null()])
  .transform((value) => value || null);