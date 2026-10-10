import { useState } from "react";
import { Link } from "wouter";
import { getListLearningVideosQueryKey, useGetMyProfile, useListLearningVideos } from "@workspace/api-client-react";
import type { LearningVideo } from "@workspace/api-client-react";
import { ArrowRight, BookOpenCheck, Clock3, Play, X } from "lucide-react";
import { Card } from "@/components/ui-enhanced";
import { isExamPrepVideoForProfession, normalizeExamPrepProfession } from "@/lib/examPrepAccess";

const examLabels = {
  doctor: "doctor-specific exams and GMC registration",
  nurse: "nurse-specific exams and NMC registration",
  dentist: "dentist-specific exams and GDC registration",
} as const;

function mediaSource(video: LearningVideo) {
  if (!video.mediaUrl) return "";
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${base}${video.mediaUrl}`;
}

export function ExamPrepSupportCard({ compact = false }: { compact?: boolean }) {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const profession = normalizeExamPrepProfession(profile?.profession);
  const videosQuery = useListLearningVideos({
    query: { queryKey: getListLearningVideosQueryKey(), enabled: Boolean(profession) },
  });
  const [hidden, setHidden] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [activeVideo, setActiveVideo] = useState<LearningVideo | null>(null);

  if (profileLoading || !profession) return null;

  const videos = (videosQuery.data?.videos ?? []).filter((video) =>
    isExamPrepVideoForProfession(video, profession),
  );
  const visibleVideos = showAll ? videos : videos.slice(0, 2);

  return (
    <>
      {hidden ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
          <span className="text-sm text-muted-foreground">Professional exam preparation is optional.</span>
          <button type="button" onClick={() => setHidden(false)} className="text-sm font-semibold text-primary hover:underline">
            Show support
          </button>
        </div>
      ) : (
        <Card className={`overflow-hidden border-primary/15 bg-gradient-to-br from-primary/[0.06] via-background to-background ${compact ? "p-4 sm:p-5" : "p-5 sm:p-6"}`}>
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <BookOpenCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Optional learning support</p>
                  <h2 className="mt-1 font-display text-lg font-semibold text-foreground">
                    Prepare for your professional exams
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setHidden(true)}
                  className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Hide professional exam preparation support"
                >
                  Not now
                </button>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                Explore reviewed resources to help you prepare for {examLabels[profession]}.
                Learn at your own pace; this will not hold up your next steps.
              </p>
              <Link
                href="/regulatory-guidance"
                className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-primary/20 bg-background px-3 py-2 text-sm font-semibold text-primary transition hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                See exam and registration steps <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>

              {videosQuery.isLoading ? (
                <p className="mt-4 text-sm text-muted-foreground">Checking for reviewed learning resources…</p>
              ) : videosQuery.isError ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  Learning resources are temporarily unavailable. You can still continue your journey and use the official guidance above.
                </p>
              ) : videos.length > 0 ? (
                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-foreground">Exam and registration resources</h3>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {visibleVideos.map((video) => (
                      <button
                        type="button"
                        key={video.id}
                        onClick={() => setActiveVideo(video)}
                        className="flex min-h-16 items-center gap-3 rounded-xl border border-border bg-background/90 p-3 text-left transition hover:border-primary/30 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                          <Play className="ml-0.5 h-4 w-4 fill-current" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-foreground">{video.title}</span>
                          <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock3 className="h-3 w-3" aria-hidden="true" />
                            {video.durationSeconds ? `${Math.ceil(video.durationSeconds / 60)} min` : "Watch when ready"}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {videos.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setShowAll((value) => !value)}
                      className="mt-3 text-sm font-semibold text-primary hover:underline"
                    >
                      {showAll ? "Show fewer resources" : `Show all ${videos.length} resources`}
                    </button>
                  )}
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  More reviewed resources will be added here. Your exam and registration guidance is available whenever you need it.
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {activeVideo && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={activeVideo.title}
          onClick={() => setActiveVideo(null)}
        >
          <div className="w-full max-w-4xl overflow-hidden rounded-2xl bg-background shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 sm:px-6">
              <h2 className="font-display text-base font-semibold text-foreground">{activeVideo.title}</h2>
              <button
                type="button"
                onClick={() => setActiveVideo(null)}
                aria-label="Close video"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="bg-black">
              {activeVideo.videoEmbedUrl ? (
                <iframe
                  src={activeVideo.videoEmbedUrl}
                  title={activeVideo.title}
                  className="aspect-video w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              ) : activeVideo.mediaUrl ? (
                <video className="aspect-video w-full" controls playsInline src={mediaSource(activeVideo)} />
              ) : (
                <div className="grid aspect-video place-items-center p-6 text-sm text-white/80">
                  Video playback is not available for this resource.
                </div>
              )}
            </div>
            <div className="space-y-3 p-4 sm:p-6">
              <p className="text-sm leading-6 text-muted-foreground">{activeVideo.description}</p>
              {activeVideo.applicability && <p className="text-xs text-muted-foreground">For: {activeVideo.applicability}</p>}
              {activeVideo.sourceUrl && (
                <a href={activeVideo.sourceUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary hover:underline">
                  View resource source
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
