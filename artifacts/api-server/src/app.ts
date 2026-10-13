import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { performance } from "node:perf_hooks";
import { pool } from "@workspace/db";
import { authMiddleware } from "./middlewares/authMiddleware";
import router from "./routes";
import { writeAuditEvent } from "./lib/audit";
import { logger } from "./lib/logger";

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
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const candidateRoleRoutes = new Set(["/api/roles", "/api/roles/my-matches"]);
app.use((req, res, next) => {
  const route = req.path;
  if (!candidateRoleRoutes.has(route)) {
    next();
    return;
  }

  const startedAt = performance.now();
  const eventLoopStart = performance.eventLoopUtilization();
  let logged = false;
  const logDiagnostics = (outcome: "finished" | "client_closed_before_response" | "request_aborted") => {
    if (logged) return;
    logged = true;
    const durationMs = Math.round(performance.now() - startedAt);
    if (outcome === "finished" && durationMs < 1_000 && pool.waitingCount === 0) return;

    const eventLoop = performance.eventLoopUtilization(eventLoopStart);
    req.log.warn(
      {
        route,
        method: req.method,
        outcome,
        durationMs,
        statusCode: res.statusCode,
        pool: {
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
        },
        eventLoopUtilization: Number(eventLoop.utilization.toFixed(3)),
      },
      "Candidate role request diagnostics",
    );
  };

  res.once("finish", () => logDiagnostics("finished"));
  res.once("close", () => {
    if (!res.writableEnded) logDiagnostics("client_closed_before_response");
  });
  req.once("aborted", () => logDiagnostics("request_aborted"));
  next();
});
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
    // Log the full error server-side, but never leak internals (e.g. raw SQL
    // from failed queries) to API clients.
    req.log.error({ err, statusCode }, "Unhandled API error");
    writeAuditEvent("system", "api_error_5xx", undefined, {
      statusCode,
      path: req.path,
      method: req.method,
      message: err.message,
    }).catch(() => {});
    res.status(statusCode).json({ error: "Internal server error" });
    return;
  }
  res.status(statusCode).json({ error: err.message || "Internal server error" });
});

export default app;
