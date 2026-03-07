import { Router } from "express";
import { z } from "zod";
import { BillingConfigModel } from "../models/BillingConfig";
import type { AuthenticatedRequest } from "../middleware/auth";

const router = Router();

const bodySchema = z.object({
  clinicPercentage: z.number().min(0).max(100),
  insurancePercentage: z.number().min(0).max(100),
});

router.get("/", async (req, res, next) => {
  try {
    const { user } = req as AuthenticatedRequest;
    if (!user?.sub) {
      return res.status(401).json({ message: "No autorizado" });
    }
    const config = await BillingConfigModel.findOne({ userId: user.sub }).lean();
    res.json(
      config ?? { clinicPercentage: 0, insurancePercentage: 0 },
    );
  } catch (err) {
    next(err);
  }
});

router.put("/", async (req, res, next) => {
  try {
    const { user } = req as AuthenticatedRequest;
    if (!user?.sub) {
      return res.status(401).json({ message: "No autorizado" });
    }
    const parsed = bodySchema.parse(req.body);
    const config = await BillingConfigModel.findOneAndUpdate(
      { userId: user.sub },
      { $set: { clinicPercentage: parsed.clinicPercentage, insurancePercentage: parsed.insurancePercentage } },
      { new: true, upsert: true },
    ).lean();
    res.json(config);
  } catch (err) {
    next(err);
  }
});

export default router;
