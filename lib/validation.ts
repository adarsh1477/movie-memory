import { z } from "zod";

export const movieTitleSchema = z
  .string()
  .trim()
  .min(1, "Movie title is required")
  .max(120, "Movie title must be 120 characters or fewer");
