import { Schema, model, type Document } from "mongoose";

export interface Patient extends Document {
  firstName: string;
  lastName: string;
  secondLastName?: string;
  sex: "M" | "F" | "OTHER";
  coverage: string;
  documentNumber?: string;
  age?: number;
  createdAt: Date;
  updatedAt: Date;
}

const PatientSchema = new Schema<Patient>(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    secondLastName: { type: String },
    sex: {
      type: String,
      required: true,
      enum: ["M", "F", "OTHER"],
    },
    coverage: {
      type: String,
      required: true,
      enum: ["FONASA", "ISAPRE", "FUERZAS_ARMADAS", "PARTICULAR"],
    },
    documentNumber: { type: String },
    age: { type: Number },
  },
  { timestamps: true },
);

export const PatientModel = model<Patient>("Patient", PatientSchema);
