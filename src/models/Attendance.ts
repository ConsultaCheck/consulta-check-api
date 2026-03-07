import { Schema, model, type Document } from "mongoose";

export type CoverageType =
  | "FONASA"
  | "ISAPRE"
  | "FUERZAS_ARMADAS"
  | "PARTICULAR";

export type AttendanceSource = "manual" | "excel";

export type ReconciliationStatus = "PAID" | "UNPAID";

export interface Attendance extends Document {
  patientName: string;
  patientDocument: string;
  coverage: CoverageType;
  dateOfAttendance: Date;
  totalAmount: number;
  source: AttendanceSource;
  reconciliationStatus?: ReconciliationStatus | null;
  createdAt: Date;
  updatedAt: Date;
}

const AttendanceSchema = new Schema<Attendance>(
  {
    patientName: { type: String, required: true },
    patientDocument: { type: String, required: true, index: true },
    coverage: {
      type: String,
      required: true,
      enum: ["FONASA", "ISAPRE", "FUERZAS_ARMADAS", "PARTICULAR"],
    },
    dateOfAttendance: { type: Date, required: true, index: true },
    totalAmount: { type: Number, required: true },
    source: {
      type: String,
      required: true,
      enum: ["manual", "excel"],
      default: "manual",
    },
    reconciliationStatus: { type: String, enum: ["PAID", "UNPAID"] },
  },
  { timestamps: true },
);

export const AttendanceModel = model<Attendance>(
  "Attendance",
  AttendanceSchema,
);

