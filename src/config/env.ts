import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: process.env.PORT ? Number(process.env.PORT) : 4000,
  mongoUri: process.env.MONGODB_URI ?? "",
  mongoDbName: process.env.MONGODB_DB ?? "consultacheck",
  nodeEnv: process.env.NODE_ENV ?? "development",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  /** URL del frontend para CORS en producción (ej. https://consultacheck.vercel.app) */
  corsOrigin: process.env.CORS_ORIGIN ?? process.env.FRONTEND_URL ?? "",
};

if (!env.mongoUri) {
  // En desarrollo mostramos una advertencia en consola; en producción deberíamos fallar.
  // eslint-disable-next-line no-console
  console.warn(
    "[env] MONGODB_URI no está definido. Configura la variable en tu archivo .env.",
  );
}

