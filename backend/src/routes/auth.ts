import bcrypt from "bcryptjs";
import { Router } from "express";

import { ApiError, asyncHandler } from "../lib/errors";
import { signToken } from "../lib/jwt";
import { loginSchema, registerSchema } from "../lib/validation";
import { requireAuth } from "../middleware/auth";
import { prisma } from "../prisma";

const router = Router();

const publicUser = { id: true, email: true, username: true, createdAt: true } as const;

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const data = registerSchema.parse(req.body);

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: data.email }, { username: data.username }] },
      select: { email: true, username: true },
    });
    if (existing) {
      const field = existing.email === data.email ? "Email" : "Username";
      throw ApiError.conflict(`${field} is already registered`);
    }

    const hash = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.create({
      data: { email: data.email, username: data.username, password: hash },
      select: publicUser,
    });

    const token = signToken({ sub: user.id, username: user.username });
    res.status(201).json({ user, token });
  }),
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { identifier, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
    });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw ApiError.unauthorized("Invalid credentials");
    }

    const token = signToken({ sub: user.id, username: user.username });
    res.json({
      user: { id: user.id, email: user.email, username: user.username, createdAt: user.createdAt },
      token,
    });
  }),
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: publicUser,
    });
    if (!user) throw ApiError.unauthorized();
    res.json({ user });
  }),
);

export default router;
