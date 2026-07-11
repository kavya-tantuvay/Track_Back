import type { NextFunction, Request, Response } from "express";

import { ApiError } from "../lib/errors";
import { verifyToken } from "../lib/jwt";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      username?: string;
    }
  }
}

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return null;
}

/** Requires a valid JWT; attaches req.userId. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) return next(ApiError.unauthorized("Authentication required"));
  try {
    const payload = verifyToken(token);
    req.userId = payload.sub;
    req.username = payload.username;
    next();
  } catch {
    next(ApiError.unauthorized("Invalid or expired token"));
  }
}

/** Attaches req.userId if a valid token is present, but never rejects. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readToken(req);
  if (token) {
    try {
      const payload = verifyToken(token);
      req.userId = payload.sub;
      req.username = payload.username;
    } catch {
      /* ignore — anonymous request */
    }
  }
  next();
}
