import { Schema, model, type Document, Types } from "mongoose";

export interface Liquidation extends Document {
  clinicName?: string;
  month: number;
  year: number;
  uploadDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

const LiquidationSchema = new Schema<Liquidation>(
  {
    clinicName: { type: String },
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true },
    uploadDate: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

export const LiquidationModel = model<Liquidation>("Liquidation", LiquidationSchema);

export interface LiquidationItem extends Document {
  liquidationId: Types.ObjectId;
  patientName?: string;
  patientDocument?: string;
  coverage?: string;
  dateOfService?: Date;
  amountPaid: number;
  raw?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

const LiquidationItemSchema = new Schema<LiquidationItem>(
  {
    liquidationId: {
      type: Schema.Types.ObjectId,
      ref: "Liquidation",
      required: true,
      index: true,
    },
    patientName: { type: String },
    patientDocument: { type: String, index: true },
    coverage: { type: String },
    dateOfService: { type: Date, index: true },
    amountPaid: { type: Number, required: true },
    raw: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

export const LiquidationItemModel = model<LiquidationItem>(
  "LiquidationItem",
  LiquidationItemSchema,
);

