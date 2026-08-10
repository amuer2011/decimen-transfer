// Receiver: camera or screen capture → WASM QR decode in workers → fountain
// decoder → file.
//
// Field lessons baked in:
// - iOS treats camera `frameRate: {ideal: 60}` as a suggestion and delivers 30.
//   Demand `exact` first (it works at 1280-wide), fall back to `ideal`.
// - requestVideoFrameCallback chains survive a stopped stream and resume on
//   the next one — a generation counter prevents zombie capture loops.
// - Progress must track frames COLLECTED: LT peeling back-loads its solve
//   cascade, so blocks-solved looks stalled and then teleports to done.
// - Android Chrome exposes torch / focusMode / frameRate.max through
//   getCapabilities; iOS Safari exposes none of them. shared/platform.ts owns
//   the probing, so everything here is capability-gated rather than UA-gated.

import { LTDecoder } from "../shared/fountain";
import {
  estimateTransferProgress,
  expectedFountainOverhead,
  formatDuration,
} from "../shared/progress";
import { createDecodeWorker } from "./worker-factory";
import { NoSignalHintTimer } from "../shared/no-signal";
import { DecodeWorkerPool } from "../shared/worker-pool";
import { isSnippet, snippetText } from "../shared/snippet";
import {
  fnv1a,
  parseFrame,
  streamIdentity,
  unpackFile,
  verifyFile,
  type OpticalFile,
} from "../shared/protocol";
import { NO_SIGNAL_HINT_FRAME_BYTES, NO_SIGNAL_HINT_TX_FPS } from "../shared/send-settings";
import { statusLine } from "../shared/status-line";
import { requestScreenWakeLock } from "../shared/wake-lock";
import { applyAdvancedConstraint, probeCameraCapabilities } from "../shared/platform";
import { closeOnBackdropClick } from "../shared/dialog";

declare global {
  interface Window {
    decimenDesktop?: {
      onDownloadCompleted(callback: () => void): void;
      openTargetFolder(): Promise<void>;
    };
  }
}

const startBtn = document.getElementById("start") as HTMLButtonElement;
const receiveControls = document.getElementById("receive-controls")!;
const pauseReceiveBtn = document.getElementById("pause-receive") as HTMLButtonElement;
const cancelReceiveBtn = document.getElementById("cancel-receive") as HTMLButtonElement;
const video = document.getElementById("video") as HTMLVideoElement;
const sourceEyebrow = document.getElementById("source-eyebrow")!;
const sourcePicker = document.getElementById("receive-mode-picker")!;
const sourceInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="receive-source"]')];
const preview = document.getElementById("preview")!;
const stats = document.getElementById("stats")!;
const progressEl = document.getElementById("progress")!;
const bar = document.getElementById("bar")!;
const progressStatus = document.getElementById("progress-status")!;
const progressLabel = document.getElementById("progress-label")!;
const etaLabel = document.getElementById("eta-label")!;
const result = document.getElementById("result")!;
const metricsEl = document.getElementById("metrics")!;
const diagnosticsEl = document.getElementById("diagnostics") as HTMLDetailsElement | null;
const settingsEl = document.getElementById("settings")!;
const cfgWidth = document.getElementById("cfg-width") as HTMLSelectElement;
const cfgCapFps = document.getElementById("cfg-capfps") as HTMLSelectElement;
const cfgWorkers = document.getElementById("cfg-workers") as HTMLSelectElement;
const captureActual = document.getElementById("capture-actual")!;
const noSignalToast = document.getElementById("no-signal")!;
const noSignalDialog = document.getElementById("no-signal-dialog") as HTMLDialogElement;
const noSignalTips = document.getElementById("no-signal-tips")!;
const metric = (id: string) => document.getElementById(id)!;

// Nothing has decoded in this long → the sender is almost certainly too dense
// for this camera. The first nudge comes quickly (a dead link is dead within
// seconds); a dismissed one comes back on a longer leash, because dismissing
// it doesn't make the transfer start working but the advice has been seen.
const NO_SIGNAL_FIRST_MS = 8_000;
const NO_SIGNAL_DISMISSED_MS = 15_000;

