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

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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

