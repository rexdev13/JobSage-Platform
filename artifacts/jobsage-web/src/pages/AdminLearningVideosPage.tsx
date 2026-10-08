import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListAdminLearningVideosQueryKey,
  getListLearningVideosQueryKey,
  useCreateLearningVideo,
  useListAdminLearningVideos,
  useRequestLearningVideoUploadUrl,
  useUpdateLearningVideo,
} from "@workspace/api-client-react";
import type { LearningVideo, LearningVideoInput, LearningVideoUploadRequest } from "@workspace/api-client-react";
import { Archive, ArrowDownUp, Check, ChevronDown, CircleAlert, Clock3, FileVideo2, LoaderCircle, Pencil, Plus, Search, Send, ShieldCheck, UploadCloud, Video, X } from "lucide-react";

const MAX_VIDEO_BYTES = 262_144_000;
const categories: { value: LearningVideoInput["category"]; label: string }[] = [
  { value: "application", label: "Applications" },
  { value: "sponsorship", label: "Sponsorship" },
  { value: "medical", label: "Clinical practice" },
  { value: "professional_registration", label: "Professional registration" },
  { value: "relocation", label: "Moving to the UK" },
  { value: "jobsage", label: "JOBSAGE guides" },
];

type FormValues = {
  title: string;
  description: string;
  category: LearningVideoInput["category"];
  mediaMode: "embed" | "upload";
  videoUrl: string;
  language: string;
  applicability: string;
  sourceLabel: string;
  sourceUrl: string;
  transcript: string;
  reviewedBy: string;
  reviewedAt: string;
  reviewDueAt: string;
  status: LearningVideo["status"];
  sortOrder: string;
};

const todayDate = () => new Date().toISOString().slice(0, 10);
const toDateInput = (value?: string | null) => value ? new Date(value).toISOString().slice(0, 10) : todayDate();
const readableCategory = (value: LearningVideo["category"]) => categories.find((item) => item.value === value)?.label ?? value;
const requiresApplicability = (category: LearningVideo["category"]) =>
  ["sponsorship", "medical", "professional_registration", "relocation"].includes(category);
const formatDate = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
const statusTone: Record<LearningVideo["status"], string> = {
  draft: "bg-[#f2ead8] text-[#7e6228]",
  published: "bg-[#e1eee5] text-[#326348]",
  archived: "bg-[#ecebe7] text-[#6b716d]",
};

function freshForm(): FormValues {
  return {
    title: "", description: "", category: "application", mediaMode: "embed", videoUrl: "",
    language: "English", applicability: "", sourceLabel: "", sourceUrl: "", transcript: "",
    reviewedBy: "", reviewedAt: todayDate(), reviewDueAt: todayDate(), status: "draft", sortOrder: "0",
  };
}

function formFromVideo(video: LearningVideo): FormValues {
  return {
    title: video.title, description: video.description, category: video.category,
    mediaMode: video.videoEmbedUrl ? "embed" : "upload", videoUrl: video.videoEmbedUrl ?? "",
    language: video.language, applicability: video.applicability ?? "", sourceLabel: video.sourceLabel,
    sourceUrl: video.sourceUrl ?? "", transcript: video.transcript ?? "", reviewedBy: video.reviewedBy,
    reviewedAt: toDateInput(video.reviewedAt), reviewDueAt: toDateInput(video.reviewDueAt),
    status: video.status, sortOrder: String(video.sortOrder),
  };
}

function fieldClass() {
  return "mt-1.5 min-h-11 w-full rounded-xl border border-[#d8ddd5] bg-[#fffefa] px-3.5 py-2.5 text-sm text-[#243630] outline-none transition placeholder:text-[#9aa39c] focus:border-[#9b493c] focus:ring-4 focus:ring-[#9b493c]/10";
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return <span className="text-xs font-semibold text-[#45584f]">{children}{required && <span className="ml-1 text-[#a34135]">*</span>}</span>;
}

