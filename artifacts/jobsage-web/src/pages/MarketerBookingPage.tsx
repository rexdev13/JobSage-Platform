import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, Clock3, Loader2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type BookingInfo = {
  marketerName: string;
  timeZone: string;
  durationMinutes: number;
  workingHours: string;
};

type BookingSlot = {
  start: string;
  end: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((body as { error?: string }).error ?? "Booking request failed.");
  }
  return body as T;
}

function nextWeekday(): string {
  const date = new Date(Date.now() + 24 * 60 * 60_000);
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

export default function MarketerBookingPage() {
  const slug = window.location.pathname.split("/").filter(Boolean).at(-1) ?? "";
  const [date, setDate] = useState(nextWeekday);
  const [selectedSlot, setSelectedSlot] = useState<BookingSlot | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [consent, setConsent] = useState(false);

  const infoQuery = useQuery<BookingInfo>({
    queryKey: ["public-marketer-booking", slug],
    queryFn: async () => readJson<BookingInfo>(
      await fetch(`${BASE}/api/public/marketer-booking/${encodeURIComponent(slug)}`),
    ),
    retry: false,
  });
  const slotsQuery = useQuery<{ slots: BookingSlot[]; timeZone: string }>({
    queryKey: ["public-marketer-booking-slots", slug, date],
    enabled: infoQuery.isSuccess,
    queryFn: async () => readJson<{ slots: BookingSlot[]; timeZone: string }>(
      await fetch(
        `${BASE}/api/public/marketer-booking/${encodeURIComponent(slug)}/slots?date=${encodeURIComponent(date)}`,
      ),
    ),
    retry: 1,
  });

  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: infoQuery.data?.timeZone ?? "Europe/London",
    }),
    [infoQuery.data?.timeZone],
  );

  const bookingMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSlot) throw new Error("Choose an available time.");
      return readJson<{
        scheduledAt: string;
        endTime: string;
        meetingUrl: string;
        marketerName: string;
      }>(
        await fetch(`${BASE}/api/public/marketer-booking/${encodeURIComponent(slug)}/book`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firstName,
            lastName,
            email,
            start: selectedSlot.start,
            notes: notes.trim() || undefined,
            consent,
          }),
        }),
      );
    },
  });

  if (infoQuery.isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (infoQuery.isError || !infoQuery.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border bg-white p-8 text-center shadow-sm">
          <CalendarDays className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <h1 className="text-xl font-bold text-slate-900">Booking link unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">Ask your JOBSAGE contact for an active scheduling link.</p>
        </div>
      </div>
    );
  }

  if (bookingMutation.isSuccess) {
    const booking = bookingMutation.data;
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-red-50 px-4 py-12">
        <div className="mx-auto max-w-xl rounded-3xl border border-emerald-200 bg-white p-8 text-center shadow-xl shadow-slate-200/60">
          <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Your call is booked</h1>
          <p className="mt-2 text-sm text-slate-600">
            Google Calendar has emailed the invitation to {email}. The call with {booking.marketerName} starts at{" "}
            {new Intl.DateTimeFormat("en-GB", {
              dateStyle: "full",
              timeStyle: "short",
              timeZone: infoQuery.data.timeZone,
            }).format(new Date(booking.scheduledAt))}.
          </p>
          <a
            href={booking.meetingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
          >
            <Video className="h-4 w-4" /> Open Google Meet
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-red-50 px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 text-center">
          <p className="font-display text-2xl font-black tracking-[0.16em] text-primary">JOBSAGE</p>
          <p className="mt-1 text-sm text-slate-500">Book a conversation with {infoQuery.data.marketerName}</p>
        </div>
        <div className="grid overflow-hidden rounded-3xl border bg-white shadow-xl shadow-slate-200/60 md:grid-cols-[0.9fr_1.1fr]">
          <aside className="border-b bg-slate-950 p-6 text-white md:border-b-0 md:border-r md:p-8">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10"><Video className="h-5 w-5" /></div>
            <h1 className="mt-5 text-2xl font-bold">JOBSAGE discovery call</h1>
            <p className="mt-2 text-sm leading-6 text-slate-300">Choose an available time for a focused 30-minute Google Meet conversation.</p>
            <div className="mt-6 space-y-3 text-sm text-slate-300">
              <p className="flex items-center gap-2"><Clock3 className="h-4 w-4" /> {infoQuery.data.durationMinutes} minutes</p>
              <p className="flex items-center gap-2"><Video className="h-4 w-4" /> Google Meet link included</p>
              <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4" /> Times shown in {infoQuery.data.timeZone}</p>
            </div>
          </aside>
          <main className="p-6 md:p-8">
            <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
              Select a date
              <input
                type="date"
                value={date}
                min={new Date().toISOString().slice(0, 10)}
                max={new Date(Date.now() + 90 * 24 * 60 * 60_000).toISOString().slice(0, 10)}
                onChange={(event) => {
                  setDate(event.target.value);
                  setSelectedSlot(null);
                }}
                className="h-11 rounded-xl border border-slate-200 px-3 font-normal"
              />
            </label>
            <div className="mt-5">
              <p className="text-sm font-semibold text-slate-800">Available times</p>
              {slotsQuery.isLoading ? (
                <div className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Checking Google Calendar…</div>
              ) : slotsQuery.isError ? (
                <p className="py-6 text-sm text-rose-600">Availability could not be loaded. Try again.</p>
              ) : (slotsQuery.data?.slots.length ?? 0) === 0 ? (
                <p className="py-6 text-sm text-slate-500">No times are available on this date. Choose another weekday.</p>
              ) : (
                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {slotsQuery.data?.slots.map((slot) => (
                    <button
                      key={slot.start}
                      type="button"
                      onClick={() => setSelectedSlot(slot)}
                      className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                        selectedSlot?.start === slot.start
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-slate-200 text-slate-700 hover:border-primary hover:text-primary"
                      }`}
                    >
                      {timeFormatter.format(new Date(slot.start))}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedSlot && (
              <div className="mt-6 space-y-3 border-t pt-6">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-sm font-semibold text-slate-800">First name<input value={firstName} onChange={(event) => setFirstName(event.target.value)} className="h-11 rounded-xl border border-slate-200 px-3 font-normal" /></label>
                  <label className="grid gap-1.5 text-sm font-semibold text-slate-800">Last name<input value={lastName} onChange={(event) => setLastName(event.target.value)} className="h-11 rounded-xl border border-slate-200 px-3 font-normal" /></label>
                </div>
                <label className="grid gap-1.5 text-sm font-semibold text-slate-800">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 rounded-xl border border-slate-200 px-3 font-normal" /></label>
                <label className="grid gap-1.5 text-sm font-semibold text-slate-800">Anything we should know? <span className="font-normal text-slate-400">(optional)</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="rounded-xl border border-slate-200 px-3 py-2 font-normal" /></label>
                <label className="flex items-start gap-2 text-xs leading-5 text-slate-600">
                  <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1" />
                  I agree that JOBSAGE may use these details to arrange and manage this call under its privacy policy.
                </label>
                {bookingMutation.isError && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{bookingMutation.error.message}</p>}
                <Button
                  className="h-11 w-full"
                  disabled={bookingMutation.isPending || !firstName.trim() || !lastName.trim() || !email.trim() || !consent}
                  onClick={() => bookingMutation.mutate()}
                >
                  {bookingMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Booking…</> : "Book Google Meet call"}
                </Button>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}