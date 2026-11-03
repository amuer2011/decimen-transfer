// Sender: preparation is separate from transmission. Pause keeps the encoder
// and sequence; stop invalidates every asynchronous task and clears the QR.
import QRCode from "qrcode";
import { guardNavigation } from "../shared/confirm";
import { fitQrDisplaySize } from "../shared/display";
import { rasterizeQr } from "../shared/qr-raster";
import { formatBytes } from "../shared/format";
import {
  blockLength,
  fitsInOneStream,
  minimumFrameBytes,
  smallestSufficientFrameSize,
} from "../shared/frame-capacity";
import { LTEncoder } from "../shared/fountain";
import { MAX_SNIPPET_BYTES, MAX_SNIPPET_LABEL, packSnippet } from "../shared/snippet";
import {
  MAX_FILE_BYTES,
  MAX_FILE_LABEL,
  fnv1a,
  packFile,
  packFrame,
  type FrameHeader,
  type PackedOpticalFile,
} from "../shared/protocol";
import { statusLine } from "../shared/status-line";
import { requestScreenWakeLock } from "../shared/wake-lock";


const MARGIN = 4;
const LOOKAHEAD = 3;
const DEMO = import.meta.env.VITE_DEMO === "1";
const el = (id: string) => document.getElementById(id)!;
const canvas = el("qr") as HTMLCanvasElement;
const stage = el("stage");
const specs = el("specs");
const cfgFile = el("cfg-file") as HTMLInputElement;
const filePickerLabel = el("file-picker-label");
const filePickerButton = el("file-picker-button");
const toolTitle = el("tool-title");
const snippetText = el("snippet-text") as HTMLTextAreaElement;
const snippetLabel = el("snippet-label");
const sendSnippetBtn = el("send-snippet") as HTMLButtonElement;
const paneFile = el("pane-file");
const paneSnippet = el("pane-snippet");
const paneDemo = el("pane-demo");
const modePicker = el("mode-picker");
const modeInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="send-mode"]')];
const streamSpecs = el("stream-specs");
const footerHint = el("footer-hint");
const startBtn = el("start-send") as HTMLButtonElement;
const pauseBtn = el("pause-send") as HTMLButtonElement;
const stopBtn = el("stop-send") as HTMLButtonElement;
const expandBtn = el("expand-send") as HTMLButtonElement;
const spec = el;
const cfgFps = el("cfg-fps") as HTMLSelectElement;
const cfgBytes = el("cfg-bytes") as HTMLSelectElement;
const cfgEcc = el("cfg-ecc") as HTMLSelectElement;
const cfgSize = el("cfg-size") as HTMLInputElement;

let selectedFile: { name: string; size: number; payload: Uint8Array;
  compression: "none" | "gzip"; transmittedSize: number } | null = null;