export default function AdminLearningVideosPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useListAdminLearningVideos();
  const createVideo = useCreateLearningVideo();
  const updateVideo = useUpdateLearningVideo();
  const requestUpload = useRequestLearningVideoUploadUrl();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LearningVideo | null>(null);
  const [form, setForm] = useState<FormValues>(freshForm);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [statusFilter, setStatusFilter] = useState<LearningVideo["status"] | "all">("all");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videos = data?.videos ?? [];
  const counts = useMemo(() => ({
    published: videos.filter((video) => video.status === "published").length,
    draft: videos.filter((video) => video.status === "draft").length,
    archived: videos.filter((video) => video.status === "archived").length,
  }), [videos]);
  const filteredVideos = useMemo(() => videos.filter((video) => {
    const matchesStatus = statusFilter === "all" || video.status === statusFilter;
    const matchesQuery = !query.trim() || `${video.title} ${video.sourceLabel} ${readableCategory(video.category)}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesStatus && matchesQuery;
  }), [videos, statusFilter, query]);
  const isSaving = createVideo.isPending || updateVideo.isPending || requestUpload.isPending;
  const invalidateLibraries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListAdminLearningVideosQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListLearningVideosQueryKey() }),
    ]);
  };

  const openNew = () => {
    setEditing(null);
    setForm(freshForm());
    setSelectedFile(null);
    setNotice(null);
    setFormOpen(true);
  };

  const openEdit = (video: LearningVideo) => {
    setEditing(video);
    setForm(formFromVideo(video));
    setSelectedFile(null);
    setNotice(null);
    setFormOpen(true);
  };

  const setValue = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setForm((current) => ({ ...current, [key]: value }));

  const uploadFile = async (file: File) => {
    const inferredType = file.type || (file.name.toLowerCase().endsWith(".webm") ? "video/webm" : file.name.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4");
    const acceptedTypes: LearningVideoUploadRequest["contentType"][] = ["video/mp4", "video/webm", "video/quicktime"];
    if (!acceptedTypes.includes(inferredType as LearningVideoUploadRequest["contentType"])) {
      throw new Error("Choose an MP4, WebM or QuickTime video file.");
    }
    if (!file.size || file.size > MAX_VIDEO_BYTES) throw new Error("Video files must be no larger than 250 MB.");
    const response = await requestUpload.mutateAsync({
      data: { name: file.name, size: file.size, contentType: inferredType as LearningVideoUploadRequest["contentType"] },
    });
    if (file.size > response.maxBytes) throw new Error("This file exceeds the upload limit returned by the server.");
    const put = await fetch(response.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": inferredType },
      body: file,
    });
    if (!put.ok) throw new Error(`Video upload failed (${put.status}). Please try again.`);
    return response.storageKey;
  };

  const saveVideo = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);
    if (form.mediaMode === "embed" && !form.videoUrl.trim()) {
      setNotice({ type: "error", text: "Add an embed or video URL before saving." });
      return;
    }
    if (form.mediaMode === "upload" && !selectedFile && !editing?.mediaUrl) {
      setNotice({ type: "error", text: "Choose a video file to upload." });
      return;
    }
    try {
      let storageKey: string | undefined;
      let videoUrl: string | undefined;
      if (form.mediaMode === "embed") {
        videoUrl = form.videoUrl.trim();
      } else if (selectedFile) {
        storageKey = await uploadFile(selectedFile);
      }
      const input: LearningVideoInput = {
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        ...(videoUrl ? { videoUrl } : {}),
        ...(storageKey ? { storageKey } : {}),
        language: form.language.trim(),
        applicability: form.applicability.trim() || null,
        sourceLabel: form.sourceLabel.trim(),
        sourceUrl: form.sourceUrl.trim() || null,
        transcript: form.transcript.trim() || null,
        reviewedBy: form.reviewedBy.trim(),
        reviewedAt: form.reviewedAt,
        reviewDueAt: form.reviewDueAt,
        status: form.status,
        sortOrder: Number(form.sortOrder) || 0,
      };
      if (editing) {
        await updateVideo.mutateAsync({ id: editing.id, data: input });
      } else {
        await createVideo.mutateAsync({ data: input });
      }
      await invalidateLibraries();
      setFormOpen(false);
      setNotice({ type: "success", text: editing ? "Video details updated." : "Video added to the library." });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Could not save this video. Please try again." });
    }
  };

  const changeStatus = async (video: LearningVideo, status: LearningVideo["status"]) => {
    const data: LearningVideoInput = {
      title: video.title,
      description: video.description,
      category: video.category,
      ...(video.videoEmbedUrl ? { videoUrl: video.videoEmbedUrl } : {}),
      durationSeconds: video.durationSeconds,
      language: video.language,
      applicability: video.applicability,
      sourceLabel: video.sourceLabel,
      sourceUrl: video.sourceUrl,
      transcript: video.transcript,
      reviewedBy: video.reviewedBy,
      reviewedAt: video.reviewedAt,
      reviewDueAt: video.reviewDueAt,
      status,
      sortOrder: video.sortOrder,
    };
    try {
      await updateVideo.mutateAsync({ id: video.id, data });
      await invalidateLibraries();
      setNotice({ type: "success", text: status === "published" ? "Video published for candidates." : status === "archived" ? "Video archived." : "Video returned to draft." });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Could not update video status." });
    }
  };

  return (
    <main className="min-h-[100dvh] bg-[#f7f6f1] text-[#22332e]">
      <div className="mx-auto max-w-[1440px] px-5 pb-16 pt-8 sm:px-8 lg:px-12">
        <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-[#7b8880]"><ShieldCheck className="h-4 w-4 text-[#a34135]" /> Staff workspace <span className="text-[#bdc4bc]">/</span> Learning library</div>
          <div className="flex items-center gap-2 rounded-full border border-[#d9ded5] bg-[#fffefa] px-3 py-1.5 text-xs font-medium text-[#5d6b62]"><span className="h-2 w-2 rounded-full bg-[#5d8d6b]" /> Staff-reviewed content</div>
        </div>

        <header className="flex flex-col justify-between gap-6 border-b border-[#dedfd7] pb-8 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#a34135]">Knowledge, kept current</p>
            <h1 className="mt-2 font-display text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Learning library</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#68756d] sm:text-base">Manage staff-reviewed videos that support candidates across their UK career journeys. Every item should have a clear source, named reviewer and review date.</p>
          </div>
          <button onClick={openNew} className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#a34135] px-5 text-sm font-semibold text-white shadow-[0_5px_12px_rgba(113,49,38,0.16)] transition hover:bg-[#88382e] active:scale-[0.98]"><Plus className="h-4 w-4" /> Add a video</button>
        </header>

        {notice && <div className={`mt-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${notice.type === "success" ? "border-[#c8ddcf] bg-[#edf5ef] text-[#355f45]" : "border-[#e6c9c2] bg-[#fcf0ed] text-[#84453a]"}`}>
          {notice.type === "success" ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="flex-1">{notice.text}</span><button onClick={() => setNotice(null)} aria-label="Dismiss message"><X className="h-4 w-4" /></button>
        </div>}

        <section className="mt-7 grid gap-3 sm:grid-cols-3">
          {[
            { label: "Published", value: counts.published, detail: "Visible to candidates", icon: Video, tone: "text-[#457254] bg-[#e1eee5]" },
            { label: "Drafts", value: counts.draft, detail: "Not yet in the hub", icon: Pencil, tone: "text-[#8b6d31] bg-[#f2ead8]" },
            { label: "Archived", value: counts.archived, detail: "Kept for your records", icon: Archive, tone: "text-[#6d7771] bg-[#ecebe7]" },
          ].map((item) => <div key={item.label} className="flex items-center gap-4 rounded-2xl border border-[#e0e1d9] bg-[#fffefa] px-5 py-4">
            <span className={`grid h-11 w-11 place-items-center rounded-xl ${item.tone}`}><item.icon className="h-5 w-5" /></span>
            <div><p className="font-display text-2xl font-semibold leading-none">{item.value}</p><p className="mt-1 text-sm font-semibold text-[#45584f]">{item.label}</p><p className="mt-0.5 text-xs text-[#849087]">{item.detail}</p></div>
          </div>)}
        </section>

        <section className="mt-8 overflow-hidden rounded-2xl border border-[#e0e1d9] bg-[#fffefa]">
          <div className="flex flex-col gap-4 border-b border-[#e9e9e2] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div><h2 className="font-display text-xl font-semibold tracking-[-0.02em]">All videos</h2><p className="mt-1 text-xs text-[#79857d]">{videos.length} {videos.length === 1 ? "library item" : "library items"}</p></div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative">
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#869189]" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search videos" className="h-10 w-full rounded-lg border border-[#dce0d8] bg-[#fbfaf6] pl-10 pr-3 text-sm outline-none focus:border-[#a34135] sm:w-56" />
              </label>
              <label className="relative">
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="h-10 w-full appearance-none rounded-lg border border-[#dce0d8] bg-[#fbfaf6] pl-3 pr-9 text-sm text-[#44574d] outline-none focus:border-[#a34135] sm:w-40">
                  <option value="all">Every status</option><option value="published">Published</option><option value="draft">Drafts</option><option value="archived">Archived</option>
                </select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#77847b]" />
              </label>
            </div>
          </div>

          {isLoading ? <div className="divide-y divide-[#ecece5]">
            {[0, 1, 2, 3].map((i) => <div key={i} className="flex gap-4 px-5 py-5"><div className="h-14 w-20 animate-pulse rounded-lg bg-[#eceee8]" /><div className="flex-1 space-y-2"><div className="h-4 w-1/3 animate-pulse rounded bg-[#eceee8]" /><div className="h-3 w-2/3 animate-pulse rounded bg-[#eceee8]" /></div></div>)}
          </div> : isError ? <div className="px-6 py-14 text-center">
            <CircleAlert className="mx-auto h-8 w-8 text-[#a34135]" /><h3 className="mt-3 font-display text-xl font-semibold">Library unavailable</h3><p className="mt-1 text-sm text-[#738078]">We couldn’t load the staff video list.</p><button onClick={() => refetch()} className="mt-4 rounded-lg bg-[#a34135] px-4 py-2 text-sm font-semibold text-white">Retry</button>
          </div> : filteredVideos.length === 0 ? <div className="px-6 py-14 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#edf0e8] text-[#697a6e]"><FileVideo2 className="h-5 w-5" /></div><h3 className="mt-4 font-display text-xl font-semibold">{videos.length ? "No matching videos" : "Start building the trusted library"}</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#79857d]">{videos.length ? "Adjust your search or status filter." : "Add a clear, reviewed resource for candidates navigating their next step."}</p>{!videos.length && <button onClick={openNew} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#a34135] px-4 py-2.5 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> Add the first video</button>}
          </div> : <div className="divide-y divide-[#ecece5]">
            {filteredVideos.map((video) => <article key={video.id} className="grid gap-4 px-5 py-5 transition hover:bg-[#fbfaf6] sm:grid-cols-[1fr_auto] sm:items-center sm:px-6">
              <div className="flex min-w-0 gap-4">
                <div className="grid h-[60px] w-[88px] shrink-0 place-items-center rounded-xl bg-[#263d37] text-[#e8d8b9]"><Video className="h-5 w-5" /></div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${statusTone[video.status]}`}>{video.status}</span><span className="text-[11px] font-medium text-[#7b8980]">{readableCategory(video.category)}</span>{video.durationSeconds && <span className="text-[11px] text-[#89938b]">{Math.floor(video.durationSeconds / 60)} min</span>}</div>
                  <h3 className="mt-2 truncate font-display text-base font-semibold">{video.title}</h3>
                  <p className="mt-1 line-clamp-1 text-xs text-[#758179]">{video.sourceLabel} · {video.language} · Reviewed {formatDate(video.reviewedAt)} · Due {formatDate(video.reviewDueAt)}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                {video.status === "draft" && <button disabled={isSaving} onClick={() => void changeStatus(video, "published")} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#e5f0e8] px-3 text-xs font-semibold text-[#38664a] transition hover:bg-[#d6e8dc] disabled:opacity-50"><Send className="h-3.5 w-3.5" /> Publish</button>}
                {video.status === "published" && <button disabled={isSaving} onClick={() => void changeStatus(video, "archived")} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#e0e1d9] px-3 text-xs font-semibold text-[#606d64] transition hover:bg-[#f1f0eb] disabled:opacity-50"><Archive className="h-3.5 w-3.5" /> Archive</button>}
                {video.status === "archived" && <button disabled={isSaving} onClick={() => void changeStatus(video, "draft")} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#e0e1d9] px-3 text-xs font-semibold text-[#606d64] transition hover:bg-[#f1f0eb] disabled:opacity-50"><ArrowDownUp className="h-3.5 w-3.5" /> Restore draft</button>}
                <button onClick={() => openEdit(video)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#d9ded6] px-3 text-xs font-semibold text-[#45584f] transition hover:border-[#9b493c]/50 hover:bg-[#f7f3eb]"><Pencil className="h-3.5 w-3.5" /> Edit</button>
              </div>
            </article>)}
          </div>}
        </section>

        <div className="mt-5 flex items-start gap-3 rounded-xl border border-[#e8e0cf] bg-[#f2efe5] px-4 py-3.5 text-xs leading-5 text-[#716849]">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0" /><p><strong className="font-semibold">Review rhythm matters.</strong> Keep the reviewer and due date current, especially for immigration, registration and clinical guidance that can change.</p>
        </div>
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#14231e]/70 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label={editing ? "Edit learning video" : "Add learning video"} onClick={() => !isSaving && setFormOpen(false)}>
          <div className="max-h-[96dvh] w-full max-w-3xl overflow-y-auto rounded-t-[1.5rem] bg-[#f8f7f2] shadow-2xl sm:rounded-[1.5rem]" onClick={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-[#e4e4dc] bg-[#f8f7f2]/95 px-5 py-4 backdrop-blur sm:px-7">
              <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#a34135]">{editing ? "Library record" : "Curate a resource"}</p><h2 className="mt-1 font-display text-2xl font-semibold tracking-[-0.03em]">{editing ? "Edit video" : "Add a learning video"}</h2><p className="mt-1 text-xs text-[#79857d]">Required details are marked. Review information stays visible to candidates.</p></div>
              <button onClick={() => setFormOpen(false)} disabled={isSaving} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#d9ddd5] text-[#53615a] hover:bg-[#ecece5] disabled:opacity-50" aria-label="Close editor"><X className="h-5 w-5" /></button>
            </div>

            <form onSubmit={saveVideo} className="space-y-7 px-5 py-6 sm:px-7 sm:py-7">
              <section>
                <div className="mb-4 flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#e7ede5] text-[11px] font-bold text-[#52705b]">1</span><h3 className="font-display text-base font-semibold">Resource details</h3></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="sm:col-span-2"><Label required>Video title</Label><input required maxLength={160} value={form.title} onChange={(event) => setValue("title", event.target.value)} placeholder="For example, understanding your NMC registration" className={fieldClass()} /></label>
                  <label><Label required>Topic</Label><select required value={form.category} onChange={(event) => setValue("category", event.target.value as FormValues["category"])} className={fieldClass()}>{categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                  <label><Label required>Language</Label><input required minLength={2} maxLength={24} value={form.language} onChange={(event) => setValue("language", event.target.value)} placeholder="English" className={fieldClass()} /></label>
                  <label className="sm:col-span-2"><Label required>Description</Label><textarea required maxLength={3000} rows={3} value={form.description} onChange={(event) => setValue("description", event.target.value)} placeholder="What will a candidate understand or be able to do after watching?" className={`${fieldClass()} resize-y`} /></label>
                  <label className="sm:col-span-2"><Label required={requiresApplicability(form.category)}>Who is this for?</Label><textarea required={requiresApplicability(form.category)} maxLength={1000} rows={2} value={form.applicability} onChange={(event) => setValue("applicability", event.target.value)} placeholder="Profession, stage of journey, or eligibility context" className={`${fieldClass()} resize-y`} /></label>
                </div>
              </section>

              <section className="border-t border-[#e4e4dc] pt-6">
                <div className="mb-4 flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#e7ede5] text-[11px] font-bold text-[#52705b]">2</span><h3 className="font-display text-base font-semibold">Video source</h3></div>
                <div className="mb-4 flex w-fit rounded-xl border border-[#dfe2d9] bg-[#eeefe9] p-1">
                  <button type="button" onClick={() => { setValue("mediaMode", "embed"); setSelectedFile(null); }} className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition ${form.mediaMode === "embed" ? "bg-[#fffefa] text-[#31463b] shadow-sm" : "text-[#77837b]"}`}>External video</button>
                  <button type="button" onClick={() => { setValue("mediaMode", "upload"); setValue("videoUrl", ""); }} className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition ${form.mediaMode === "upload" ? "bg-[#fffefa] text-[#31463b] shadow-sm" : "text-[#77837b]"}`}>Upload a file</button>
                </div>
                {form.mediaMode === "embed" ? <label className="block"><Label required>Video or embed URL</Label><input required type="url" value={form.videoUrl} onChange={(event) => setValue("videoUrl", event.target.value)} placeholder="https://…" className={fieldClass()} /><span className="mt-1.5 block text-[11px] leading-5 text-[#849087]">Use a video provider URL that can be embedded for playback.</span></label> : <div>
                  <input ref={fileInputRef} type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" className="sr-only" onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    if (!file) return;
                    if (file.size > MAX_VIDEO_BYTES) {
                      setSelectedFile(null);
                      setNotice({ type: "error", text: "Video files must be no larger than 250 MB." });
                      event.target.value = "";
                    } else {
                      setNotice(null);
                      setSelectedFile(file);
                    }
                  }} />
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="flex w-full items-center gap-4 rounded-xl border border-dashed border-[#bdc9bc] bg-[#f0f3ed] p-4 text-left transition hover:border-[#879d8b] hover:bg-[#eaf0e8]">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#dce7da] text-[#4d7256]"><UploadCloud className="h-5 w-5" /></span>
                    <span className="min-w-0 flex-1"><strong className="block truncate text-sm text-[#3c5144]">{selectedFile ? selectedFile.name : editing?.mediaUrl && !editing.videoEmbedUrl ? "Keep the current uploaded video" : "Choose an MP4, WebM or MOV file"}</strong><span className="mt-1 block text-xs text-[#758179]">{selectedFile ? `${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB · Upload begins when you save` : editing?.mediaUrl && !editing.videoEmbedUrl ? "No replacement file selected — the existing source will be preserved." : "Maximum 250 MB. Uploaded directly to secure storage."}</span></span>
                    <span className="rounded-lg border border-[#d5ddd2] bg-[#fffefa] px-3 py-2 text-xs font-semibold text-[#43574a]">Browse</span>
                  </button>
                  {editing?.mediaUrl && !editing.videoEmbedUrl && <p className="mt-2 text-[11px] leading-5 text-[#64756a]">The existing uploaded source will be preserved unless you choose a replacement file.</p>}
                </div>}
              </section>

              <section className="border-t border-[#e4e4dc] pt-6">
                <div className="mb-4 flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#e7ede5] text-[11px] font-bold text-[#52705b]">3</span><h3 className="font-display text-base font-semibold">Trust and review</h3></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label><Label required>Source / publisher</Label><input required maxLength={160} value={form.sourceLabel} onChange={(event) => setValue("sourceLabel", event.target.value)} placeholder="NHS, NMC, JOBSAGE…" className={fieldClass()} /></label>
                  <label><Label>Source link</Label><input type="url" value={form.sourceUrl} onChange={(event) => setValue("sourceUrl", event.target.value)} placeholder="https://…" className={fieldClass()} /></label>
                  <label><Label required>Reviewed by</Label><input required maxLength={160} value={form.reviewedBy} onChange={(event) => setValue("reviewedBy", event.target.value)} placeholder="Staff member or team" className={fieldClass()} /></label>
                  <label><Label required>Last reviewed</Label><input required type="date" value={form.reviewedAt} onChange={(event) => setValue("reviewedAt", event.target.value)} className={fieldClass()} /></label>
                  <label><Label required>Review due</Label><input required type="date" value={form.reviewDueAt} onChange={(event) => setValue("reviewDueAt", event.target.value)} className={fieldClass()} /></label>
                  <label><Label required>Library status</Label><select required value={form.status} onChange={(event) => setValue("status", event.target.value as FormValues["status"])} className={fieldClass()}><option value="draft">Draft — not visible to candidates</option><option value="published">Published — visible to candidates</option><option value="archived">Archived — retained for staff</option></select></label>
                  <label><Label>Transcript</Label><textarea rows={3} maxLength={50000} value={form.transcript} onChange={(event) => setValue("transcript", event.target.value)} placeholder="Optional transcript for accessible reading" className={`${fieldClass()} resize-y`} /></label>
                  <label><Label>Sort order</Label><input type="number" min={0} max={100000} value={form.sortOrder} onChange={(event) => setValue("sortOrder", event.target.value)} className={fieldClass()} /></label>
                </div>
              </section>

              <div className="flex flex-col-reverse gap-3 border-t border-[#e4e4dc] pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] text-[#859087]">Candidates see published videos only.</p>
                <div className="flex gap-2">
                  <button type="button" disabled={isSaving} onClick={() => setFormOpen(false)} className="h-11 rounded-xl border border-[#d9ded5] px-4 text-sm font-semibold text-[#5c6b62] hover:bg-[#efeee8] disabled:opacity-50">Cancel</button>
                  <button type="submit" disabled={isSaving} className="inline-flex h-11 min-w-36 items-center justify-center gap-2 rounded-xl bg-[#a34135] px-5 text-sm font-semibold text-white transition hover:bg-[#88382e] disabled:cursor-wait disabled:opacity-70">{isSaving ? <><LoaderCircle className="h-4 w-4 animate-spin" /> Saving…</> : <><Check className="h-4 w-4" /> {editing ? "Save changes" : "Save video"}</>}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
