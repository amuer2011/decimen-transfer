import "./about.css";
import { confirmAction } from "./confirm";
import { closeOnBackdropClick } from "./dialog";

declare global {
  interface UpdateStatus {
    phase:
      | "idle"
      | "checking"
      | "available"
      | "current"
      | "downloading"
      | "downloaded"
      | "error";
    version: string;
    edition: "full" | "text";
    channel: string;
    mode: "automatic" | "manual";
    latestVersion?: string;
    notes?: string;
    progress?: number;
    message: string;
  }

  interface Window {
    decimenUpdates?: {
      getStatus(): Promise<UpdateStatus>;
      check(): Promise<UpdateStatus>;
      download(): Promise<UpdateStatus>;
      install(): Promise<UpdateStatus>;
      onStatus(callback: (status: UpdateStatus) => void): () => void;
      onAbout(callback: () => void): () => void;
      setActivityGuard(guard: () => boolean): void;
    };
  }
}

type DecimenUpdates = NonNullable<Window["decimenUpdates"]>;
type Phase = UpdateStatus["phase"];
type Action = "check" | "download" | "install";

const PHASES: readonly Phase[] = [
  "idle",
  "checking",
  "available",
  "current",
  "downloading",
  "downloaded",
  "error",
];

const ACTION_FAILURE: Record<Exclude<Action, "install">, string> = {
  check: "检查更新失败，请检查网络后重试。",
  download: "下载更新失败，请检查网络后重试。",
};

function isPhase(value: unknown): value is Phase {
  return typeof value === "string" && (PHASES as readonly string[]).includes(value);
}

