// Screen/window capture only. The first decoded stream is locked until stop.
import { LTDecoder } from "../shared/fountain";
import { confirmAction, guardNavigation } from "../shared/confirm";
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
import { TransferClock } from "../shared/transfer-clock";
import { closeOnBackdropClick } from "../shared/dialog";

declare global {
  interface Window {
    decimenDesktop?: {
      onDownloadCompleted(callback: () => void): void;
      openTargetFolder(): Promise<void>;
    };
  }
}


const el = (id: string) => document.getElementById(id)!;
const startBtn = el("start") as HTMLButtonElement;
const receiveControls = el("receive-controls");
const pauseReceiveBtn = el("pause-receive") as HTMLButtonElement;
const cancelReceiveBtn = el("cancel-receive") as HTMLButtonElement;
const video = el("video") as HTMLVideoElement;
const preview = el("preview");
const stats = el("stats");
const progressEl = el("progress");
const bar = el("bar");
const progressStatus = el("progress-status");
const progressLabel = el("progress-label");
const etaLabel = el("eta-label");
const result = el("result");
const metricsEl = el("metrics");
const diagnosticsEl = el("diagnostics") as HTMLDetailsElement;
const settingsEl = el("settings");
const cfgWidth = el("cfg-width") as HTMLSelectElement;
const cfgCapFps = el("cfg-capfps") as HTMLSelectElement;
const cfgWorkers = el("cfg-workers") as HTMLSelectElement;
const captureActual = el("capture-actual");
const noSignalToast = el("no-signal");
const noSignalDialog = el("no-signal-dialog") as HTMLDialogElement;
const metric = el;
const STATS_WINDOW_MS = 2000;
const clock = new TransferClock();
let stream: MediaStream | null = null;
let decoder: LTDecoder | null = null;
let streamKey = "";
let captureGen = 0;
let done = false;
let paused = false;
let starting = false;
let resultSaved = false;
let receivedUrl: string | null = null;
let statsTimer: ReturnType<typeof setInterval> | undefined;
let noSignal = new NoSignalHintTimer(8000, 15000);
const pool = new DecodeWorkerPool(createDecodeWorker, bytes => onDecoded(bytes), message => {
  cancelReceive();
  showError(`解码器启动失败：${message}。请重试或使用兼容版本。`);
});
const captureTimes: number[] = [];
const decodeTimes: number[] = [];
const {setStatus, showError} = statusLine(stats);
function updateReceiveControls(): void {
  const active = !!stream && !done;
  receiveControls.hidden = !active;
  pauseReceiveBtn.textContent = paused ? "继续接收" : "暂停";
  pauseReceiveBtn.setAttribute("aria-pressed", String(paused));
  el("receive-paused").hidden = !paused;
  el("receive-empty").hidden = active || done;
  el("receive-state").textContent = done ? "正在校验" : paused ? "已暂停" : active ? "接收中" : "待就绪";
  el("receive-state").dataset.active = String(active && !paused);
}
function setSearchingStatus(): void {
  setStatus(decoder ? "正在接收，暂停可保留进度。" : "正在寻找二维码，请保持发送窗口可见。是否已在发送端点击开始传输？");
}
function resetNoSignal(): void {
  noSignal = new NoSignalHintTimer(8000, 15000);
  noSignalToast.hidden = true;
}
function offerRetry(message: string, error = true): void {
  startBtn.disabled = false;
  startBtn.hidden = false;
  startBtn.textContent = "选择接收窗口 ↗";
  starting = false;
  updateReceiveControls();
  if (error) showError(message); else setStatus(message);
}
async function start(): Promise<void> {
  if (stream || starting || done) return;
  if (!navigator.mediaDevices?.getDisplayMedia) {
    showError("当前环境不支持屏幕采集，请使用桌面版，或通过 HTTPS / localhost 打开。 ");
    return;
  }
  starting = true;
  startBtn.disabled = true;
  startBtn.textContent = "正在选择窗口…";
  const gen = ++captureGen;
  try {
    const selected = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: {width: {ideal: Number(cfgWidth.value)}, frameRate: {ideal: Number(cfgCapFps.value)}},
    });
    if (gen !== captureGen) { selected.getTracks().forEach(track => track.stop()); return; }
    stream = selected;
    video.srcObject = selected;
    await video.play();
    if (gen !== captureGen) return;
    starting = false;
    paused = false;
    startBtn.hidden = true;
    preview.style.display = "";
    metricsEl.style.display = "grid";
    diagnosticsEl.style.display = "block";
    updateReceiveControls();
    setSearchingStatus();
    pool.resize(Number(cfgWorkers.value));
    reportCaptureSettings();
    selected.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (stream !== selected || done) return;
      cancelReceive();
      setStatus("窗口共享已结束，当前进度已清除。可以重新选择窗口。");
    }, {once:true});
    resetNoSignal();
    noSignal.captureStarted(performance.now());
    scheduleFrame(gen);
    statsTimer = setInterval(updateStats, 500);
    void requestScreenWakeLock();
  } catch (error) {
    if (gen !== captureGen) return;
    cancelReceive();
    const cancelled = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError");
    offerRetry(cancelled ? "未选择窗口，可以随时重新选择。" : `无法采集：${error instanceof Error ? error.message : String(error)}`, !cancelled);
  }
}
function pauseReceive(): void {
  if (!stream || done || paused) return;
  paused = true;
  captureGen++;
  clock.pause();
  video.pause();
  pool.resize(0); // Drop in-flight frames so a resumed transfer cannot accept stale work.
  clearInterval(statsTimer);
  statsTimer = undefined;
  captureTimes.length = decodeTimes.length = 0;
  noSignalToast.hidden = true;
  etaLabel.textContent = "已暂停 · 保留当前进度";
  setStatus("接收已暂停；所选窗口仍在共享。终止可释放共享并清除进度。");
  updateReceiveControls();
}
async function resumeReceive(): Promise<void> {
  if (!stream || done || !paused) return;
  const gen = ++captureGen;
  pauseReceiveBtn.disabled = true;
  try {
    await video.play();
    if (!stream || done || gen !== captureGen) return;
    paused = false;
    clock.resume();
    pool.resize(Number(cfgWorkers.value));
    resetNoSignal();
    if (!decoder) noSignal.captureStarted(performance.now());
    setSearchingStatus();
    scheduleFrame(gen);
    statsTimer = setInterval(updateStats, 500);
    updateReceiveControls();
  } catch {
    if (gen === captureGen) showError("无法恢复画面，请终止接收后重新选择窗口。");
  } finally { pauseReceiveBtn.disabled = false; }
}
function cancelReceive(): void {
  captureGen++;
  const previous = stream;
  stream = null;
  previous?.getTracks().forEach(track => track.stop());
  video.pause(); video.srcObject = null;
  pool.resize(0);
  clearInterval(statsTimer); statsTimer = undefined;
  paused = false; starting = false; done = false;
  resultSaved = false;
  if (receivedUrl) URL.revokeObjectURL(receivedUrl);
  receivedUrl = null;
  decoder = null; streamKey = "";
  captureTimes.length = decodeTimes.length = 0;
  clock.reset(); resetNoSignal();
  preview.style.display = "none";
  metricsEl.style.display = "none";
  diagnosticsEl.style.display = "none";
  diagnosticsEl.querySelector("summary")!.textContent = "实时统计";
  progressEl.style.display = progressStatus.style.display = "none";
  bar.style.width = "0%"; bar.classList.remove("error");
  progressEl.setAttribute("aria-valuenow", "0");
  progressLabel.textContent = "0% · 0 帧";
  etaLabel.textContent = "正在估算剩余时间…";
  result.replaceChildren();
  settingsEl.style.display = "";
  if (noSignalDialog.open) noSignalDialog.close();
  captureActual.textContent = "只采集所选画面，不录制视频或音频。";
  offerRetry("已终止接收，当前进度已清除。", false);
}
function reportCaptureSettings(): void {
  const settings = stream?.getVideoTracks()[0]?.getSettings();
  if (settings) captureActual.textContent = `${settings.width} × ${settings.height} · ${Math.round(settings.frameRate ?? 0)} fps · ${pool.size} 解码线程`;
}
async function applyReceiveSettings(): Promise<void> {
  if (!stream || done) return;
  if (!paused) pool.resize(Number(cfgWorkers.value));
  const selected = stream;
  try {
    await selected.getVideoTracks()[0]?.applyConstraints({width: {ideal: Number(cfgWidth.value)}, frameRate: {ideal: Number(cfgCapFps.value)}});
    if (stream === selected) reportCaptureSettings();
  } catch { captureActual.textContent = "采集源不接受当前设置；继续使用原有画面。重新选择窗口可重试。"; }
}
startBtn.onclick = () => void start();
pauseReceiveBtn.onclick = () => { if (paused) void resumeReceive(); else pauseReceive(); };
cancelReceiveBtn.onclick = async () => {
  if (!stream || done) return;
  if (!decoder) { cancelReceive(); return; }
  const wasPaused = paused;
  pauseReceive();
  const confirmed = await confirmAction("终止本次接收？", "已接收的数据将被清除，下次需要从头接收。", "终止接收");
  if (done || !stream) return;
  if (confirmed) cancelReceive();
  else if (!wasPaused) void resumeReceive();
};
guardNavigation(() => !!stream || starting || (done && !resultSaved));
for (const input of [cfgWidth, cfgCapFps, cfgWorkers]) input.addEventListener("change", () => void applyReceiveSettings());
document.querySelector('.mode-nav a[href="../receive/"]')?.setAttribute("aria-current", "page");
const tips = [
  `请在发送端将每帧字节数降低到 ${NO_SIGNAL_HINT_FRAME_BYTES}。`,
  `若仍无进展，将发送帧率降低到 ${NO_SIGNAL_HINT_TX_FPS}。`,
  "保持远程桌面或虚拟机窗口可见，不要最小化；部分系统会停止更新被遮挡的窗口。",
  "选择显示二维码的发送窗口，避免选择本接收窗口。",
];
for (const tip of tips) { const li = document.createElement("li"); li.textContent = tip; el("no-signal-tips").append(li); }
el("no-signal-help").onclick = () => noSignalDialog.showModal();
el("no-signal-close").onclick = () => noSignalDialog.close();
function dismissNoSignal(): void { noSignalToast.hidden = true; noSignal.dismiss(performance.now()); }
el("no-signal-dismiss").onclick = dismissNoSignal;
noSignalDialog.addEventListener("close", dismissNoSignal);
closeOnBackdropClick(noSignalDialog);
function restartButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button"; button.className = "secondary-button"; button.textContent = label;
  button.onclick = async () => {
    if (done && !resultSaved && !(await confirmAction("开始新的接收？", "尚未保存的结果将被清除。", "清除并继续"))) return;
    cancelReceive();
  };
  return button;
}

