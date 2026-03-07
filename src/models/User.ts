import { Schema, model, type Document } from "mongoose";

export type UserRole = "admin" | "user";

export interface User extends Document {
  email: string;
  name?: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<User>(
  {
    email: { type: String, required: true, unique: true, index: true },
    name: { type: String },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "user"], default: "user" },
  },
  { timestamps: true },
);

export const UserModel = model<User>("User", UserSchema);

