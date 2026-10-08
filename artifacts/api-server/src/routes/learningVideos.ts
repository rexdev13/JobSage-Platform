import { and, asc, eq, gte } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateLearningVideoBody,
  ListAdminLearningVideosResponse,
  ListLearningVideosResponse,
  RequestLearningVideoUploadUrlBody,
  RequestLearningVideoUploadUrlResponse,
  UpdateLearningVideoBody,
  UpdateLearningVideoParams,
  UpdateLearningVideoResponse,
} from "@workspace/api-zod";
import { db, learningVideosTable } from "@workspace/db";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { requireRole } from "../middlewares/requireRole";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const MAX_VIDEO_UPLOAD_BYTES = 250 * 1024 * 1024;
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const UPLOAD_KEY_PATTERN = /^\/objects\/uploads\/[0-9a-f-]{36}$/i;
const SENSITIVE_CATEGORIES = new Set(["sponsorship", "medical", "professional_registration", "relocation"]);

function isoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function dateOnly(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function toVideoResponse(row: typeof learningVideosTable.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    videoEmbedUrl: row.videoEmbedUrl,
    mediaUrl: row.storageKey ? `/api/learning-videos/${row.id}/media` : null,
    durationSeconds: row.durationSeconds,
    language: row.language,
    applicability: row.applicability,
    sourceLabel: row.sourceLabel,
    sourceUrl: row.sourceUrl,
    transcript: row.transcript,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    reviewDueAt: row.reviewDueAt,
    status: row.status,
    sortOrder: row.sortOrder,
    createdAt: isoTimestamp(row.createdAt),
    updatedAt: isoTimestamp(row.updatedAt),
  };
}

function normalizeHttpsUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeExternalVideoUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");

    if (["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "youtu.be"].includes(host)) {
      let videoId = "";
      if (host === "youtu.be") {
        videoId = url.pathname.split("/").filter(Boolean)[0] ?? "";
      } else {
        videoId =
          url.searchParams.get("v") ??
          url.pathname.match(/\/(?:embed|shorts|live)\/([^/?]+)/)?.[1] ??
          "";
      }
      if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return null;
      return `https://www.youtube-nocookie.com/embed/${videoId}`;
    }

    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const videoId = url.pathname.match(/(?:^|\/)(\d+)(?:\/|$)/)?.[1];
      if (!videoId) return null;
      const hash = url.searchParams.get("h");
      return `https://player.vimeo.com/video/${videoId}${hash ? `?h=${encodeURIComponent(hash)}` : ""}`;
    }

    return null;
  } catch {
    return null;
  }
}

function normalizedMediaSource(
  input: { videoUrl?: string | null; storageKey?: string | null },
  previous?: { videoEmbedUrl: string | null; storageKey: string | null },
): { videoEmbedUrl: string | null; storageKey: string | null } | null {
  const videoUrl = input.videoUrl?.trim() || null;
  const storageKey = input.storageKey?.trim() || null;

  if (!videoUrl && !storageKey) {
    return previous ?? null;
  }
  if (videoUrl && storageKey) return null;

  if (videoUrl) {
    const videoEmbedUrl = normalizeExternalVideoUrl(videoUrl);
    return videoEmbedUrl ? { videoEmbedUrl, storageKey: null } : null;
  }

  if (!storageKey || !UPLOAD_KEY_PATTERN.test(storageKey)) return null;
  return { videoEmbedUrl: null, storageKey };
}

async function verifyUploadedVideo(storageKey: string, ownerId: string): Promise<boolean> {
  if (!UPLOAD_KEY_PATTERN.test(storageKey)) return false;

  try {
    const file = await objectStorageService.getObjectEntityFile(storageKey);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    const contentType = String(metadata.contentType ?? "").toLowerCase();
    if (!ALLOWED_VIDEO_TYPES.has(contentType) || !Number.isFinite(size) || size <= 0 || size > MAX_VIDEO_UPLOAD_BYTES) {
      return false;
    }
    await objectStorageService.trySetObjectEntityAclPolicy(storageKey, {
      owner: ownerId,
      visibility: "private",
    });
    return true;
  } catch {
    return false;
  }
}

export function validReviewWindow(reviewedAt: string, reviewDueAt: string, status: string): boolean {
  if (reviewDueAt < reviewedAt) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (status === "published" && (reviewedAt > today || reviewDueAt < today)) return false;
  return true;
}

export function validApplicability(category: string, applicability: string | null | undefined): boolean {
  return !SENSITIVE_CATEGORIES.has(category) || Boolean(applicability?.trim());
}

router.get(
  "/learning-videos",
  requireRole("candidate", "reviewer", "admin", "super_admin"),
  async (_req: Request, res: Response) => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await db
      .select()
      .from(learningVideosTable)
      .where(and(eq(learningVideosTable.status, "published"), gte(learningVideosTable.reviewDueAt, today)))
      .orderBy(asc(learningVideosTable.sortOrder), asc(learningVideosTable.id));

    res.json(ListLearningVideosResponse.parse({ videos: rows.map(toVideoResponse) }));
  },
);

