import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { authMiddleware } from "./middlewares/authMiddleware";
import router from "./routes";
import { writeAuditEvent } from "./lib/audit";

const app: Express = express();

app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

app.use("/api", router);

app.use((err: Error & { statusCode?: number; status?: number }, req: Request, res: Response, _next: NextFunction) => {
  const statusCode = err.statusCode ?? err.status ?? 500;
  if (statusCode >= 500) {
    writeAuditEvent("system", "api_error_5xx", undefined, {
      statusCode,
      path: req.path,
      method: req.method,
      message: err.message,
    }).catch(() => {});
  }
  res.status(statusCode).json({ error: err.message || "Internal server error" });
});

export default app;