// Sliding window for the capture/decode fps metrics — the per-second rates in
// updateStats() are derived from this, so the window and the divisor can't
// drift apart.
const STATS_WINDOW_MS = 2000;

type ReceiveSource = "camera" | "screen";

let stream: MediaStream | null = null;
let activeSource: ReceiveSource | null = null;
let decoder: LTDecoder | null = null;
let streamKey = "";
let startTs = 0;
let captureGen = 0;
let done = false;
let paused = false;
let settingsWired = false;
let statsTimer: ReturnType<typeof setInterval> | undefined;

const createNoSignal = () => new NoSignalHintTimer(NO_SIGNAL_FIRST_MS, NO_SIGNAL_DISMISSED_MS);
let noSignal = createNoSignal();
const pool = new DecodeWorkerPool(createDecodeWorker, (bytes) => onDecoded(bytes));
const captureTimes: number[] = [];
const decodeTimes: number[] = [];
startBtn.onclick = () => void start();
pauseReceiveBtn.onclick = () => void togglePause();
cancelReceiveBtn.onclick = cancelReceive;

function updateReceiveControls(): void {
  const active = Boolean(stream && activeSource) && !done;
  receiveControls.hidden = !active;
  pauseReceiveBtn.textContent = paused ? "Resume" : "Pause";
  pauseReceiveBtn.setAttribute("aria-pressed", String(paused));
}

function resetNoSignal(): void {
  noSignal = createNoSignal();
  noSignalToast.hidden = true;
}

function currentSource(): ReceiveSource {
  return sourceInputs.find((input) => input.checked)?.value === "screen" ? "screen" : "camera";
}

function sourceLabel(source: ReceiveSource = currentSource()): string {
  return source === "screen" ? "screen capture" : "camera";
}

function setSearchingStatus(): void {
  const settings = stream?.getVideoTracks()[0]?.getSettings();
  setStatus(
    settings
      ? `${sourceLabel(activeSource ?? currentSource())} ${settings.width}×${settings.height}@${settings.frameRate} — searching for a stream…`
      : `${sourceLabel(activeSource ?? currentSource())} — searching for a stream…`,
  );
}

function updateSourceMode(): void {
  const source = currentSource();
  const screen = source === "screen";
  sourceEyebrow.textContent = screen ? "Screen/window → your device" : "Camera → your device";
  if (!stream) {
    startBtn.textContent = screen ? "Capture screen" : "Start camera";
    captureActual.textContent = screen
      ? "Choose the remote-desktop or VM window when the system picker opens."
      : "Applied when the camera starts.";
  }
  renderNoSignalTips(source);
}

for (const input of sourceInputs) input.addEventListener("change", updateSourceMode);

// The header nav markup is shared verbatim between both tool pages; each page
// marks its own link. Optional because the standalone build swaps the nav for
// a badge. Same story on the sender.
document.querySelector('.mode-nav a[href="../receive/"]')?.setAttribute("aria-current", "page");

const { setStatus, showError } = statusLine(stats);

// The toast asks one question; the answers live in the dialog. The list is
// rebuilt when the source changes so camera advice never appears for a screen
// capture session, and the sender tuning numbers stay canonical.
function renderNoSignalTips(source: ReceiveSource): void {
  const lines = source === "screen"
    ? [
        `On the sender, open Transfer settings and drop bytes / frame to ${NO_SIGNAL_HINT_FRAME_BYTES}.`,
        `Still nothing? Drop the sender's tx fps to ${NO_SIGNAL_HINT_TX_FPS} as well.`,
        "Keep the VM or remote-desktop window visible and updating; some systems pause covered or minimized window capture.",
        "Select the remote-desktop window in the system picker, not this receiver tab.",
      ]
    : [
        `On the sender, open Transfer settings and drop bytes / frame to ${NO_SIGNAL_HINT_FRAME_BYTES}.`,
        `Still nothing? Drop the sender's tx fps to ${NO_SIGNAL_HINT_TX_FPS} as well.`,
        "Fill this camera's view with the code, and prop the phone against something — autofocus hunting from hand tremor is the usual culprit.",
        "Turn the sending screen's brightness all the way up.",
      ];
  noSignalTips.replaceChildren();
  for (const line of lines) {
    const item = document.createElement("li");
    item.textContent = line;
    noSignalTips.append(item);
  }
}