let generation = 0;
let preparing = false;
let sending = false;
let paused = false;
let resizeDisplay: (() => void) | null = null;
let fileDragDepth = 0;
const specsLine = statusLine(specs);
const setStatus = specsLine.setStatus;
type SendMode = "file" | "snippet";
function currentMode(): SendMode {
  return modeInputs.find(input => input.checked)?.value === "snippet" ? "snippet" : "file";
}
function showStreamPanels(visible: boolean): void { streamSpecs.hidden = !visible; }
function updateFilePicker(): void {
  filePickerButton.textContent = selectedFile ? "更换文件" : "选择文件";
  filePickerLabel.textContent = selectedFile ? `${selectedFile.name} · ${formatBytes(selectedFile.size)}` : `或拖放到这里 · 最大 ${MAX_FILE_LABEL}`;
}
function updateControls(): void {
  const locked = sending || preparing;
  cfgFile.disabled = locked;
  snippetText.disabled = locked;
  sendSnippetBtn.disabled = locked || !snippetText.value.trim();
  for (const input of modeInputs) input.disabled = locked;
  for (const input of [cfgFps, cfgBytes, cfgEcc]) input.disabled = locked;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-demo]')) button.disabled = locked;
  paneFile.classList.toggle("is-locked", locked);
  startBtn.hidden = sending;
  startBtn.disabled = !selectedFile || preparing;
  pauseBtn.hidden = !sending;
  pauseBtn.textContent = paused ? "继续传输" : "暂停";
  pauseBtn.setAttribute("aria-pressed", String(paused));
  stopBtn.disabled = !locked && !selectedFile;
  stopBtn.textContent = preparing ? "取消准备" : sending ? "终止" : "清除";
  expandBtn.disabled = !sending;
  el("send-empty").hidden = sending;
  el("send-empty").querySelector("h2")!.textContent = preparing ? "正在准备内容" : selectedFile ? "内容已就绪" : "等待你的内容";
  el("send-paused").hidden = !paused;
  canvas.style.visibility = paused ? "hidden" : "visible";
  el("send-state").textContent = preparing ? "准备中" : paused ? "已暂停" : sending ? "发送中" : selectedFile ? "已就绪" : "待就绪";
  el("send-state").dataset.active = String(sending && !paused);
  updateFilePicker();
}
function showError(message: string): void {
  generation++;
  preparing = false; sending = false; paused = false;
  setStageFullscreen(false);
  stage.hidden = true;
  showStreamPanels(false);
  updateControls();
  specsLine.showError(message);
}
function stopTransfer(): void {
  generation++;
  preparing = false; sending = false; paused = false;
  selectedFile = null;
  resizeDisplay = null;
  setStageFullscreen(false);
  stage.hidden = true;
  canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
  showStreamPanels(false);
  cfgFile.value = "";
  footerHint.textContent = "二维码仅在开始传输后显示";
  updateControls();
  setStatus("已清除传输。可以选择新的内容。");
}
function setStageFullscreen(on: boolean): void {
  document.body.classList.toggle("qr-full", on);
  expandBtn.textContent = on ? "退出放大 · Esc" : "放大预览 ⛶";
  resizeDisplay?.();
}
function applyMode(): void {
  stopTransfer();
  modePicker.hidden = DEMO;
  paneFile.hidden = DEMO || currentMode() !== "file";
  paneSnippet.hidden = DEMO || currentMode() !== "snippet";
  paneDemo.hidden = !DEMO;
  toolTitle.textContent = currentMode() === "snippet" ? "发送文本" : "发送文件";
  setStatus(currentMode() === "snippet" ? "输入文本后点击「准备文本」" : "选择文件或拖放到上方区域");
}
async function startSelection(status: string, prepare: () => Promise<{name: string; size: number; packed: PackedOpticalFile}>): Promise<void> {
  if (sending || preparing) return;
  const gen = ++generation;
  selectedFile = null; preparing = true;
  stage.hidden = true;
  showStreamPanels(false);
  updateControls();
  setStatus(status);
  try {
    const {name, size, packed} = await prepare();
    if (gen !== generation) return;
    selectedFile = {name, size, payload: packed.container, compression: packed.compression, transmittedSize: packed.transmittedSize};
    preparing = false;
    setStatus(`已准备 ${name} · ${formatBytes(size)}，点击「开始传输」。`);
    updateControls();
  } catch (error) {
    if (gen === generation) showError(error instanceof Error ? error.message : String(error));
  }
}
async function selectFile(file?: File): Promise<void> {
  file ??= cfgFile.files?.[0];
  if (!file) return;
  const chosen = file;
  cfgFile.value = "";
  await startSelection(`正在准备 ${chosen.name}…`, async () => {
    if (!chosen.size) throw new Error("文件为空，请选择有内容的文件。");
    if (chosen.size > MAX_FILE_BYTES) throw new Error(`文件超过 ${MAX_FILE_LABEL} 限制。`);
    const bytes = new Uint8Array(await chosen.arrayBuffer());
    return {name: chosen.name, size: chosen.size, packed: await packFile(chosen.name, chosen.type, bytes)};
  });
}
async function selectSnippet(): Promise<void> {
  await startSelection("正在准备文本…", async () => {
    const packed = await packSnippet(snippetText.value);
    return {name: "文本片段", size: packed.originalSize, packed};
  });
}
function scrollStageIntoView(): void {
  stage.scrollIntoView({behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center"});
}
cfgFile.addEventListener("change", () => void selectFile());
sendSnippetBtn.addEventListener("click", () => void selectSnippet());
snippetText.maxLength = MAX_SNIPPET_BYTES;
snippetLabel.textContent = `待发送文本 · 最大 ${MAX_SNIPPET_LABEL}`;
snippetText.addEventListener("input", () => {
  // Editing prepared text invalidates the old payload; never send stale text.
  if (selectedFile && !sending) { selectedFile = null; setStatus("文本已修改，请重新准备。"); }
  updateControls();
});
for (const input of modeInputs) input.addEventListener("change", applyMode);
startBtn.onclick = () => { if (selectedFile && !preparing && !sending) void startStream(true); };
pauseBtn.onclick = () => {
  if (!sending) return;
  paused = !paused;
  updateControls();
  setStatus(paused ? "已暂停，接收端的当前进度可保留。" : `正在发送 ${selectedFile!.name}，等待接收端确认完成。`);
};
stopBtn.onclick = stopTransfer;
expandBtn.onclick = () => setStageFullscreen(!document.body.classList.contains("qr-full"));
window.addEventListener("keydown", event => { if (event.key === "Escape") setStageFullscreen(false); });
window.addEventListener("resize", () => resizeDisplay?.());
cfgSize.addEventListener("input", () => resizeDisplay?.());
document.querySelector('.mode-nav a[href="../send/"]')?.setAttribute("aria-current", "page");
for (const type of ["dragenter", "dragover", "dragleave", "drop"]) {
  paneFile.addEventListener(type, event => {
    const drag = event as DragEvent;
    if (!Array.from(drag.dataTransfer?.types ?? []).includes("Files")) return;
    event.preventDefault();
    if (sending || preparing) { if (drag.dataTransfer) drag.dataTransfer.dropEffect = "none"; return; }
    if (type === "dragenter") fileDragDepth++;
    if (type === "dragleave") fileDragDepth = Math.max(0, fileDragDepth - 1);
    if (type === "drop") { fileDragDepth = 0; void selectFile(drag.dataTransfer?.files[0]); }
    paneFile.classList.toggle("is-dragover", type !== "drop" && (fileDragDepth > 0 || type === "dragover"));
  });
}
// Prevent accidental navigation when dropping a file outside the picker.
for (const type of ["dragover", "drop"]) window.addEventListener(type, event => event.preventDefault());
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-demo]")) button.onclick = () => {
  const name = button.dataset.demo!;
  void startSelection("正在准备演示…", async () => {
    const response = await fetch(`../${name}`);
    if (!response.ok) throw new Error("演示文件不可用。");
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {name, size: bytes.length, packed: await packFile(name, "image/png", bytes)};
  });
};
applyMode();
guardNavigation(() => sending || preparing);
void requestScreenWakeLock();