router.get(
  "/admin/learning-videos",
  requireRole("admin", "super_admin"),
  async (_req: Request, res: Response) => {
    const rows = await db
      .select()
      .from(learningVideosTable)
      .orderBy(asc(learningVideosTable.sortOrder), asc(learningVideosTable.id));
    res.json(ListAdminLearningVideosResponse.parse({ videos: rows.map(toVideoResponse) }));
  },
);

router.post(
  "/admin/learning-videos/upload-url",
  requireRole("admin", "super_admin"),
  async (req: Request, res: Response) => {
    const parsed = RequestLearningVideoUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Provide a supported video file name, type, and size." });
      return;
    }
    if (!ALLOWED_VIDEO_TYPES.has(parsed.data.contentType) || parsed.data.size > MAX_VIDEO_UPLOAD_BYTES) {
      res.status(400).json({ error: "Only MP4, WebM, or QuickTime videos up to 250 MB are accepted." });
      return;
    }

    try {
      const uploadUrl = await objectStorageService.getObjectEntityUploadURL();
      const storageKey = objectStorageService.normalizeObjectEntityPath(uploadUrl);
      res.json(RequestLearningVideoUploadUrlResponse.parse({
        uploadUrl,
        storageKey,
        maxBytes: MAX_VIDEO_UPLOAD_BYTES,
      }));
    } catch (error) {
      console.error("Failed to generate learning video upload URL:", error);
      res.status(500).json({ error: "Failed to create a secure video upload." });
    }
  },
);

router.post(
  "/admin/learning-videos",
  requireRole("admin", "super_admin"),
  async (req: Request, res: Response) => {
    const parsed = CreateLearningVideoBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Learning video details are invalid." });
      return;
    }

    const input = parsed.data;
    const status = input.status ?? "draft";
    const reviewedAt = dateOnly(input.reviewedAt);
    const reviewDueAt = dateOnly(input.reviewDueAt);
    const media = normalizedMediaSource(input);
    const sourceUrl = normalizeHttpsUrl(input.sourceUrl);
    if (!input.title.trim() || !input.description.trim()) {
      res.status(400).json({ error: "Add a title and description for this video." });
      return;
    }
    if (!media) {
      res.status(400).json({ error: "Provide exactly one supported YouTube/Vimeo URL or an uploaded video." });
      return;
    }
    if (!input.sourceLabel.trim() || !input.reviewedBy.trim() || !sourceUrl && input.sourceUrl?.trim()) {
      res.status(400).json({ error: "Provide a source label, reviewer, and a valid HTTPS source link." });
      return;
    }
    if (!validApplicability(input.category, input.applicability)) {
      res.status(400).json({ error: "Add who this guidance applies to for sponsorship, medical, registration, and relocation videos." });
      return;
    }
    if (!validReviewWindow(reviewedAt, reviewDueAt, status)) {
      res.status(400).json({ error: "Published videos need a current review date and a review due date that has not passed." });
      return;
    }
    if (media.storageKey && !(await verifyUploadedVideo(media.storageKey, req.user!.id))) {
      res.status(400).json({ error: "The uploaded video is missing, too large, or has an unsupported media type." });
      return;
    }

    const [row] = await db
      .insert(learningVideosTable)
      .values({
        title: input.title.trim(),
        description: input.description.trim(),
        category: input.category,
        ...media,
        durationSeconds: input.durationSeconds ?? null,
        language: input.language?.trim() || "English",
        applicability: input.applicability?.trim() || null,
        sourceLabel: input.sourceLabel.trim(),
        sourceUrl,
        transcript: input.transcript?.trim() || null,
        reviewedBy: input.reviewedBy.trim(),
        reviewedAt,
        reviewDueAt,
        status,
        sortOrder: input.sortOrder ?? 0,
        createdBy: req.user!.id,
        updatedBy: req.user!.id,
      })
      .returning();

    res.status(201).json(UpdateLearningVideoResponse.parse(toVideoResponse(row)));
  },
);

