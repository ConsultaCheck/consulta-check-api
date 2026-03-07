import { Router } from "express";
import { z } from "zod";
import { PatientModel } from "../models/Patient";

const router = Router();

const patientBodySchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  secondLastName: z.string().optional(),
  sex: z.enum(["M", "F", "OTHER"]),
  coverage: z.enum(["FONASA", "ISAPRE", "FUERZAS_ARMADAS", "PARTICULAR"]),
  documentNumber: z.string().optional(),
  age: z.number().int().min(0).optional(),
});

// GET /patients
router.get("/", async (_req, res, next) => {
  try {
    const items = await PatientModel.find().sort({ createdAt: -1 }).lean();
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// POST /patients
router.post("/", async (req, res, next) => {
  try {
    const parsed = patientBodySchema.parse(req.body);
    const payload = {
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      sex: parsed.sex,
      coverage: parsed.coverage,
      ...(parsed.secondLastName != null && parsed.secondLastName !== "" && { secondLastName: parsed.secondLastName }),
      ...(parsed.documentNumber != null && parsed.documentNumber !== "" && { documentNumber: parsed.documentNumber }),
      ...(parsed.age != null && { age: parsed.age }),
    };
    const created = await PatientModel.create(payload);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

export default router;