async function startStream(revealStage = false) {
  const gen = ++generation;
  paused = false;
  sending = true;
  updateControls();
  resizeDisplay = null;
  // Stale until this stream's first frame locks its version and refills them.
  showStreamPanels(false);
  if (!selectedFile) {
    sending = false;
    updateControls();
    setStatus("请先选择并准备内容。");
    return;
  }
  const { name, size: fileSize, payload, compression, transmittedSize } = selectedFile;
  if (gen !== generation) return; // superseded while fetching
  const txFps = Number(cfgFps.value);
  const frameBytes = Number(cfgBytes.value);
  const ecc = cfgEcc.value as "L" | "M" | "Q" | "H";

  const sessionId = (Math.floor(Math.random() * 0xffff) + 1) & 0xffff;
  const blockLen = blockLength(frameBytes);
  // Keep selectedFile on this path — raising bytes/frame back up is the fix,
  // and dropping the pick would hide that.
  if (!fitsInOneStream(payload.length, frameBytes)) {
    // Name a setting that is actually in the dropdown, not the bare minimum.
    const offered = [...cfgBytes.options].map((option) => Number(option.value));
    const suggestion =
      smallestSufficientFrameSize(payload.length, offered) ?? minimumFrameBytes(payload.length);
    showError(`数据超过当前帧设置的容量。请将每帧字节数提高到 ${suggestion} 或以上。`);
    return;
  }
  const encoder = new LTEncoder(payload, blockLen, sessionId);
  const header: FrameHeader = {
    sessionId,
    seq: 0,
    k: encoder.k,
    blockLen,
    totalLen: payload.length,
    payloadFnv: fnv1a(payload),
  };

  let version: number | undefined; // locked after the first frame
  let modules = 0;
  let scale = 1;
  const staging = document.createElement("canvas");
  const queue: ImageData[] = [];
  let nextSeq = 0;
  stage.hidden = false;

  const sizeCanvas = () => {
    const dpr = window.devicePixelRatio || 1;
    const total = modules + 2 * MARGIN;
    let cssBudget: number;
    if (document.body.classList.contains("qr-full")) {
      // Tap-to-fullscreen: the whole short viewport edge. The display-size
      // slider and page chrome are deliberately ignored — the point of the
      // mode is "as big as this device goes".
      cssBudget = Math.min(window.innerWidth - 40, window.innerHeight - 100);
    } else {
      const containerWidth =
        stage.parentElement?.getBoundingClientRect().width ?? window.innerWidth;
      const stageStyle = getComputedStyle(stage);
      const horizontalChrome =
        Number.parseFloat(stageStyle.paddingLeft) +
        Number.parseFloat(stageStyle.paddingRight) +
        Number.parseFloat(stageStyle.borderLeftWidth) +
        Number.parseFloat(stageStyle.borderRightWidth);
      cssBudget = Math.min(Math.max(240, window.innerHeight - 440), fitQrDisplaySize(
        window.innerWidth,
        window.innerHeight,
        containerWidth,
        Number(cfgSize.value),
        horizontalChrome,
      ));
    }
    scale = Math.max(1, Math.floor((cssBudget * dpr) / total));
    staging.width = total;
    staging.height = total;
    canvas.width = total * scale;
    canvas.height = total * scale;
    canvas.style.width = `${(total * scale) / dpr}px`;
    canvas.style.height = `${(total * scale) / dpr}px`;
  };

  const makeFrame = (): ImageData => {
    const bytes = packFrame({ ...header, seq: nextSeq }, encoder.encode(nextSeq));
    nextSeq++;
    const qr = QRCode.create([{ data: bytes, mode: "byte" } as unknown as QRCode.QRCodeSegment], {
      errorCorrectionLevel: ecc,
      version,
      maskPattern: 4,
    });
    if (version === undefined) {
      version = qr.version;
      modules = qr.modules.size;
      sizeCanvas();
      resizeDisplay = sizeCanvas;
      // Scroll only now: before sizeCanvas() the canvas is still 16×16, so the
      // scroll target would be the wrong height.
      if (revealStage && window.innerWidth < 741) scrollStageIntoView();
      // The stream's parameters live at the bottom of Transfer settings, next
      // to the knobs that produced them; the status line stays for prose.
      spec("spec-fps").textContent = `${txFps} fps`;
      spec("spec-frame").textContent = `${frameBytes} bytes`;
      spec("spec-qr").textContent = `V${version} · ECC ${ecc}`;
      spec("spec-payload").textContent = `${name} · ${formatBytes(fileSize)}`;
      spec("spec-compression").textContent =
        compression === "gzip" ? `gzip → ${formatBytes(transmittedSize)}` : "无需压缩";
      spec("spec-k").textContent = `K = ${encoder.k}`;
      showStreamPanels(true);
      setStatus(`正在发送 ${name}。接收端完成后，请手动终止传输。`);
      footerHint.textContent = "保持二维码可见，等待接收端确认完成";
    }
    const raster = rasterizeQr(qr.modules.size, qr.modules.data, MARGIN);
    return new ImageData(new Uint8ClampedArray(raster.pixels.buffer), raster.size, raster.size);
  };

  /**
   * Refill the lookahead, generating at most `max` frames per call.
   *
   * Called once up front to fill the queue, then once per tick() — the only
   * thing that drains it. Self-scheduling on `setTimeout(pump, 0)` instead cost
   * ~250 wake-ups a second doing nothing once the queue was full. Capping at
   * one frame per tick keeps the amortisation that gave us: a rAF callback
   * never pays for more than the single frame it just consumed.
   */
  let generatorFailed = false;
  const pump = (max = LOOKAHEAD) => {
    if (generatorFailed || gen !== generation) return;
    try {
      for (let n = 0; n < max && queue.length < LOOKAHEAD; n++) queue.push(makeFrame());
    } catch (err) {
      // e.g. frame bytes over capacity for the chosen ECC level
      generatorFailed = true;
      showError(err instanceof Error ? err.message : String(err));
    }
  };
  pump();

  const interval = 1000 / txFps;
  let nextAt = performance.now();
  const tick = (now: number) => {
    // generatorFailed means no frame will ever be produced again, so stop the
    // rAF loop rather than spinning on an empty queue until a settings change.
    if (gen !== generation || generatorFailed) return;
    requestAnimationFrame(tick);
    if (paused) { nextAt = now; return; }
    if (now < nextAt) return;
    const img = queue.shift();
    pump(1);
    if (!img) {
      nextAt = now + interval;
      return;
    }
    staging.getContext("2d")!.putImageData(img, 0, 0);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(staging, 0, 0, canvas.width, canvas.height);
    nextAt += interval;
    if (now - nextAt > 3 * interval) nextAt = now + interval; // fell behind — don't burst
  };
  requestAnimationFrame(tick);
}