function clampProgress(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function normalizeStatus(status: UpdateStatus): UpdateStatus {
  return {
    phase: isPhase(status.phase) ? status.phase : "error",
    version: typeof status.version === "string" ? status.version : "",
    edition: status.edition === "text" ? "text" : "full",
    channel: typeof status.channel === "string" ? status.channel : "",
    mode: status.mode === "manual" ? "manual" : "automatic",
    latestVersion:
      typeof status.latestVersion === "string" && status.latestVersion.trim() !== ""
        ? status.latestVersion
        : undefined,
    notes:
      typeof status.notes === "string" && status.notes.trim() !== ""
        ? status.notes
        : undefined,
    progress:
      typeof status.progress === "number" && Number.isFinite(status.progress)
        ? clampProgress(status.progress)
        : undefined,
    message: typeof status.message === "string" ? status.message : "",
  };
}

function versionText(version: string | undefined): string {
  const value = version?.trim() ?? "";
  if (!value) return "—";
  return /^v/i.test(value) ? value : `v${value}`;
}

function fallbackMessage(status: UpdateStatus): string {
  switch (status.phase) {
    case "idle":
      return "尚未检查更新。";
    case "checking":
      return "正在检查更新…";
    case "available":
      return status.latestVersion
        ? `发现新版本 ${versionText(status.latestVersion)}。`
        : "发现新版本，可以下载。";
    case "current":
      return "当前已是最新版本。";
    case "downloading":
      return "正在下载更新…";
    case "downloaded":
      return status.mode === "manual"
        ? "更新包已准备好，可以手动安装。"
        : "更新已下载，可以重启安装。";
    case "error":
      return "更新时出现问题，请稍后重试。";
  }
  return "尚未检查更新。";
}

function phaseRank(phase: Phase): number {
  switch (phase) {
    case "idle":
    case "error":
      return 0;
    case "checking":
    case "current":
      return 1;
    case "available":
      return 2;
    case "downloading":
      return 3;
    case "downloaded":
      return 4;
  }
  return 0;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function span(className?: string, text?: string): HTMLSpanElement {
  const node = element("span", className);
  if (text !== undefined) node.textContent = text;
  return node;
}

function init(api: DecimenUpdates): void {
  let latest: UpdateStatus | null = null;
  let pending: Action | null = null;
  let actionBase: UpdateStatus | null = null;
  let failure = "";
  let reading = true;
  let sawStatus = false;
  let userChecked = false;
  let revision = 0;

  const dialog = element("dialog", "about-dialog");
  dialog.setAttribute("aria-labelledby", "about-title");

  const head = element("div", "about-head");
  const eyebrow = element("p", "about-eyebrow");
  eyebrow.textContent = "关于与更新";
  const closeIcon = element("button", "about-icon-button");
  closeIcon.type = "button";
  closeIcon.setAttribute("aria-label", "关闭关于窗口");
  closeIcon.textContent = "×";
  head.append(eyebrow, closeIcon);

  const body = element("div", "about-body");
  const title = element("h2", "about-title");
  title.id = "about-title";
  title.tabIndex = -1;
  const product = span("about-product-name", "Decimen");
  const slash = span("about-slash", " / ");
  slash.setAttribute("aria-hidden", "true");
  const edition = span();
  title.append(product, slash, edition);

  const meta = element("dl", "about-meta");
  const currentRow = element("div", "about-meta-row");
  const currentLabel = element("dt");
  currentLabel.textContent = "当前版本";
  const currentVersion = element("dd");
  currentRow.append(currentLabel, currentVersion);
  const latestRow = element("div", "about-meta-row");
  latestRow.hidden = true;
  const latestLabel = element("dt");
  latestLabel.textContent = "新版本";
  const latestVersion = element("dd");
  latestRow.append(latestLabel, latestVersion);
  meta.append(currentRow, latestRow);

  const statusLine = element("p", "about-status");
  statusLine.setAttribute("role", "status");
  statusLine.setAttribute("aria-live", "polite");

  const errorLine = element("p", "about-error");
  errorLine.setAttribute("role", "alert");
  errorLine.hidden = true;

  const progress = element("div", "about-progress");
  progress.hidden = true;
  const progressHead = element("div", "about-progress-head");
  const progressTitle = span(undefined, "下载进度");
  const progressValue = span(undefined, "0%");
  progressHead.append(progressTitle, progressValue);
  const progressTrack = element("div", "about-progress-track");
  progressTrack.setAttribute("role", "progressbar");
  progressTrack.setAttribute("aria-label", "更新下载进度");
  progressTrack.setAttribute("aria-valuemin", "0");
  progressTrack.setAttribute("aria-valuemax", "100");
  progressTrack.setAttribute("aria-valuenow", "0");
  const progressFill = element("div", "about-progress-fill");
  progressTrack.append(progressFill);
  progress.append(progressHead, progressTrack);

  const notes = element("section", "about-notes");
  notes.hidden = true;
  const notesTitle = element("h3");
  notesTitle.textContent = "发布说明";
  const notesText = element("p", "about-notes-text");
  notes.append(notesTitle, notesText);

  const hint = element("p", "about-hint");
  hint.textContent = "检查更新时需要联网。";

  body.append(title, meta, statusLine, errorLine, progress, notes, hint);

  const actions = element("div", "about-actions");
  const dismiss = element("button", "secondary-button about-dismiss");
  dismiss.type = "button";
  dismiss.textContent = "关闭";
  const primary = element("button", "about-primary");
  primary.type = "button";
  primary.textContent = "检查更新";
  actions.append(dismiss, primary);

  dialog.append(head, body, actions);
  document.body.append(dialog);
  closeOnBackdropClick(dialog);

  let headerButton: HTMLButtonElement | null = null;
  let updateDot: HTMLSpanElement | null = null;
  const header = document.querySelector<HTMLElement>(".site-header");
  if (header) {
    const button = element("button", "about-header-button");
    button.type = "button";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-label", "关于");
    button.title = "关于与更新";
    const mark = span("about-button-mark", "i");
    mark.setAttribute("aria-hidden", "true");
    const label = span("about-button-label", "关于");
    updateDot = span("about-update-dot");
    updateDot.setAttribute("aria-hidden", "true");
    updateDot.hidden = true;
    button.append(mark, label, updateDot);
    button.addEventListener("click", openDialog);
    const themeSwitch = header.querySelector(".theme-switch");
    if (themeSwitch) themeSwitch.before(button);
    else header.append(button);
    header.classList.add("about-enabled");
    headerButton = button;
  }

  const footer = document.querySelector<HTMLElement>(".site-footer");
  if (footer) {
    const version = footer.firstElementChild;
    if (version instanceof HTMLSpanElement) {
      const button = element("button", "about-footer-button");
      button.type = "button";
      button.setAttribute("aria-haspopup", "dialog");
      button.title = "查看关于与更新";
      const label = version.textContent?.replace(/\s+/g, " ").trim() || "版本信息";
      button.setAttribute("aria-label", `${label}，查看关于与更新`);
      button.append(...version.childNodes);
      version.replaceWith(button);
      button.addEventListener("click", openDialog);
    }
  }

  function openDialog(): void {
    if (!dialog.isConnected) document.body.append(dialog);
    if (!dialog.open) dialog.showModal();
    render();
    title.focus();
  }

  function applyStatus(status: UpdateStatus): void {
    latest = normalizeStatus(status);
    reading = false;
    sawStatus = true;
    failure = "";
    render();
  }

  function render(): void {
    const status = latest;
    const phase: Phase =
      pending === "check"
        ? "checking"
        : pending === "download"
          ? "downloading"
          : status?.phase ?? "idle";
    const percent =
      phase === "downloaded" ? 100 : clampProgress(status?.progress);

    edition.textContent = status
      ? status.edition === "text"
        ? "文本专用版"
        : "完整版"
      : "—";
    currentVersion.textContent = versionText(status?.version);

    const availableVersion = status?.latestVersion?.trim() ?? "";
    const showLatest =
      status !== null &&
      availableVersion !== "" &&
      availableVersion !== status.version &&
      (phase === "available" ||
        phase === "downloading" ||
        phase === "downloaded");
    latestRow.hidden = !showLatest;
    latestVersion.textContent = showLatest ? versionText(availableVersion) : "";

    let message: string;
    if (pending === "check") message = "正在检查更新…";
    else if (pending === "download") message = "正在下载更新…";
    else if (pending === "install") message = "正在准备安装更新…";
    else if (reading && !status) message = "正在读取版本信息…";
    else if (status) {
      message = status.message.trim() || fallbackMessage(status);
    } else {
      message = failure ? "暂时无法读取更新状态。" : "尚未检查更新。";
    }
    statusLine.textContent = message;
    statusLine.classList.toggle(
      "is-error",
      pending === null && status?.phase === "error",
    );

    errorLine.hidden = failure === "";
    errorLine.textContent = failure;

    const showProgress =
      pending === "download" ||
      phase === "downloading" ||
      phase === "downloaded";
    progress.hidden = !showProgress;
    if (showProgress) {
      progressValue.textContent = `${percent}%`;
      progressFill.style.width = `${percent}%`;
      progressTrack.setAttribute("aria-valuenow", String(percent));
      progressTrack.setAttribute(
        "aria-valuetext",
        phase === "downloaded" ? "下载完成" : `已下载 ${percent}%`,
      );
    }

    const note = status?.notes ?? "";
    notes.hidden = note.trim() === "";
    notesText.textContent = notes.hidden ? "" : note;

    const badge =
      userChecked &&
      status !== null &&
      (status.phase === "available" ||
        status.phase === "downloading" ||
        status.phase === "downloaded");
    if (updateDot) updateDot.hidden = !badge;
    if (headerButton) {
      headerButton.setAttribute(
        "aria-label",
        badge ? "关于（有新版本）" : "关于",
      );
      headerButton.title = badge ? "关于与更新 · 有新版本" : "关于与更新";
    }

    const busy =
      pending !== null ||
      phase === "checking" ||
      phase === "downloading";
    primary.disabled = busy;
    dialog.setAttribute("aria-busy", String(pending !== null));
    if (pending === "check") primary.textContent = "正在检查…";
    else if (pending === "download") {
      primary.textContent = percent > 0 ? `正在下载 ${percent}%` : "正在下载…";
    } else if (pending === "install") primary.textContent = "正在准备安装…";
    else if (phase === "checking") primary.textContent = "正在检查…";
    else if (phase === "downloading") {
      primary.textContent = percent > 0 ? `正在下载 ${percent}%` : "正在下载…";
    } else if (phase === "available") primary.textContent = "下载更新";
    else if (phase === "downloaded") {
      primary.textContent =
        status?.mode === "manual" ? "打开更新包" : "重启并安装";
    } else primary.textContent = "检查更新";
  }

  async function runAction(kind: "check" | "download"): Promise<void> {
    if (pending !== null) return;
    actionBase = latest;
    failure = "";
    if (kind === "check") userChecked = true;
    pending = kind;
    render();
    const startedAt = revision;
    try {
      const status = normalizeStatus(
        kind === "check" ? await api.check() : await api.download(),
      );
      pending = null;
      if (
        status.phase !== "error" &&
        revision !== startedAt &&
        latest !== null &&
        phaseRank(status.phase) < phaseRank(latest.phase)
      ) {
        render();
        return;
      }
      applyStatus(status);
    } catch {
      pending = null;
      const stuck =
        latest === null ||
        latest.phase === "checking" ||
        latest.phase === "downloading";
      if (revision === startedAt || stuck) latest = actionBase;
      failure = ACTION_FAILURE[kind];
      render();
    }
  }

  async function runInstall(): Promise<void> {
    if (pending !== null) return;
    const target = latest;
    if (!target || target.phase !== "downloaded") return;
    if (target.mode === "automatic") {
      const confirmed = await confirmAction(
        "重启并安装更新？",
        "更新将关闭并重启 Decimen。请先结束传输，并复制或保存接收结果。",
        "重启并安装",
      );
      if (!confirmed) return;
      if (latest?.phase !== "downloaded") return;
    }
    actionBase = latest;
    failure = "";
    pending = "install";
    render();
    const startedAt = revision;
    try {
      const status = await api.install();
      pending = null;
      applyStatus(status);
    } catch {
      pending = null;
      if (revision === startedAt) latest = actionBase;
      failure = "安装未能开始，请稍后重试。";
      render();
    }
  }

  primary.addEventListener("click", () => {
    if (pending !== null) return;
    if (latest?.phase === "available") {
      void runAction("download");
      return;
    }
    if (latest?.phase === "downloaded") {
      void runInstall();
      return;
    }
    void runAction("check");
  });

  closeIcon.addEventListener("click", () => {
    if (dialog.open) dialog.close();
  });
  dismiss.addEventListener("click", () => {
    if (dialog.open) dialog.close();
  });

  function handleStatus(status: UpdateStatus): void {
    revision += 1;
    if (
      pending === "check" &&
      (status.phase === "available" ||
        status.phase === "current" ||
        status.phase === "error")
    ) {
      pending = null;
    } else if (
      pending === "download" &&
      (status.phase === "downloaded" ||
        status.phase === "current" ||
        status.phase === "error")
    ) {
      pending = null;
    } else if (pending === "install" && status.phase !== "downloaded") {
      pending = null;
    }
    applyStatus(status);
  }

  async function readInitialStatus(): Promise<void> {
    try {
      const status = await api.getStatus();
      if (!sawStatus) applyStatus(status);
      else {
        reading = false;
        render();
      }
    } catch {
      reading = false;
      if (!sawStatus) {
        failure = "暂时无法读取更新状态，请稍后重试。";
        render();
      }
    }
  }

  void api.onStatus(handleStatus);
  void api.onAbout(openDialog);
  render();
  void readInitialStatus();
}

const api = window.decimenUpdates;
if (api) {
  if (document.body) init(api);
  else document.addEventListener("DOMContentLoaded", () => init(api), { once: true });
}
