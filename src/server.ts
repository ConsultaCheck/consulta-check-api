import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { connectToDatabase } from "./config/db";
import attendancesRouter from "./routes/attendances";
import liquidationsRouter from "./routes/liquidations";
import reconciliationRouter from "./routes/reconciliation";
import patientsRouter from "./routes/patients";
import authRouter from "./routes/auth";
import billingConfigRouter from "./routes/billingConfig";
import { authMiddleware } from "./middleware/auth";

async function bootstrap() {
  const app = express();

  const allowedOrigins = env.corsOrigin
    ? env.corsOrigin.split(",").map((o) => o.trim()).filter(Boolean)
    : [];

  app.use(
    cors({
      origin:
        env.nodeEnv === "development"
          ? "*"
          : (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
              if (!origin) return cb(null, true);
              if (allowedOrigins.includes(origin)) return cb(null, true);
              // Permitir cualquier despliegue de Vercel (*.vercel.app)
              if (origin.endsWith(".vercel.app")) return cb(null, true);
              return cb(null, false);
            },
    }),
  );
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Rutas públicas
  app.use("/auth", authRouter);

  // Rutas protegidas
  app.use("/attendances", authMiddleware, attendancesRouter);
  app.use("/liquidations", authMiddleware, liquidationsRouter);
  app.use("/reconciliation", authMiddleware, reconciliationRouter);
  app.use("/patients", authMiddleware, patientsRouter);
  app.use("/billing-config", authMiddleware, billingConfigRouter);

  // Middleware de errores
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      // eslint-disable-next-line no-console
      console.error(err);
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "Datos inválidos", issues: err.issues });
      }
      res.status(500).json({ message: "Error interno del servidor" });
    },
  );

  await connectToDatabase();

  app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`API ConsultaCheck escuchando en puerto ${env.port}`);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Error al iniciar el servidor", err);
  process.exit(1);
});

