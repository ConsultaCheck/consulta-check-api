import { Schema, model, type Document } from "mongoose";

export interface BillingConfig extends Document {
  userId: string;
  clinicPercentage: number;
  insurancePercentage: number;
  createdAt: Date;
  updatedAt: Date;
}

const BillingConfigSchema = new Schema<BillingConfig>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    clinicPercentage: { type: Number, required: true, min: 0, max: 100, default: 0 },
    insurancePercentage: { type: Number, required: true, min: 0, max: 100, default: 0 },
  },
  { timestamps: true },
);

export const BillingConfigModel = model<BillingConfig>("BillingConfig", BillingConfigSchema);
