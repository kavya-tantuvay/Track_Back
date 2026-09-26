import type { NextFunction, Request, Response } from "express";

/**
 * One structured line per request: method, path, status, duration.
 * Deliberately tiny — enough to debug a deployment from the platform's log
 * tail without pulling in a logging framework.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`,
    );
  });
  next();
}
