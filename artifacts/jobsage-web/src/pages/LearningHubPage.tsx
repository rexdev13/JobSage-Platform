import { useMemo, useState } from "react";
import { useListLearningVideos } from "@workspace/api-client-react";
import type { LearningVideo } from "@workspace/api-client-react";
import { ArrowUpRight, BookOpenCheck, CheckCircle2, ChevronDown, Clock3, Play, Search, ShieldCheck, Video, X } from "lucide-react";

const categoryLabels: Record<LearningVideo["category"], string> = {
  application: "Applications",
  sponsorship: "Sponsorship",
  medical: "Clinical practice",
  professional_registration: "Professional registration",
  relocation: "Moving to the UK",
  jobsage: "JOBSAGE guides",
};

const categoryAccents: Record<LearningVideo["category"], string> = {
  application: "bg-[#e7f0eb] text-[#285b45]",
  sponsorship: "bg-[#f8eadf] text-[#9b4d24]",
  medical: "bg-[#e7eef5] text-[#355976]",
  professional_registration: "bg-[#f0eaf2] text-[#684b70]",
  relocation: "bg-[#f5edda] text-[#79602a]",
  jobsage: "bg-[#f5e6e3] text-[#8e3a33]",
};

const formatDuration = (seconds?: number | null) => {
  if (!seconds) return null;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
};

const dateLabel = (value: string) => new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric",
}).format(new Date(value));

