import jwt, { type SignOptions } from "jsonwebtoken";

import { config } from "../config";

export interface JwtPayload {
  sub: string; // user id
  username: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as SignOptions["expiresIn"],
  });
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, config.jwtSecret);
  if (typeof decoded === "string" || !decoded.sub) {
    throw new Error("Invalid token payload");
  }
  return { sub: String(decoded.sub), username: String((decoded as JwtPayload).username ?? "") };
}
