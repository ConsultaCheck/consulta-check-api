import { Router } from "express";
import multer from "multer";
import { z } from "zod";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse");
import {
  LiquidationModel,
  LiquidationItemModel,
} from "../models/Liquidation";
import { parseLiquidationPdfText } from "../utils/parseLiquidationPdf";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const liquidationBodySchema = z.object({
  clinicName: z.string().optional(),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000),
  uploadDate: z.string().datetime().optional(),
});

const liquidationItemSchema = z.object({
  patientName: z.string().optional(),
  patientDocument: z.string().optional(),
  coverage: z.string().optional(),
  dateOfService: z.string().min(1).optional(),
  amountPaid: z.number().min(0),
  raw: z.unknown().optional(),
});

const liquidationItemUpdateSchema = z.object({
  patientName: z.string().optional(),
  patientDocument: z.string().optional(),
  coverage: z.string().optional(),
  dateOfService: z.string().min(1).optional(),
  amountPaid: z.number().min(0).optional(),
});

// GET /liquidations
router.get("/", async (_req, res, next) => {
  try {
    const items = await LiquidationModel.find().sort({ uploadDate: -1 }).lean();
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// POST /liquidations/upload-pdf - debe ir antes de POST /
router.post("/upload-pdf", upload.single("file"), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file || file.mimetype !== "application/pdf") {
      return res.status(400).json({ message: "Se requiere un archivo PDF" });
    }

    const month = req.body.month ? Number(req.body.month) : new Date().getMonth() + 1;
    const year = req.body.year ? Number(req.body.year) : new Date().getFullYear();

    const data = await pdfParse(file.buffer);
    const rows = parseLiquidationPdfText(data.text);

    const liquidation = new LiquidationModel({
      month,
      year,
      uploadDate: new Date(),
    });
    await liquidation.save();

    if (rows.length > 0) {
      await LiquidationItemModel.insertMany(
        rows.map((r) => ({
          liquidationId: liquidation._id,
          patientName: r.patientName,
          patientDocument: r.patientDocument,
          dateOfService: new Date(r.dateOfService),
          amountPaid: r.amountPaid,
        })),
      );
    }

    res.status(201).json({
      liquidation,
      itemsCount: rows.length,
    });
  } catch (err) {
    next(err);
  }
});

// GET /liquidations/:id/items
router.get("/:id/items", async (req, res, next) => {
  try {
    const { id } = req.params;
    const items = await LiquidationItemModel.find({ liquidationId: id })
      .sort({ dateOfService: -1 })
      .lean();
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// POST /liquidations
// Body: { liquidation, items }
router.post("/", async (req, res, next) => {
  try {
    const bodySchema = z.object({
      liquidation: liquidationBodySchema,
      items: z.array(liquidationItemSchema).default([]),
    });

    const parsed = bodySchema.parse(req.body);

    const uploadDate = parsed.liquidation.uploadDate
      ? new Date(parsed.liquidation.uploadDate)
      : new Date();

    const liquidation = new LiquidationModel({
      clinicName: parsed.liquidation.clinicName ?? undefined,
      month: parsed.liquidation.month,
      year: parsed.liquidation.year,
      uploadDate,
    });
    await liquidation.save();

    if (parsed.items.length > 0) {
      await LiquidationItemModel.insertMany(
        parsed.items.map((item) => ({
          liquidationId: liquidation._id,
          patientName: item.patientName,
          patientDocument: item.patientDocument,
          coverage: item.coverage,
          dateOfService: item.dateOfService
            ? new Date(item.dateOfService)
            : undefined,
          amountPaid: item.amountPaid,
          raw: item.raw,
        })),
      );
    }

    res.status(201).json(liquidation);
  } catch (err) {
    next(err);
  }
});

// PUT /liquidations/:id/items/:itemId - actualizar un ítem (RUT, previsión, etc.)
router.put("/:id/items/:itemId", async (req, res, next) => {
  try {
    const { id, itemId } = req.params;
    const parsed = liquidationItemUpdateSchema.parse(req.body);

    const item = await LiquidationItemModel.findOne({
      _id: itemId,
      liquidationId: id,
    });
    if (!item) {
      return res.status(404).json({ message: "Ítem no encontrado" });
    }

    const update: Record<string, unknown> = {};
    if (parsed.patientName !== undefined) update.patientName = parsed.patientName;
    if (parsed.patientDocument !== undefined) update.patientDocument = parsed.patientDocument;
    if (parsed.coverage !== undefined) update.coverage = parsed.coverage;
    if (parsed.amountPaid !== undefined) update.amountPaid = parsed.amountPaid;
    if (parsed.dateOfService !== undefined) {
      update.dateOfService = new Date(parsed.dateOfService);
    }

    const updated = await LiquidationItemModel.findByIdAndUpdate(itemId, update, {
      new: true,
    }).lean();

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