renderNoSignalTips(currentSource());

document.getElementById("no-signal-help")!.addEventListener("click", () => {
  noSignalDialog.showModal();
});
document.getElementById("no-signal-dismiss")!.addEventListener("click", dismissNoSignal);
document.getElementById("no-signal-close")!.addEventListener("click", () => noSignalDialog.close());
// A tap on the backdrop closes too — geometry-tested, see shared/dialog.ts.
closeOnBackdropClick(noSignalDialog);
// close fires on the button, Esc, the backdrop, and the programmatic close
// when a frame finally decodes — all of them mean the advice has been seen.
noSignalDialog.addEventListener("close", dismissNoSignal);

function dismissNoSignal() {
  noSignalToast.hidden = true;
  noSignal.dismiss(performance.now());
}

/** By the time a transfer ends the camera, worker pool and stats timer are all
 *  torn down and `done` is latched, so a reload is the honest way back to a
 *  live receiver — and it drops the recovered bytes from memory on the way. */
function restartButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button";
  button.textContent = label;
  button.addEventListener("click", () => window.location.reload());
  return button;
}

/** Put the page back the way it was so a refused camera can be retried without
 *  a reload. Tapping "Block" by accident on the permission prompt is easy, and
 *  a dead page with no button is a bad answer to it. */
function offerRetry(message: string) {
  paused = false;
  startBtn.disabled = false;
  startBtn.style.display = "";
  sourcePicker.style.display = "";
  for (const input of sourceInputs) input.disabled = false;
  updateSourceMode();
  preview.style.display = "none";
  metricsEl.style.display = "none";
  if (diagnosticsEl) diagnosticsEl.style.display = "none";
  updateReceiveControls();
  showError(message);
}

