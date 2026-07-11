import { z } from "zod";

import { CATEGORIES } from "../config";

export const registerSchema = z.object({
  email: z.string().email(),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers and underscores only"),
  password: z.string().min(8, "Password must be at least 8 characters").max(100),
});

export const loginSchema = z.object({
  // Accept either email or username in one field.
  identifier: z.string().min(1),
  password: z.string().min(1),
});

// Multipart form fields arrive as strings; coerce where needed.
export const createItemSchema = z.object({
  type: z.enum(["lost", "found"]),
  title: z.string().min(2).max(120),
  description: z.string().min(5).max(2000),
  category: z.enum(CATEGORIES),
  location: z.string().min(2).max(200),
  date: z.coerce.date(),
  contact: z.string().max(200).optional().or(z.literal("")),
});

export const listItemsSchema = z.object({
  type: z.enum(["lost", "found"]).optional(),
  category: z.enum(CATEGORIES).optional(),
  status: z.enum(["open", "resolved"]).optional(),
  q: z.string().max(200).optional(),
  mine: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type ListItemsQuery = z.infer<typeof listItemsSchema>;
