import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { authMiddleware } from "./middlewares/authMiddleware";
import router from "./routes";
import { writeAuditEvent } from "./lib/audit";

const app: Express = express();

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (
        origin.startsWith("chrome-extension://") ||
        origin === "https://jobsage.co.uk" ||
        /^https:\/\/[^.]+\.jobsage\.co\.uk$/.test(origin)
      ) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
  })
);
app.use(cookieParser());
app.use(
  express.json({
    // Capture raw body for webhook signature verification (Svix/Resend)
    verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
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