async function start() {
  if (stream || activeSource) return;
  const source = currentSource();
  const supported = source === "screen"
    ? navigator.mediaDevices?.getDisplayMedia
    : navigator.mediaDevices?.getUserMedia;
  if (!supported) {
    // On insecure origins the media APIs do not exist AT ALL — this is the
    // plain-http-over-LAN case. localhost is exempt; other hosts need https.
    showError(
      `${sourceLabel(source)} needs a secure context — this page must be served over https. ` +
        "`npm run dev` already is.",
    );
    return;
  }
  done = false;
  paused = false;
  resetNoSignal();
  const captureWidth = Number(cfgWidth.value);
  const captureFps = Number(cfgCapFps.value);
  // Nothing on the page changes until the camera is actually running: the
  // error paths below all have to leave a usable Start button behind.
  startBtn.disabled = true;
  for (const input of sourceInputs) input.disabled = true;
  startBtn.textContent = "Starting…";
  const base: MediaTrackConstraints = {
    width: { ideal: captureWidth },
    ...(source === "camera"
      ? { facingMode: "environment", height: { ideal: Math.round((captureWidth * 3) / 4) } }
      : {}),
  };
  try {
    if (source === "screen") {
      // Display capture constraints may use `ideal`, but browsers reject the
      // camera-style `exact` form. The system picker is shown directly from
      // this click path; no file or recording is created.
      stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: { ...base, frameRate: { ideal: captureFps } },
      });
    } else {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { ...base, frameRate: { exact: captureFps } },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { ...base, frameRate: { ideal: captureFps } },
        });
      }
    }
  } catch (err) {
    const denied =
      err instanceof DOMException &&
      (err.name === "NotAllowedError" || err.name === "AbortError");
    offerRetry(
      denied
        ? `${sourceLabel(source)} permission denied or selection cancelled — try again.`
        : `${sourceLabel(source)}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  activeSource = source;
  startBtn.style.display = "none";
  sourcePicker.style.display = "none";
  // "": back to the stylesheet's flex — the zone centers the camera box.
  preview.style.display = "";
  metricsEl.style.display = "grid";
  if (diagnosticsEl) diagnosticsEl.style.display = "block";
  updateReceiveControls();
  video.srcObject = stream;
  await video.play().catch(() => undefined);
  setSearchingStatus();

  pool.resize(Number(cfgWorkers.value));
  reportCaptureSettings();
  void applyCaptureExtras();
  stream.getVideoTracks()[0]?.addEventListener("ended", handleCaptureEnded, { once: true });
  if (!settingsWired) {
    settingsWired = true;
    for (const el of [cfgWidth, cfgCapFps, cfgWorkers]) {
      el.addEventListener("change", () => void applyReceiveSettings());
    }
  }

  noSignal.cameraStarted(performance.now());
  captureGen++;
  scheduleFrame(captureGen);
  statsTimer = setInterval(updateStats, 500);
  await requestScreenWakeLock();
}

/** A user can stop a display share from the browser's system indicator. Leave
 * the receiver retryable instead of keeping a dead preview and a live worker
 * pool on screen. `finish()` sets `done` first, so its deliberate track stop
 * cannot enter this path. */
function handleCaptureEnded(): void {
  if (done || !activeSource) return;
  const source = activeSource;
  paused = false;
  captureGen++;
  stream = null;
  activeSource = null;
  video.pause();
  video.srcObject = null;
  decoder = null;
  streamKey = "";
  clearInterval(statsTimer);
  statsTimer = undefined;
  pool.resize(0);
  preview.style.display = "none";
  metricsEl.style.display = "none";
  if (diagnosticsEl) diagnosticsEl.style.display = "none";
  progressEl.style.display = "none";
  progressStatus.style.display = "none";
  noSignalToast.hidden = true;
  updateReceiveControls();
  offerRetry(`${sourceLabel(source)} ended — choose the source and try again.`);
}

function pauseReceive(): void {
  if (!stream || !activeSource || done || paused) return;
  paused = true;
  captureGen++;
  video.pause();
  clearInterval(statsTimer);
  statsTimer = undefined;
  noSignalToast.hidden = true;
  setStatus("Paused — tap Resume to continue");
  updateReceiveControls();
}

async function resumeReceive(): Promise<void> {
  if (!stream || !activeSource || done || !paused) return;
  paused = false;
  noSignalToast.hidden = true;
  noSignal.cameraStarted(performance.now());
  await video.play().catch(() => undefined);
  if (!stream || !activeSource || done) return;
  setSearchingStatus();
  captureGen++;
  scheduleFrame(captureGen);
  if (!statsTimer) statsTimer = setInterval(updateStats, 500);
  updateReceiveControls();
}

function togglePause(): void {
  if (paused) void resumeReceive();
  else pauseReceive();
}

function cancelReceive(): void {
  if (!stream && !activeSource) return;
  const activeStream = stream;
  paused = false;
  done = false;
  captureGen++;
  activeSource = null;
  stream = null;
  video.pause();
  activeStream?.getTracks().forEach((track) => track.stop());
  video.srcObject = null;
  decoder = null;
  streamKey = "";
  startTs = 0;
  clearInterval(statsTimer);
  statsTimer = undefined;
  pool.resize(0);
  captureTimes.length = 0;
  decodeTimes.length = 0;
  preview.style.display = "none";
  metricsEl.style.display = "none";
  if (diagnosticsEl) diagnosticsEl.style.display = "none";
  const diagnosticsLabel = diagnosticsEl?.querySelector("summary");
  if (diagnosticsLabel) diagnosticsLabel.textContent = "Live diagnostics";
  progressEl.style.display = "none";
  progressStatus.style.display = "none";
  bar.style.width = "0%";
  bar.classList.remove("error");
  progressEl.setAttribute("aria-valuenow", "0");
  progressLabel.textContent = "0% · 0 frames";
  etaLabel.textContent = "Estimating time…";
  result.replaceChildren();
  settingsEl.style.display = "";
  sourcePicker.style.display = "";
  for (const input of sourceInputs) input.disabled = false;
  startBtn.disabled = false;
  startBtn.style.display = "";
  resetNoSignal();
  if (noSignalDialog.open) noSignalDialog.close();
  updateSourceMode();
  updateReceiveControls();
  setStatus("Receive cancelled — ready to scan again");
}

/** Report what the input actually negotiated — iOS in particular will happily
 *  hand a camera back at 30 fps after accepting a request for 60. */
function reportCaptureSettings() {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  const s = track.getSettings();
  const askedFps = Number(cfgCapFps.value);
  const gotFps = Math.round(s.frameRate ?? 0);
  const fpsNote = gotFps && gotFps !== askedFps ? ` (asked ${askedFps})` : "";
  captureActual.textContent =
    `${sourceLabel(activeSource ?? currentSource())} ${s.width}×${s.height} @ ${gotFps} fps${fpsNote} · ${pool.size} decode ` +
    `worker${pool.size === 1 ? "" : "s"} · changes apply live`;
}

/** Use what this camera can actually do, probed rather than UA-sniffed.
 *  Continuous autofocus is applied silently — a lens hunting between frames is
 *  the top decode killer, and a camera that refuses is left as it was. Screen
 *  capture has no equivalent focus probe, so its fps options stay available. */
async function applyCaptureExtras() {
  for (const option of Array.from(cfgCapFps.options)) option.disabled = false;
  if (activeSource !== "camera") return;
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  const caps = probeCameraCapabilities(track);
  if (caps.continuousFocus) {
    await applyAdvancedConstraint(track, { focusMode: "continuous" });
  }
  if (caps.maxFrameRate) {
    for (const option of Array.from(cfgCapFps.options)) {
      option.disabled = Number(option.value) > caps.maxFrameRate;
    }
  }
}

async function applyReceiveSettings() {
  // finish() has already torn the pool down — don't resurrect it.
  if (done) return;
  pool.resize(Number(cfgWorkers.value));
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  const width = Number(cfgWidth.value);
  try {
    const constraints: MediaTrackConstraints = {
      width: { ideal: width },
      frameRate: { ideal: Number(cfgCapFps.value) },
    };
    if (activeSource === "camera") {
      constraints.height = { ideal: Math.round((width * 3) / 4) };
    }
    await track.applyConstraints(constraints);
  } catch {
    // Some devices and display sources refuse a live reconfigure. Keep the
    // input we have rather than tearing down a transfer in progress.
    captureActual.textContent =
      `this ${sourceLabel(activeSource ?? currentSource())} refused a live change — restart to apply`;
    return;
  }
  reportCaptureSettings();
}

type VideoRVFC = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };

function scheduleFrame(gen: number) {
  if (done || gen !== captureGen) return;
  const v = video as VideoRVFC;
  const next = () => {
    if (done || gen !== captureGen) return;
    captureFrame();
    scheduleFrame(gen);
  };
  if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(next);
  else requestAnimationFrame(next);
}

const grab = document.createElement("canvas");
let frameId = 0;

function captureFrame() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  captureTimes.push(performance.now());
  if (pool.busyCount === pool.size) return; // all busy — drop it, no harm done
  if (grab.width !== vw || grab.height !== vh) {
    grab.width = vw;
    grab.height = vh;
  }
  const ctx = grab.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0);
  const img = ctx.getImageData(0, 0, vw, vh);
  pool.submit({ id: frameId++, buf: img.data.buffer, w: vw, h: vh }, [img.data.buffer]);
}

function onDecoded(bytes: Uint8Array) {
  if (done || paused || !activeSource) return;
  decodeTimes.push(performance.now());
  const parsed = parseFrame(bytes);
  if (!parsed) return;
  const { header, block } = parsed;
  if (noSignal.frameDecoded()) {
    noSignalToast.hidden = true;
    // The dialog's premise ("nothing decoded") just became false mid-read.
    if (noSignalDialog.open) noSignalDialog.close();
  }
  // streamIdentity() covers every header field that has to hold constant, not
  // just the session id — see the note on it in protocol.ts.
  const identity = streamIdentity(header);
  if (!decoder || streamKey !== identity) {
    decoder = new LTDecoder(header.k, header.blockLen, header.sessionId, header.totalLen);
    streamKey = identity;
    startTs = performance.now();
    progressEl.style.display = "block";
    progressStatus.style.display = "flex";
  }
  decoder.addFrame(header.seq, block);
  updateProgressEstimate();

  if (decoder.isComplete) {
    const payload = decoder.assemble()!;
    const seconds = (performance.now() - startTs) / 1000;
    const ok = fnv1a(payload) === header.payloadFnv;
    void finish(payload, ok, seconds);
  }
}

function updateProgressEstimate() {
  if (!decoder) return;
  const elapsed = Math.max(0, (performance.now() - startTs) / 1000);
  const estimate = estimateTransferProgress(
    decoder.k,
    decoder.framesNew,
    elapsed,
    decoder.solvedCount,
  );
  const percent = estimate.fraction * 100;
  const shownPercent = percent < 10 ? percent.toFixed(1) : percent.toFixed(0);
  bar.style.width = `${percent.toFixed(1)}%`;
  progressEl.setAttribute("aria-valuenow", String(Math.floor(percent)));
  progressLabel.textContent =
    `${shownPercent}% · ${decoder.solvedCount}/${decoder.k} blocks`;
  // Held back for the first few frames — a two-frame sample reads wildly wrong.
  const rate = decoder.framesNew >= 4 ? ` · ${goodputKbs(elapsed).toFixed(1)} KB/s` : "";
  etaLabel.textContent =
    (estimate.etaSeconds === undefined
      ? estimate.phase === "decoding"
        ? `${decoder.framesNew} frames · decoding`
        : "Estimating time…"
      : `About ${formatDuration(estimate.etaSeconds)} · ${decoder.framesNew} frames`) + rate;
}

/** Payload KB/s, discounting the frames the fountain spends on overhead. That
 *  discount is k-dependent — assuming a flat 1.18 over-reported small transfers
 *  by up to 2×, because a short stream needs far more redundancy per block. */
function goodputKbs(elapsed: number): number {
  if (!decoder) return 0;
  return (
    (decoder.framesNew * decoder.blockLen) /
    expectedFountainOverhead(decoder.k) /
    1024 /
    Math.max(0.1, elapsed)
  );
}

async function finish(container: Uint8Array, hashOk: boolean, seconds: number) {
  done = true;
  paused = false;
  captureGen++;
  // Tear the whole capture pipeline down: the camera/screen stream, stats
  // timer, and decode pool. Each worker holds its own ~940 KB zxing WASM instance, which
  // is worth reclaiming on a phone the moment the last frame is in.
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  activeSource = null;
  video.pause();
  video.srcObject = null;
  clearInterval(statsTimer);
  statsTimer = undefined;
  pool.resize(0);
  preview.style.display = "none";
  sourcePicker.style.display = "none";
  updateReceiveControls();
  // The transfer is over and the pipeline is gone: settings for a camera that
  // no longer exists would just be a dead control panel.
  settingsEl.style.display = "none";
  // The metrics stay, frozen at their last tick — but "Live" is no longer
  // true, so the panel relabels itself as the record of the run it now is.
  const diagnosticsLabel = diagnosticsEl?.querySelector("summary");
  if (diagnosticsLabel) diagnosticsLabel.textContent = "Transfer summary";
  bar.style.width = "100%";
  progressEl.setAttribute("aria-valuenow", "100");
  etaLabel.textContent = `${formatDuration(seconds)} total`;
  try {
    if (!hashOk) throw new Error("The optical stream checksum did not match.");
    const file = await unpackFile(container);
    if (!(await verifyFile(file))) throw new Error("The recovered file failed SHA-256 verification.");

    // The container carries its own media type, so the receiver never has to be
    // told in advance whether a file or a text snippet is coming.
    const rate = (container.length / 1024 / seconds).toFixed(1);
    const gzipNote = file.compression === "gzip" ? "gzip decompressed · " : "";
    if (isSnippet(file)) {
      progressLabel.textContent = "100% · text recovered";
      setStatus("");
      showSnippet(
        snippetText(file),
        `text in ${seconds.toFixed(1)} s · ${rate} KB/s · ${gzipNote}SHA-256 verified ✓`,
      );
      return;
    }

    progressLabel.textContent = "100% · file recovered";
    const kb = Math.round(file.bytes.length / 1024);
    // The run's numbers belong under the heading, not up in the camera status
    // line — which is done for good and goes quiet.
    setStatus("");
    const summary = document.createElement("p");
    summary.className = "hint";
    summary.textContent =
      `${kb} KB in ${seconds.toFixed(1)} s · ${rate} KB/s · ${gzipNote}SHA-256 verified ✓`;
    const heading = document.createElement("div");
    heading.className = "done";
    heading.textContent = "Transfer Complete!";
    const url = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: file.type }));
    const download = document.createElement("a");
    download.className = "download";
    download.href = url;
    download.download = file.name;
    download.textContent = `Save ${file.name}`;
    // Reading order of the finished page: heading, the run's numbers, the
    // thing that arrived, Save under it, "Receive another file", and the
    // Transfer summary panel last in its natural spot after #result.
    result.replaceChildren(heading, summary);
    if (file.type.startsWith("image/")) {
      const image = document.createElement("img");
      image.className = "received";
      image.alt = `Received file preview: ${file.name}`;
      image.src = url;
      result.append(image);
    } else if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
      const player = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
      player.className = "received";
      player.controls = true;
      player.preload = "metadata";
      player.setAttribute("aria-label", `Received file: ${file.name}`);
      // Inline, and never autoplay — the user taps play (which is also the
      // gesture that lets it start with sound).
      if (player instanceof HTMLVideoElement) player.playsInline = true;
      const src = await servableMediaUrl(file, url);
      if (src !== url) {
        // AVFoundation has been seen bypassing service workers for media
        // loads; if the cache path 404s, fall back to the blob rather than
        // leaving a dead player.
        player.addEventListener("error", () => { player.src = url; }, { once: true });
      }
      player.src = src;
      result.append(player);
    }
    const actions = document.createElement("div");
    actions.className = "note-actions";
    actions.append(download);
    const desktop = window.decimenDesktop;
    if (desktop) {
      const openFolder = document.createElement("button");
      openFolder.type = "button";
      openFolder.className = "secondary-button";
      openFolder.textContent = "Open target folder";
      openFolder.hidden = true;
      desktop.onDownloadCompleted(() => {
        openFolder.hidden = false;
      });
      openFolder.addEventListener("click", async () => {
        openFolder.disabled = true;
        try {
          await desktop.openTargetFolder();
        } catch {
          openFolder.textContent = "Open folder failed";
          setTimeout(() => {
            openFolder.textContent = "Open target folder";
          }, 1500);
        } finally {
          openFolder.disabled = false;
        }
      });
      actions.append(openFolder);
    }
    const endActions = document.createElement("div");
    endActions.className = "note-actions";
    endActions.append(restartButton("Receive another file"));
    // The received bytes sit in the Cache API so the media player can range
    // over them (see servableMediaUrl) — which means they outlive the page.
    // Offer the scrub right where the transfer ends.
    if ("caches" in window) endActions.append(clearCacheButton());
    result.append(actions, endActions);
  } catch (error) {
    // Everything is already torn down by this point, so the only way back to a
    // live receiver is a reload. Offer it: a failed checksum used to leave the
    // page dead with nothing but an error string on it.
    bar.classList.add("error");
    etaLabel.textContent = "Transfer failed";
    showError(error instanceof Error ? error.message : String(error));
    const heading = document.createElement("div");
    heading.className = "failed";
    heading.textContent = "Transfer failed";
    const detail = document.createElement("p");
    detail.className = "received-note";
    detail.textContent =
      "Nothing usable came out of that stream. Restart the sender, then scan it again — " +
      "a partial transfer costs nothing but the time.";
    result.replaceChildren(heading, detail, restartButton("Try again"));
  }
}

/** Deletes the received-media cache — the one thing Decimen persists (see
 *  servableMediaUrl). Handing the phone over shouldn't mean handing over the
 *  last transfer. A player still streaming from the cache falls back to its
 *  blob URL via the error listener wired in finish(). */
function clearCacheButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button";
  button.textContent = "Clear Decimen cache";
  button.addEventListener("click", () => {
    button.disabled = true;
    caches.delete("received-media").then(
      () => {
        button.textContent = "Cache cleared";
      },
      () => {
        button.textContent = "Clear failed — try again";
        button.disabled = false;
      },
    );
  });
  return button;
}

/** A playable URL for received media. iOS Safari will not reliably play media
 *  handed to <video>/<audio> as a blob: URL — WebKit's media loader wants real
 *  HTTP semantics, Range requests included (a lesson inherited from the
 *  original demo's range-shim worker). The bytes go into the Cache API and
 *  come back out through the service worker's range-aware route at a real URL
 *  (see runtimeCaching in vite.config.ts). The blob URL stands in when no
 *  worker controls the page: first ever visit, or the standalone file. */
async function servableMediaUrl(file: OpticalFile, blobUrl: string): Promise<string> {
  try {
    if (!navigator.serviceWorker?.controller) return blobUrl;
    // Resolved against the page (one directory deep), landing on the site
    // root — where the worker's route matches under any deploy subpath.
    const target = new URL("../received-media/current", window.location.href).href;
    const cache = await caches.open("received-media");
    await cache.put(
      target,
      new Response(new Blob([file.bytes as BlobPart]), {
        headers: {
          "Content-Type": file.type,
          "Content-Length": String(file.bytes.length),
        },
      }),
    );
    // The query defeats the media element's memory of this URL from an
    // earlier transfer; the worker matches with ignoreSearch.
    return `${target}?v=${Date.now()}`;
  } catch {
    return blobUrl;
  }
}

/**
 * Seconds of camera and not one decoded frame.
 *
 * Both real fixes are on the SENDER, which is the non-obvious part — someone
 * staring at a blank receiver reaches for the phone. The defaults (2953 bytes
 * per frame at 60 fps) are tuned for a close-range phone-to-phone demo and are
 * exactly the combination that fails on an ordinary monitor at arm's length.
 *
 * The toast itself only asks the question; the sender-side advice sits behind
 * its Help button in a modal. It stops for good on the first frame that
 * parses, which is the only thing that actually means it worked.
 */
function showNoSignalHint() {
  noSignalToast.hidden = false;
}

/** Nothing is persisted: the text lives here until the page is closed. The
 *  summary line mirrors the file path — run stats under the heading, not up
 *  in the camera status line. */
function showSnippet(text: string, summaryLine: string) {
  const heading = document.createElement("div");
  heading.className = "done";
  heading.textContent = "Text received";

  const summary = document.createElement("p");
  summary.className = "hint";
  summary.textContent = summaryLine;

  const body = document.createElement("p");
  body.className = "received-note";
  body.textContent = text;

  const actions = document.createElement("div");
  actions.className = "note-actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "text-button";
  copy.textContent = "Copy";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = "Copied";
      setTimeout(() => { copy.textContent = "Copy"; }, 1500);
    } catch {
      copy.textContent = "Copy failed";
    }
  });
  actions.append(copy, restartButton("Receive another file"));

  result.replaceChildren(heading, summary, body, actions);
}

function updateStats() {
  if (done) return;
  const now = performance.now();
  const prune = (a: number[]) => {
    while (a.length > 0 && a[0]! < now - STATS_WINDOW_MS) a.shift();
  };
  prune(captureTimes);
  prune(decodeTimes);
  const perSecond = (a: number[]) => a.length / (STATS_WINDOW_MS / 1000);
  metric("m-cap").textContent = perSecond(captureTimes).toFixed(0);
  metric("m-dec").textContent = perSecond(decodeTimes).toFixed(1);
  if (noSignal.tick(now)) showNoSignalHint();
  if (!decoder) return;
  const elapsed = (now - startTs) / 1000;
  updateProgressEstimate();
  metric("m-rate").textContent = `${goodputKbs(elapsed).toFixed(1)} KB/s`;
  metric("m-time").textContent = `${elapsed.toFixed(0)} s`;
  metric("m-frames").textContent = `${decoder.framesNew}/${decoder.framesDup}`;
  metric("m-k").textContent = String(decoder.k);
  metric("m-block").textContent = `${decoder.blockLen} B`;
  metric("m-payload").textContent = `${Math.round(decoder.totalLen / 1024)} KB`;
}
