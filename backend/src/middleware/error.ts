import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

import { ApiError } from "../lib/errors";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Route not found" });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Validation failed",
      details: err.flatten().fieldErrors,
    });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  // Prisma unique-constraint violation surfaces as code P2002.
  if (typeof err === "object" && err !== null && (err as any).code === "P2002") {
    return res.status(409).json({ error: "That value is already taken" });
  }

  console.error("[unhandled]", err);
  res.status(500).json({ error: "Internal server error" });
}
