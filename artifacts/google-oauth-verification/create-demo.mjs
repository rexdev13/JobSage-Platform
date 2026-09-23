import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "../jobsage-web/node_modules/@playwright/test/index.mjs";

const root = process.cwd();
const screenshotPath = path.join(root, "attached_assets", "image_1790153778075.png");
const outputDir = path.join(root, "artifacts", "google-oauth-verification");
const outputPath = path.join(outputDir, "JOBSAGE-google-calendar-verification-demo.mp4");
const tempDir = path.join(outputDir, ".recording");

const googleConsentImage = (await fs.readFile(screenshotPath)).toString("base64");

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap');
    :root { color-scheme: dark; font-family: "DM Sans", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; overflow: hidden; background: #08111f; color: #f8fafc; }
    .frame { width: 100vw; height: 100vh; position: relative; overflow: hidden; background:
      radial-gradient(circle at 82% 18%, rgba(60, 160, 255, .23), transparent 32%),
      radial-gradient(circle at 10% 82%, rgba(20, 184, 166, .15), transparent 35%),
      linear-gradient(135deg, #08111f 0%, #0e1c31 52%, #101b2c 100%); }
    .grid { position: absolute; inset: 0; opacity: .16; background-image:
      linear-gradient(rgba(148, 163, 184, .18) 1px, transparent 1px),
      linear-gradient(90deg, rgba(148, 163, 184, .18) 1px, transparent 1px);
      background-size: 48px 48px; transform: perspective(650px) rotateX(60deg) scale(1.5) translateY(24%); transform-origin: center bottom; }
    .orb { position: absolute; border-radius: 999px; filter: blur(2px); opacity: .42; animation: drift 9s ease-in-out infinite; }
    .orb.a { width: 210px; height: 210px; right: 5%; top: 5%; background: #1976d2; }
    .orb.b { width: 145px; height: 145px; left: 5%; bottom: 7%; background: #0f9d8b; animation-delay: -3s; }
    @keyframes drift { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-28px,22px) scale(1.08); } }
    .topbar { position: absolute; z-index: 20; left: 48px; right: 48px; top: 28px; display: flex; justify-content: space-between; align-items: center; color: #cbd5e1; font-size: 15px; letter-spacing: .04em; }
    .brand { font-family: "Space Grotesk"; font-weight: 700; color: white; font-size: 19px; letter-spacing: -.03em; }
    .pill { border: 1px solid rgba(148,163,184,.28); border-radius: 999px; padding: 8px 14px; background: rgba(15,23,42,.5); }
    .scene { position: absolute; inset: 0; padding: 116px 80px 70px; display: flex; align-items: center; opacity: 0; transform: translateY(22px) scale(.985); pointer-events: none; transition: opacity .7s ease, transform .7s cubic-bezier(.16,1,.3,1); }
    .scene.active { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
    .scene > .content { width: 100%; max-width: 1120px; margin: 0 auto; position: relative; z-index: 2; }
    h1,h2,h3 { font-family: "Space Grotesk"; margin: 0; letter-spacing: -.045em; }
    h1 { font-size: 76px; line-height: .98; max-width: 900px; }
    h2 { font-size: 49px; line-height: 1.02; }
    h3 { font-size: 23px; }
    p { color: #b7c4d8; font-size: 21px; line-height: 1.42; max-width: 780px; margin: 22px 0 0; }
    .eyebrow { color: #5eead4; font-size: 15px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; margin-bottom: 18px; }
    .accent { color: #5eead4; }
    .small { font-size: 16px; color: #a8b6ca; }
    .tag { display: inline-flex; align-items: center; gap: 8px; color: #dbeafe; border: 1px solid rgba(96,165,250,.3); background: rgba(30,64,175,.18); padding: 10px 14px; border-radius: 10px; margin-top: 30px; font-size: 16px; }
    .dot { width: 8px; height: 8px; background: #5eead4; border-radius: 50%; box-shadow: 0 0 16px #5eead4; }
    .hero-card { position: absolute; right: 4%; bottom: 8%; width: 290px; height: 180px; padding: 20px; border-radius: 18px; border: 1px solid rgba(148,163,184,.22); background: linear-gradient(145deg, rgba(30,64,175,.35), rgba(15,23,42,.72)); box-shadow: 0 24px 70px rgba(0,0,0,.25); transform: rotate(7deg); animation: float 5s ease-in-out infinite; }
    .hero-card .line { height: 9px; border-radius: 99px; background: rgba(226,232,240,.22); margin: 13px 0; }
    .hero-card .line.short { width: 62%; background: rgba(94,234,212,.65); }
    @keyframes float { 0%,100% { transform: rotate(7deg) translateY(0); } 50% { transform: rotate(4deg) translateY(-13px); } }
    .dashboard { display: grid; grid-template-columns: 190px 1fr; gap: 0; min-height: 420px; border: 1px solid rgba(148,163,184,.24); border-radius: 18px; overflow: hidden; background: rgba(15,23,42,.86); box-shadow: 0 25px 80px rgba(0,0,0,.34); }
    .side { padding: 24px 18px; border-right: 1px solid rgba(148,163,184,.18); background: rgba(2,6,23,.3); }
    .side-title { font-family: "Space Grotesk"; font-weight: 700; margin-bottom: 32px; }
    .nav { color: #8fa2bc; padding: 12px 10px; border-radius: 9px; margin-bottom: 7px; font-size: 14px; }
    .nav.selected { color: white; background: rgba(45,212,191,.12); border: 1px solid rgba(45,212,191,.18); }
    .dash-main { padding: 28px 34px; }
    .dash-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; }
    .dash-head h3 { font-size: 28px; }
    .button { background: #2dd4bf; color: #06251f; padding: 11px 16px; border-radius: 9px; font-weight: 700; font-size: 14px; }
    .calendar-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
    .metric { border: 1px solid rgba(148,163,184,.18); border-radius: 12px; padding: 16px; background: rgba(30,41,59,.46); }
    .metric b { display: block; font-size: 25px; margin-top: 8px; }
    .booking { margin-top: 24px; border: 1px solid rgba(96,165,250,.3); border-radius: 13px; padding: 19px; background: rgba(30,64,175,.16); display: flex; align-items: center; justify-content: space-between; }
    .booking strong { display: block; margin-bottom: 7px; }
    .booking span { color: #aebed1; font-size: 14px; }
    .consent-layout { display: grid; grid-template-columns: .85fr 1.15fr; gap: 45px; align-items: center; }
    .consent-frame { background: #050505; padding: 13px; border-radius: 13px; border: 1px solid rgba(148,163,184,.28); box-shadow: 0 20px 80px rgba(0,0,0,.38); }
    .consent-frame img { width: 100%; display: block; border-radius: 5px; }
    .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 34px; }
    .step { position: relative; min-height: 194px; padding: 23px; border-radius: 15px; border: 1px solid rgba(148,163,184,.22); background: rgba(15,23,42,.72); }
    .step-num { display: inline-flex; width: 29px; height: 29px; border-radius: 50%; justify-content: center; align-items: center; background: #2dd4bf; color: #042c27; font-weight: 800; margin-bottom: 23px; }
    .step p { font-size: 16px; margin-top: 10px; }
    .shield-list { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 32px; max-width: 900px; }
    .shield-item { padding: 18px 20px; border-radius: 14px; background: rgba(15,23,42,.72); border: 1px solid rgba(148,163,184,.2); font-size: 17px; color: #d6e0ee; }
    .shield-item b { color: #5eead4; display: block; margin-bottom: 6px; }
    .final { text-align: center; }
    .final p { margin-left: auto; margin-right: auto; }
    .url { display: inline-block; margin-top: 30px; color: #5eead4; font-family: "Space Grotesk"; font-size: 24px; padding: 15px 20px; border: 1px solid rgba(94,234,212,.3); border-radius: 12px; background: rgba(20,184,166,.08); }
    .footer { position: absolute; z-index: 30; left: 48px; right: 48px; bottom: 27px; display: flex; justify-content: space-between; color: #71819a; font-size: 13px; letter-spacing: .03em; }
    .progress { display: flex; gap: 6px; align-items: center; }
    .progress i { display: block; width: 22px; height: 3px; background: rgba(148,163,184,.35); border-radius: 99px; }
    .progress i.active { background: #5eead4; width: 42px; }
    .active .reveal { animation: reveal .75s both cubic-bezier(.16,1,.3,1); }
    .active .reveal.d1 { animation-delay: .12s; }
    .active .reveal.d2 { animation-delay: .24s; }
    .active .reveal.d3 { animation-delay: .38s; }
    .active .reveal.d4 { animation-delay: .52s; }
    @keyframes reveal { from { opacity: 0; transform: translateY(20px); filter: blur(4px); } to { opacity: 1; transform: translateY(0); filter: blur(0); } }
  </style>
</head>
<body>
  <main class="frame">
    <div class="grid"></div><div class="orb a"></div><div class="orb b"></div>
    <div class="topbar"><div class="brand">JOBSAGE</div><div class="pill">Google OAuth verification demo · Test account</div></div>

    <section class="scene active" data-scene="0"><div class="content">
      <div class="eyebrow reveal">Google Calendar integration</div>
      <h1 class="reveal d1">Book interviews with <span class="accent">Google Meet</span>.</h1>
      <p class="reveal d2">JOBSAGE connects a marketer’s own calendar to check availability and manage interview bookings.</p>
      <div class="tag reveal d3"><span class="dot"></span> Optional connection · user initiated · marketer-owned account</div>
      <div class="hero-card reveal d4"><div class="small">Calendar availability</div><div class="line"></div><div class="line short"></div><div class="line"></div><div class="small">Google Meet ready</div></div>
    </div></section>

    <section class="scene" data-scene="1"><div class="content">
      <div class="eyebrow reveal">1 · Start in JOBSAGE</div>
      <div class="dashboard reveal d1">
        <aside class="side"><div class="side-title">JOBSAGE</div><div class="nav">Overview</div><div class="nav">Leads</div><div class="nav selected">Calendar</div><div class="nav">Settings</div></aside>
        <div class="dash-main"><div class="dash-head"><div><h3>Interview calendar</h3><div class="small" style="margin-top:8px">Manage candidate calls and availability</div></div><div class="button">Connect Google Calendar</div></div>
          <div class="calendar-row"><div class="metric"><span class="small">Connection</span><b style="color:#fbbf24">Not connected</b></div><div class="metric"><span class="small">Provider</span><b>Google Meet</b></div><div class="metric"><span class="small">Control</span><b>Optional</b></div></div>
          <div class="booking"><div><strong>Google Calendar + Google Meet</strong><span>JOBSAGE checks conflicts, creates a Meet room, and invites selected attendees.</span></div><div class="button">Connect</div></div>
        </div>
      </div>
    </div></section>

    <section class="scene" data-scene="2"><div class="content consent-layout">
      <div><div class="eyebrow reveal">2 · User consent</div><h2 class="reveal d1">The user reviews the requested access.</h2><p class="reveal d2">The Calendar permission is requested only after the marketer chooses “Connect my Google Calendar”.</p><div class="tag reveal d3"><span class="dot"></span> Scope: googleapis.com/auth/calendar</div></div>
      <div class="consent-frame reveal d2"><img src="data:image/png;base64,${googleConsentImage}" alt="Google consent screen for JOBSAGE" /></div>
    </div></section>

    <section class="scene" data-scene="3"><div class="content">
      <div class="eyebrow reveal">3 · The scope in use</div><h2 class="reveal d1">Only the booking workflow uses Calendar data.</h2>
      <div class="steps">
        <div class="step reveal d1"><span class="step-num">1</span><h3>Check availability</h3><p>JOBSAGE checks free/busy intervals before offering an interview time.</p></div>
        <div class="step reveal d2"><span class="step-num">2</span><h3>Create booking</h3><p>It creates a JOBSAGE-managed event with the selected time and attendees.</p></div>
        <div class="step reveal d3"><span class="step-num">3</span><h3>Send Meet invite</h3><p>Google Calendar creates the Meet link and sends the invitation to guests.</p></div>
      </div>
    </div></section>

    <section class="scene" data-scene="4"><div class="content">
      <div class="eyebrow reveal">4 · User control and limited use</div><h2 class="reveal d1">Calendar data stays tied to the feature.</h2>
      <div class="shield-list">
        <div class="shield-item reveal d1"><b>Encrypted credential</b>The OAuth refresh token is encrypted before JOBSAGE stores it.</div>
        <div class="shield-item reveal d2"><b>No advertising</b>Calendar data is not sold, profiled, or used for advertising.</div>
        <div class="shield-item reveal d3"><b>No general AI training</b>Google Calendar data is not used to train general-purpose AI models.</div>
        <div class="shield-item reveal d4"><b>Disconnect anytime</b>The marketer can disconnect JOBSAGE or revoke access in Google Account settings.</div>
      </div>
    </div></section>

    <section class="scene" data-scene="5"><div class="content final">
      <div class="eyebrow reveal">Google OAuth verification</div><h1 class="reveal d1">A clear, user-controlled calendar connection.</h1>
      <p class="reveal d2">The complete data-use explanation is available in JOBSAGE’s public privacy policy.</p>
      <div class="url reveal d3">jobsage.co.uk/privacy</div>
      <p class="small reveal d4" style="margin-top:24px">JOBSAGE · Google Calendar + Google Meet booking workflow</p>
    </div></section>

    <div class="footer"><span>JOBSAGE · Google API Services User Data Policy / Limited Use</span><span class="progress"><i class="active"></i><i></i><i></i><i></i><i></i><i></i></span></div>
  </main>
  <script>
    const scenes = [...document.querySelectorAll(".scene")];
    const progress = [...document.querySelectorAll(".progress i")];
    let current = 0;
    const show = (index) => {
      current = index;
      scenes.forEach((scene, i) => scene.classList.toggle("active", i === index));
      progress.forEach((bar, i) => bar.classList.toggle("active", i === index));
    };
    setInterval(() => show((current + 1) % scenes.length), 10000);
  </script>
</body>
</html>`;

await fs.mkdir(tempDir, { recursive: true });
await fs.mkdir(outputDir, { recursive: true });
const htmlPath = path.join(tempDir, "index.html");
await fs.writeFile(htmlPath, html, "utf8");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: tempDir, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
await page.goto(`file://${htmlPath}`);
await page.waitForTimeout(61_000);
const video = page.video();
await context.close();
await browser.close();

const webmPath = await video.path();
execFileSync("ffmpeg", [
  "-y",
  "-i", webmPath,
  "-c:v", "libx264",
  "-preset", "medium",
  "-crf", "20",
  "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  outputPath,
], { stdio: "inherit" });

console.log(outputPath);