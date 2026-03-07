import mongoose from "mongoose";
import { env } from "./env";

export async function connectToDatabase() {
  if (!env.mongoUri) {
    throw new Error("MONGODB_URI no está configurado");
  }

  await mongoose.connect(env.mongoUri, {
    dbName: env.mongoDbName,
  });
}

