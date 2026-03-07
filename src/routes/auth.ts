import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { UserModel } from "../models/User";
import { env } from "../config/env";
import { authMiddleware } from "../middleware/auth";
import type { AuthenticatedRequest } from "../middleware/auth";

const router = Router();

router.get("/me", authMiddleware, async (req, res, next) => {
  try {
    const { user } = req as AuthenticatedRequest;
    if (!user?.sub) {
      return res.status(401).json({ message: "No autorizado" });
    }
    const dbUser = await UserModel.findById(user.sub)
      .select("email name role")
      .lean();
    if (!dbUser) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    res.json({ id: dbUser._id, email: dbUser.email, name: dbUser.name, role: dbUser.role });
  } catch (err) {
    next(err);
  }
});

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  password: z.string().min(6),
  role: z.enum(["admin", "user"]).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/register", async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);

    const existing = await UserModel.findOne({ email: data.email });
    if (existing) {
      return res.status(409).json({ message: "El email ya está registrado" });
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const user = new UserModel({
      email: data.email,
      name: data.name ?? undefined,
      passwordHash,
      role: data.role ?? "user",
    });
    await user.save();

    res.status(201).json({
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);

    const user = await UserModel.findOne({ email: data.email });
    if (!user) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    const ok = await bcrypt.compare(data.password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    const payload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    const token = jwt.sign(payload, env.jwtSecret, {
      expiresIn: "7d",
    });

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;