type VideoRVFC = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };

function scheduleFrame(gen: number) {
  if (done || paused || !stream || gen !== captureGen) return;
  const v = video as VideoRVFC;
  const next = () => {
    if (done || paused || !stream || gen !== captureGen) return;
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
  if (done || paused || !stream) return;
  decodeTimes.push(performance.now());
  const parsed = parseFrame(bytes);
  if (!parsed) return;
  const { header, block } = parsed;
  if (noSignal.frameDecoded()) {
    noSignalToast.hidden = true;
    if (noSignalDialog.open) noSignalDialog.close();
  }
  const identity = streamIdentity(header);
  if (decoder && streamKey !== identity) {
    setStatus("发送会话已变化，请终止当前接收后重新选择窗口。");
    return;
  }
  if (!decoder) {
    decoder = new LTDecoder(header.k, header.blockLen, header.sessionId, header.totalLen);
    streamKey = identity;
    clock.reset();
    setStatus("正在接收，暂停可保留进度；终止将清除当前进度。");
    progressEl.style.display = "block";
    progressStatus.style.display = "flex";
  }
  decoder.addFrame(header.seq, block);
  updateProgressEstimate();

  if (decoder.isComplete) {
    const payload = decoder.assemble()!;
    const seconds = clock.seconds;
    const ok = fnv1a(payload) === header.payloadFnv;
    void finish(payload, ok, seconds);
  }
}

function updateProgressEstimate() {
  if (!decoder) return;
  const elapsed = Math.max(0, clock.seconds);
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
    `${shownPercent}% · ${decoder.solvedCount}/${decoder.k} 数据块`;
  const rate = decoder.framesNew >= 4 ? ` · ${goodputKbs(elapsed).toFixed(1)} KB/s` : "";
  etaLabel.textContent =
    (estimate.etaSeconds === undefined
      ? estimate.phase === "decoding"
        ? `${decoder.framesNew} 帧 · 正在解码`
        : "正在估算剩余时间…"
      : `预计 ${formatDuration(estimate.etaSeconds)} · ${decoder.framesNew} 帧`) + rate;
}

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
  el("receive-state").textContent = "正在校验";
  el("receive-empty").hidden = true;
  setStatus("数据已收齐，正在解压并校验…");
  paused = false;
  captureGen++;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;

  video.pause();
  video.srcObject = null;
  clearInterval(statsTimer);
  statsTimer = undefined;
  pool.resize(0);
  preview.style.display = "none";

  updateReceiveControls();
  settingsEl.style.display = "none";
  const diagnosticsLabel = diagnosticsEl?.querySelector("summary");
  if (diagnosticsLabel) diagnosticsLabel.textContent = "传输统计";
  bar.style.width = "100%";
  progressEl.setAttribute("aria-valuenow", "100");
  etaLabel.textContent = `有效用时 ${formatDuration(seconds)}`;
  try {
    if (!hashOk) throw new Error("传输数据校验不一致，请重新发送。");
    const file = await unpackFile(container);
    if (!(await verifyFile(file))) throw new Error("文件 SHA-256 校验失败，请重新发送。");

    const rate = (container.length / 1024 / Math.max(.1, seconds)).toFixed(1);
    const gzipNote = file.compression === "gzip" ? "已解压 · " : "";
    el("receive-state").textContent = "已完成";
    if (isSnippet(file)) {
      progressLabel.textContent = "100% · 文本已恢复";
      setStatus("");
      showSnippet(
        snippetText(file),
        `${seconds.toFixed(1)} 秒 · ${rate} KB/s · ${gzipNote}SHA-256 校验通过 ✓`,
      );
      return;
    }

    progressLabel.textContent = "100% · 文件已恢复";
    const kb = Math.round(file.bytes.length / 1024);
    setStatus("");
    const summary = document.createElement("p");
    summary.className = "hint";
    summary.textContent =
      `${kb} KB · ${seconds.toFixed(1)} 秒 · ${rate} KB/s · ${gzipNote}SHA-256 校验通过 ✓`;
    const heading = document.createElement("div");
    heading.className = "done";
    heading.textContent = "文件已接收";
    const url = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: file.type }));
    receivedUrl = url;
    const download = document.createElement("a");
    download.className = "download";
    download.href = url;
    download.download = file.name;
    download.addEventListener("click", () => { resultSaved = true; });
    download.textContent = `保存 ${file.name}`;
    result.replaceChildren(heading, summary);
    if (file.type.startsWith("image/")) {
      const image = document.createElement("img");
      image.className = "received";
      image.alt = `文件预览：${file.name}`;
      image.src = url;
      result.append(image);
    } else if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
      const player = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
      player.className = "received";
      player.controls = true;
      player.preload = "metadata";
      player.setAttribute("aria-label", `接收的文件：${file.name}`);
      if (player instanceof HTMLVideoElement) player.playsInline = true;
      const src = await servableMediaUrl(file, url);
      if (src !== url) {
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
      openFolder.textContent = "打开保存目录";
      openFolder.hidden = true;
      desktop.onDownloadCompleted(() => {
        openFolder.hidden = false;
      });
      openFolder.addEventListener("click", async () => {
        openFolder.disabled = true;
        try {
          await desktop.openTargetFolder();
        } catch {
          openFolder.textContent = "打开失败，请重试";
          setTimeout(() => {
            openFolder.textContent = "打开保存目录";
          }, 1500);
        } finally {
          openFolder.disabled = false;
        }
      });
      actions.append(openFolder);
    }
    const endActions = document.createElement("div");
    endActions.className = "note-actions";
    endActions.append(restartButton("接收下一份"));
    if ("caches" in window) endActions.append(clearCacheButton());
    result.append(actions, endActions);
  } catch (error) {
    el("receive-state").textContent = "校验失败";
    resultSaved = true; // A failed checksum has no usable result to preserve.
    bar.classList.add("error");
    etaLabel.textContent = "传输失败";
    showError(error instanceof Error ? error.message : String(error));
    const heading = document.createElement("div");
    heading.className = "failed";
    heading.textContent = "传输失败";
    const detail = document.createElement("p");
    detail.className = "received-note";
    detail.textContent =
      "数据未通过完整性校验，无法保存。请重新开始发送并选择接收窗口。";
    result.replaceChildren(heading, detail, restartButton("重新接收"));
  }
}

function clearCacheButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button";
  button.textContent = "清除媒体缓存";
  button.addEventListener("click", () => {
    button.disabled = true;
    caches.delete("received-media").then(
      () => {
        button.textContent = "缓存已清除";
      },
      () => {
        button.textContent = "清除失败，请重试";
        button.disabled = false;
      },
    );
  });
  return button;
}

async function servableMediaUrl(file: OpticalFile, blobUrl: string): Promise<string> {
  try {
    if (!navigator.serviceWorker?.controller) return blobUrl;
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
    return `${target}?v=${Date.now()}`;
  } catch {
    return blobUrl;
  }
}

function showNoSignalHint() {
  noSignalToast.hidden = false;
}

function showSnippet(text: string, summaryLine: string) {
  const heading = document.createElement("div");
  heading.className = "done";
  heading.textContent = "文本已接收";

  const summary = document.createElement("p");
  summary.className = "hint";
  summary.textContent = summaryLine;

  const body = document.createElement("textarea");
  body.className = "received-note received-snippet";
  body.value = text;
  body.readOnly = true;
  body.spellcheck = false;
  body.setAttribute("aria-label", "接收的文本");

  const actions = document.createElement("div");
  actions.className = "note-actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "text-button";
  copy.textContent = "复制文本";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      resultSaved = true;
      copy.textContent = "已复制";
      setTimeout(() => { copy.textContent = "复制文本"; }, 1500);
    } catch {
      copy.textContent = "复制失败，请手动复制";
    }
  });
  actions.append(copy, restartButton("接收下一份"));

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
  const elapsed = clock.seconds;
  updateProgressEstimate();
  metric("m-rate").textContent = `${goodputKbs(elapsed).toFixed(1)} KB/s`;
  metric("m-time").textContent = `${elapsed.toFixed(0)} s`;
  metric("m-frames").textContent = `${decoder.framesNew}/${decoder.framesDup}`;
  metric("m-k").textContent = String(decoder.k);
  metric("m-block").textContent = `${decoder.blockLen} B`;
  metric("m-payload").textContent = `${Math.round(decoder.totalLen / 1024)} KB`;
}