function mediaSource(video: LearningVideo) {
  if (video.videoEmbedUrl) return video.videoEmbedUrl;
  if (!video.mediaUrl) return "";
  const url = video.mediaUrl;
  if (/^https?:\/\//i.test(url)) return url;
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  if (url.startsWith("/api/")) return `${base}${url}`;
  if (url.startsWith("/objects/")) return `${base}/api/storage${url}`;
  return `${base}/api/storage/${url.replace(/^\/+/, "")}`;
}

export default function LearningHubPage() {
  const { data, isLoading, isError, refetch } = useListLearningVideos();
  const [category, setCategory] = useState<LearningVideo["category"] | "all">("all");
  const [search, setSearch] = useState("");
  const [activeVideo, setActiveVideo] = useState<LearningVideo | null>(null);
  const videos = data?.videos ?? [];
  const availableCategories = useMemo(
    () => Array.from(new Set(videos.map((video) => video.category))),
    [videos],
  );
  const filteredVideos = useMemo(() => videos.filter((video) => {
    const matchesCategory = category === "all" || video.category === category;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || `${video.title} ${video.description} ${video.sourceLabel} ${video.language}`.toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  }), [videos, category, search]);

  return (
    <main className="min-h-[100dvh] bg-[#f7f6f1] text-[#20312e]">
      <div className="mx-auto max-w-[1320px] px-5 pb-20 pt-8 sm:px-8 lg:px-12">
        <div className="mb-8 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#697873]">
          <BookOpenCheck className="h-4 w-4 text-[#a34135]" />
          Your learning library
        </div>

        <section className="relative overflow-hidden rounded-[2rem] bg-[#233b36] px-7 py-10 text-[#f8f4e9] sm:px-12 sm:py-14">
          <div className="pointer-events-none absolute -right-20 -top-32 h-[27rem] w-[27rem] rounded-full border border-[#f2eadb]/10" />
          <div className="pointer-events-none absolute -right-8 -top-20 h-[23rem] w-[23rem] rounded-full border border-[#f2eadb]/10" />
          <div className="pointer-events-none absolute bottom-[-10rem] right-[17%] h-[22rem] w-[22rem] rotate-45 border border-[#f2eadb]/10" />
          <div className="relative max-w-3xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#c8d6c8]/20 bg-[#f7f6f1]/[0.07] px-3.5 py-2 text-xs font-medium text-[#d8e2d7]">
              <ShieldCheck className="h-4 w-4 text-[#d9c99c]" />
              Reviewed by the JOBSAGE team
            </div>
            <h1 className="max-w-2xl font-display text-4xl font-semibold leading-[1.04] tracking-[-0.04em] sm:text-6xl">
              Clear guidance for your next step.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-[#d2ddd4] sm:text-lg">
              Practical, staff-reviewed videos for building your healthcare career in the UK — from first application to settling in.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-[#d2ddd4]">
              <span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#d9c99c]" /> Trusted, selected resources</span>
              <span className="inline-flex items-center gap-2"><Video className="h-4 w-4 text-[#d9c99c]" /> Learn at your own pace</span>
            </div>
          </div>
          <div className="absolute bottom-8 right-10 hidden items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.07] px-4 py-3 text-sm text-[#e4e9df] md:flex">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#e9d7b4] text-[#233b36]"><Play className="ml-0.5 h-4 w-4 fill-current" /></span>
            <span><strong className="block font-semibold">A little progress,</strong><span className="text-[#c5d1c7]">one useful video at a time.</span></span>
          </div>
        </section>

        <section className="mt-10">
          <div className="mb-6 flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#a34135]">The library</p>
              <h2 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Find the guidance you need</h2>
              <p className="mt-2 text-sm text-[#697873]">Every resource is chosen to help make a complex journey feel manageable.</p>
            </div>
            <label className="relative block w-full md:max-w-[310px]">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#78847e]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search topics or sources"
                className="h-12 w-full rounded-xl border border-[#d9ddd5] bg-[#fffefa] pl-11 pr-4 text-sm outline-none transition focus:border-[#9d4b3d] focus:ring-4 focus:ring-[#9d4b3d]/10"
              />
            </label>
          </div>

          <div className="mb-7 flex gap-2 overflow-x-auto pb-1">
            <button onClick={() => setCategory("all")} className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${category === "all" ? "bg-[#a34135] text-white" : "border border-[#d9ddd5] bg-[#fffefa] text-[#52615b] hover:border-[#a34135]/50"}`}>
              All guidance <span className="ml-1 opacity-70">{videos.length}</span>
            </button>
            {availableCategories.map((item) => (
              <button key={item} onClick={() => setCategory(item)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${category === item ? "bg-[#a34135] text-white" : "border border-[#d9ddd5] bg-[#fffefa] text-[#52615b] hover:border-[#a34135]/50"}`}>
                {categoryLabels[item]}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((item) => <div key={item} className="overflow-hidden rounded-2xl border border-[#e1e2db] bg-[#fffefa]">
                <div className="aspect-[16/9] animate-pulse bg-[#e9ebe3]" />
                <div className="space-y-3 p-5"><div className="h-3 w-24 animate-pulse rounded bg-[#e9ebe3]" /><div className="h-5 w-4/5 animate-pulse rounded bg-[#e9ebe3]" /><div className="h-3 w-full animate-pulse rounded bg-[#e9ebe3]" /></div>
              </div>)}
            </div>
          ) : isError ? (
            <div className="rounded-2xl border border-[#e2c7c1] bg-[#fbf0ed] px-6 py-8">
              <h3 className="font-display text-xl font-semibold">We couldn’t load the learning library</h3>
              <p className="mt-2 text-sm text-[#69534f]">Please check your connection and try again.</p>
              <button onClick={() => refetch()} className="mt-5 rounded-lg bg-[#a34135] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#87372e]">Try again</button>
            </div>
          ) : filteredVideos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#ccd3ca] bg-[#f0f1eb] px-6 py-14 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#e0e7df] text-[#587063]"><BookOpenCheck className="h-5 w-5" /></div>
              <h3 className="mt-4 font-display text-xl font-semibold">{videos.length ? "No videos match that search" : "Your learning library is taking shape"}</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#697873]">{videos.length ? "Try another topic or clear your search to see all guidance." : "Staff-reviewed guidance will appear here as it becomes available."}</p>
              {(search || category !== "all") && <button onClick={() => { setSearch(""); setCategory("all"); }} className="mt-4 text-sm font-semibold text-[#a34135] hover:underline">Clear filters</button>}
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {filteredVideos.map((video, index) => (
                <article key={video.id} className={`group overflow-hidden rounded-2xl border border-[#e1e2db] bg-[#fffefa] shadow-[0_6px_22px_rgba(37,53,47,0.035)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_16px_36px_rgba(37,53,47,0.09)] ${index === 0 ? "sm:col-span-2 xl:col-span-1" : ""}`}>
                  <button onClick={() => setActiveVideo(video)} className="relative block aspect-[16/9] w-full overflow-hidden bg-[#263d37] text-left" aria-label={`Play ${video.title}`}>
                    {video.videoEmbedUrl && (video.videoEmbedUrl.includes("youtube.com") || video.videoEmbedUrl.includes("youtu.be")) ? (
                      <img src={`https://img.youtube.com/vi/${video.videoEmbedUrl.match(/(?:embed\/|v=|youtu\.be\/)([^?&/]+)/)?.[1] ?? ""}/hqdefault.jpg`} alt="" className="h-full w-full object-cover opacity-70 transition duration-500 group-hover:scale-[1.04] group-hover:opacity-85" />
                    ) : <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_20%,rgba(216,197,155,0.32),transparent_42%),linear-gradient(135deg,#29453d,#172d2a)]" />}
                    <div className="absolute inset-0 bg-gradient-to-t from-[#162823]/65 via-transparent to-transparent" />
                    <span className="absolute bottom-4 left-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#f4e5c7] text-[#263d37] shadow-lg transition group-hover:scale-105"><Play className="ml-0.5 h-4 w-4 fill-current" /></span>
                    {video.durationSeconds && <span className="absolute bottom-4 right-4 rounded-md bg-[#182823]/85 px-2 py-1 text-xs font-medium text-white">{formatDuration(video.durationSeconds)}</span>}
                    <span className="absolute left-4 top-4 rounded-full border border-white/15 bg-[#182823]/65 px-3 py-1 text-[11px] font-semibold tracking-wide text-white">STAFF REVIEWED</span>
                  </button>
                  <div className="p-5 sm:p-6">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${categoryAccents[video.category]}`}>{categoryLabels[video.category]}</span>
                      <span className="text-xs text-[#738078]">{video.language}</span>
                    </div>
                    <button onClick={() => setActiveVideo(video)} className="text-left font-display text-xl font-semibold leading-snug tracking-[-0.02em] text-[#253831] hover:text-[#a34135]">{video.title}</button>
                    <p className="mt-2 line-clamp-3 text-sm leading-6 text-[#64716b]">{video.description}</p>
                    <div className="mt-5 flex items-center justify-between border-t border-[#ecece5] pt-4">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-[#3e5149]">{video.sourceLabel}</p>
                        <p className="mt-1 text-[11px] text-[#7b8780]">Reviewed {dateLabel(video.reviewedAt)}</p>
                      </div>
                      <span className="ml-3 inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#a34135]">Watch <ArrowUpRight className="h-3.5 w-3.5" /></span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <div className="mt-12 flex flex-col gap-4 rounded-2xl border border-[#e3e2d8] bg-[#f0eee5] p-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex gap-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#e4d9bd] text-[#705e35]"><ShieldCheck className="h-5 w-5" /></div>
            <div>
              <h3 className="font-display text-lg font-semibold">Guidance you can trust</h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[#69736b]">Each resource is reviewed by a JOBSAGE staff member, with review dates kept visible so you can see when guidance was checked.</p>
            </div>
          </div>
          <div className="inline-flex shrink-0 items-center gap-2 text-xs font-medium text-[#64716b]"><Clock3 className="h-4 w-4" /> Check official sources for the latest requirements</div>
        </div>
      </div>

      {activeVideo && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#15231f]/75 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={activeVideo.title} onClick={() => setActiveVideo(null)}>
          <div className="max-h-[94dvh] w-full max-w-5xl overflow-y-auto rounded-t-[1.5rem] bg-[#f8f7f2] shadow-2xl sm:rounded-[1.5rem]" onClick={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#e4e3dc] bg-[#f8f7f2]/95 px-5 py-4 backdrop-blur sm:px-7">
              <div className="pr-4"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#a34135]">{categoryLabels[activeVideo.category]}</p><h2 className="mt-1 font-display text-lg font-semibold sm:text-xl">{activeVideo.title}</h2></div>
              <button onClick={() => setActiveVideo(null)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#d9ddd5] text-[#53615a] hover:bg-[#ecece5]" aria-label="Close video"><X className="h-5 w-5" /></button>
            </div>
            <div className="bg-[#192923]">
              {activeVideo.videoEmbedUrl ? (
                <iframe src={activeVideo.videoEmbedUrl} title={activeVideo.title} className="aspect-video w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />
              ) : activeVideo.mediaUrl ? (
                <video className="aspect-video w-full" controls playsInline src={mediaSource(activeVideo)} />
              ) : (
                <div className="grid aspect-video place-items-center text-sm text-white/70">Video playback is not available for this resource.</div>
              )}
            </div>
            <div className="grid gap-8 px-5 py-6 sm:grid-cols-[1fr_260px] sm:px-8 sm:py-8">
              <div>
                <p className="text-sm leading-7 text-[#52615b]">{activeVideo.description}</p>
                {activeVideo.applicability && <div className="mt-5 rounded-xl border border-[#e4dfd1] bg-[#f1efe7] p-4"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#7d6a42]">Who this is for</p><p className="mt-1.5 text-sm leading-6 text-[#52615b]">{activeVideo.applicability}</p></div>}
                {activeVideo.transcript && <details className="mt-6 border-t border-[#e2e2da] pt-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between font-display text-base font-semibold"><span>Read transcript</span><ChevronDown className="h-4 w-4 text-[#79847d]" /></summary>
                  <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-[#59675f]">{activeVideo.transcript}</div>
                </details>}
              </div>
              <aside className="space-y-4 border-t border-[#e3e3dc] pt-5 text-sm sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
                <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7c8981]">Reviewed by</p><p className="mt-1 font-semibold text-[#35483f]">{activeVideo.reviewedBy}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7c8981]">Last reviewed</p><p className="mt-1 text-[#52615b]">{dateLabel(activeVideo.reviewedAt)}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7c8981]">Review due</p><p className="mt-1 text-[#52615b]">{dateLabel(activeVideo.reviewDueAt)}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7c8981]">Language</p><p className="mt-1 text-[#52615b]">{activeVideo.language}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7c8981]">Source</p>{activeVideo.sourceUrl ? <a href={activeVideo.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-semibold text-[#a34135] hover:underline">{activeVideo.sourceLabel}<ArrowUpRight className="h-3.5 w-3.5" /></a> : <p className="mt-1 text-[#52615b]">{activeVideo.sourceLabel}</p>}</div>
              </aside>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