router.patch(
  "/admin/learning-videos/:id",
  requireRole("admin", "super_admin"),
  async (req: Request, res: Response) => {
    const params = UpdateLearningVideoParams.safeParse(req.params);
    const parsed = UpdateLearningVideoBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Learning video details are invalid." });
      return;
    }

    const [current] = await db
      .select()
      .from(learningVideosTable)
      .where(eq(learningVideosTable.id, params.data.id))
      .limit(1);
    if (!current) {
      res.status(404).json({ error: "Learning video not found." });
      return;
    }

    const input = parsed.data;
    const status = input.status ?? current.status;
    const reviewedAt = dateOnly(input.reviewedAt);
    const reviewDueAt = dateOnly(input.reviewDueAt);
    const media = normalizedMediaSource(input, {
      videoEmbedUrl: current.videoEmbedUrl,
      storageKey: current.storageKey,
    });
    const sourceUrl = input.sourceUrl === undefined
      ? current.sourceUrl
      : normalizeHttpsUrl(input.sourceUrl);
    if (!input.title.trim() || !input.description.trim()) {
      res.status(400).json({ error: "Add a title and description for this video." });
      return;
    }
    if (!media) {
      res.status(400).json({ error: "Provide at most one supported YouTube/Vimeo URL or an uploaded video." });
      return;
    }
    if (input.sourceUrl?.trim() && !sourceUrl) {
      res.status(400).json({ error: "Provide a valid HTTPS source link." });
      return;
    }
    if (!validApplicability(input.category, input.applicability === undefined ? current.applicability : input.applicability)) {
      res.status(400).json({ error: "Add who this guidance applies to for sponsorship, medical, registration, and relocation videos." });
      return;
    }
    if (!validReviewWindow(reviewedAt, reviewDueAt, status)) {
      res.status(400).json({ error: "Published videos need a current review date and a review due date that has not passed." });
      return;
    }
    if (media.storageKey && media.storageKey !== current.storageKey && !(await verifyUploadedVideo(media.storageKey, req.user!.id))) {
      res.status(400).json({ error: "The uploaded video is missing, too large, or has an unsupported media type." });
      return;
    }

    const [row] = await db
      .update(learningVideosTable)
      .set({
        title: input.title.trim(),
        description: input.description.trim(),
        category: input.category,
        ...media,
        durationSeconds: input.durationSeconds ?? current.durationSeconds,
        language: input.language?.trim() || current.language,
        applicability: input.applicability === undefined
          ? current.applicability
          : input.applicability?.trim() || null,
        sourceLabel: input.sourceLabel.trim(),
        sourceUrl,
        transcript: input.transcript === undefined
          ? current.transcript
          : input.transcript?.trim() || null,
        reviewedBy: input.reviewedBy.trim(),
        reviewedAt,
        reviewDueAt,
        status,
        sortOrder: input.sortOrder ?? current.sortOrder,
        updatedBy: req.user!.id,
        updatedAt: new Date(),
      })
      .where(eq(learningVideosTable.id, params.data.id))
      .returning();

    res.json(UpdateLearningVideoResponse.parse(toVideoResponse(row)));
  },
);

export function parseByteRange(rangeHeader: string, size: number): { start: number; end: number } | null | false {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return false;

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
      return false;
    }
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

router.get(
  "/learning-videos/:id/media",
  requireRole("candidate", "reviewer", "admin", "super_admin"),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(404).json({ error: "Video media not found." });
      return;
    }

    const [video] = await db
      .select()
      .from(learningVideosTable)
      .where(eq(learningVideosTable.id, id))
      .limit(1);
    const today = new Date().toISOString().slice(0, 10);
    const role = (req.user as { role?: string | null } | undefined)?.role;
    const isStaff = role === "admin" || role === "super_admin";
    if (!video?.storageKey || (!isStaff && (video.status !== "published" || video.reviewDueAt < today))) {
      res.status(404).json({ error: "Video media not found." });
      return;
    }

    try {
      const file = await objectStorageService.getObjectEntityFile(video.storageKey);
      const [metadata] = await file.getMetadata();
      const size = Number(metadata.size);
      const contentType = String(metadata.contentType ?? "").toLowerCase();
      if (!ALLOWED_VIDEO_TYPES.has(contentType) || !Number.isSafeInteger(size) || size <= 0 || size > MAX_VIDEO_UPLOAD_BYTES) {
        res.status(404).json({ error: "Video media not found." });
        return;
      }

      const requestedRange = req.get("Range");
      const range = requestedRange ? parseByteRange(requestedRange, size) : null;
      if (range === false) {
        res.setHeader("Content-Range", `bytes */${size}`);
        res.status(416).end();
        return;
      }

      const start = range?.start ?? 0;
      const end = range?.end ?? size - 1;
      const statusCode = range ? 206 : 200;
      res.status(statusCode);
      res.set({
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "Content-Length": String(end - start + 1),
        "Content-Type": contentType,
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      });
      if (range) res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);

      const stream = file.createReadStream(range ? { start, end } : undefined);
      stream.on("error", (error) => {
        console.error("Failed to stream learning video:", error);
        if (res.headersSent) res.destroy(error);
        else res.status(500).json({ error: "Failed to stream video media." });
      });
      stream.pipe(res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Video media not found." });
        return;
      }
      console.error("Failed to load learning video media:", error);
      res.status(500).json({ error: "Failed to load video media." });
    }
  },
);

export default router;
