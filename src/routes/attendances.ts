import { Router } from "express";
import { z } from "zod";
import { AttendanceModel } from "../models/Attendance";

const router = Router();

const attendanceBodySchema = z.object({
  patientName: z.string().min(1),
  patientDocument: z.string().min(1),
  coverage: z.enum(["FONASA", "ISAPRE", "FUERZAS_ARMADAS", "PARTICULAR"]),
  dateOfAttendance: z.string().datetime().or(z.string().min(1)),
  totalAmount: z.number().min(0),
  source: z.enum(["manual", "excel"]).optional().default("manual"),
  reconciliationStatus: z.enum(["PAID", "UNPAID"]).nullish(),
});

// GET /attendances?from=YYYY-MM-DD&to=YYYY-MM-DD&coverage=&name=&rut=
router.get("/", async (req, res, next) => {
  try {
    const { from, to, coverage, name, rut } = req.query;

    const filter: Record<string, unknown> = {};

    if (from || to) {
      filter.dateOfAttendance = {};
      if (from) {
        // @ts-expect-error dynamic
        filter.dateOfAttendance.$gte = new Date(String(from));
      }
      if (to) {
        // @ts-expect-error dynamic
        filter.dateOfAttendance.$lte = new Date(String(to));
      }
    }

    if (coverage && typeof coverage === "string" && coverage !== "all") {
      filter.coverage = coverage;
    }

    if (name && typeof name === "string" && name.trim()) {
      filter.patientName = { $regex: name.trim(), $options: "i" };
    }

    if (rut && typeof rut === "string" && rut.trim()) {
      const normalized = rut.replace(/[.\-\s]/g, "");
      filter.patientDocument = { $regex: normalized, $options: "i" };
    }

    const items = await AttendanceModel.find(filter)
      .sort({ dateOfAttendance: -1 })
      .lean();

    res.json(items);
  } catch (err) {
    next(err);
  }
});

// POST /attendances
router.post("/", async (req, res, next) => {
  try {
    const parsed = attendanceBodySchema.parse(req.body);
    const date =
      parsed.dateOfAttendance.length <= 10
        ? new Date(parsed.dateOfAttendance)
        : new Date(parsed.dateOfAttendance);

    const payload = {
      patientName: parsed.patientName,
      patientDocument: parsed.patientDocument,
      coverage: parsed.coverage,
      dateOfAttendance: date,
      totalAmount: parsed.totalAmount,
      source: parsed.source,
      // Importante: dejar en null por defecto para que la conciliación
      // pueda calcular automáticamente PAID/UNPAID según la liquidación.
      reconciliationStatus: parsed.reconciliationStatus ?? null,
    };
    const created = await AttendanceModel.create(payload);

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /attendances/:id
router.put("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const parsed = attendanceBodySchema.partial().parse(req.body);

    const update: Record<string, unknown> = { ...parsed };
    if (parsed.dateOfAttendance) {
      update.dateOfAttendance =
        parsed.dateOfAttendance.length <= 10
          ? new Date(parsed.dateOfAttendance)
          : new Date(parsed.dateOfAttendance);
    }

    const updated = await AttendanceModel.findByIdAndUpdate(id, update, {
      new: true,
    });

    if (!updated) {
      return res.status(404).json({ message: "Asistencia no encontrada" });
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /attendances/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const deleted = await AttendanceModel.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ message: "Asistencia no encontrada" });
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;

