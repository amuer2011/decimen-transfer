const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const semver = require("semver");
const { RELEASES, variant, selectUpdate, validateNsisInfo } = require("./update-policy.cjs");

// Only the public release host and GitHub's asset redirect hosts are allowed.
function trustedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || ![
    "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com", "github-releases.githubusercontent.com",
  ].includes(url.hostname)) throw new Error("更新下载地址无效。");
  return url;
}

function requestResponse(net, url) {
  trustedUrl(url);
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: "follow" });
    const timeout = setTimeout(() => { request.abort(); reject(new Error("连接更新服务器超时，请检查网络后重试。")); }, 30000);
    request.on("redirect", (_status, _method, location) => {
      try { trustedUrl(location); } catch (error) { request.abort(); reject(error); }
    });
    request.on("error", error => { clearTimeout(timeout); reject(error); });
    request.on("response", response => {
      clearTimeout(timeout);
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(response.statusCode === 404 ? "更新清单或安装包尚未发布，请稍后重试。" : `更新服务器返回 ${response.statusCode}，请稍后重试。`));
      } else resolve(response);
    });
    request.setHeader("User-Agent", "Decimen-Update");
    request.setHeader("Cache-Control", "no-cache");
    request.end();
  });
}

async function readCatalog(net) {
  const response = await requestResponse(net, `${RELEASES}/latest/download/updates.json`);
  const timeout = setTimeout(() => response.destroy(new Error("读取更新清单超时，请重试。")), 30000);
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of response) {
      size += chunk.length;
      if (size > 256 * 1024) { response.destroy(); throw new Error("更新清单过大。"); }
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { clearTimeout(timeout); }
}

async function downloadManual(net, app, update, onProgress) {
  const directory = path.join(app.getPath("userData"), "updates", update.version);
  await fs.promises.mkdir(directory, { recursive: true });
  const destination = path.join(directory, update.file.name);
  const temporary = `${destination}.${randomUUID()}.part`;
  const hash = createHash("sha512");
  let received = 0;
  let lastProgress = -1;
  const timeout = setTimeout(() => response?.destroy(new Error("下载超时，请重试。")), 30 * 60 * 1000);
  let response;
  try {
    response = await requestResponse(net, update.baseUrl + encodeURIComponent(update.file.name));
    await pipeline(response, new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > update.file.size) { callback(new Error("更新包大小不匹配。")); return; }
        hash.update(chunk);
        const progress = Math.floor(received / update.file.size * 100);
        if (progress !== lastProgress) { lastProgress = progress; onProgress(progress); }
        callback(null, chunk);
      },
    }), fs.createWriteStream(temporary, { flags: "wx" }));
    if (received !== update.file.size || hash.digest("base64") !== update.file.sha512) throw new Error("更新包校验失败，请重新下载。");
    await fs.promises.rm(destination, { force: true });
    await fs.promises.rename(temporary, destination);
    return destination;
  } finally {
    clearTimeout(timeout);
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
  }
}

class UpdateController {
  constructor({ version, target, portable, packaged, read, manualDownload, createUpdater, canRestart, openPackage, notify }) {
    Object.assign(this, { read, manualDownload, createUpdater, canRestart, openPackage, notify });
    this.target = target;
    this.portable = portable;
    this.packaged = packaged;
    this.automatic = target.platform === "win32" && !portable;
    this.status = { phase: "idle", version, edition: target.edition, channel: target.channel, mode: this.automatic ? "automatic" : "manual", message: "点击检查更新时需要联网。" };
  }
  set(patch) { Object.assign(this.status, patch); this.notify?.({ ...this.status }); return this.getStatus(); }
  getStatus() { return { ...this.status }; }
  async check() {
    if (["checking", "downloading", "downloaded"].includes(this.status.phase)) return this.getStatus();
    this.update = null;
    this.updater = null;
    this.set({ phase: "checking", message: "正在检查新版本…", latestVersion: undefined, notes: undefined, progress: undefined });
    try {
      if (!this.packaged) throw new Error("开发模式不提供软件更新，请使用打包后的版本。");
      const candidate = selectUpdate(await this.read(), this.target, this.portable);
      if (!semver.gt(candidate.version, this.status.version)) return this.set({ phase: "current", message: "已是最新版本。" });
      if (this.automatic) {
        this.updater = this.createUpdater(candidate.baseUrl, this.target.channel);
        const checked = await this.updater.checkForUpdates();
        validateNsisInfo(checked?.updateInfo, candidate);
      }
      this.update = candidate;
      return this.set({ phase: "available", latestVersion: candidate.version, notes: candidate.notes, message: this.automatic ? "发现新版本，可以下载更新。" : "发现新版本，下载后需手动完成安装或替换。" });
    } catch (error) { return this.set({ phase: "error", message: `检查更新失败：${error.message}` }); }
  }
  async download() {
    if (this.status.phase !== "available" || !this.update) return this.getStatus();
    this.set({ phase: "downloading", progress: 0, message: "正在下载并校验更新包…" });
    try {
      if (this.automatic) {
        await this.updater.downloadUpdate();
      } else {
        this.downloadedPath = await this.manualDownload(this.update, progress => this.set({ progress }));
      }
      return this.set({ phase: "downloaded", progress: 100, message: this.automatic ? "更新已下载并校验，可重启安装。" : "更新已下载并校验。打开更新包后，请手动完成安装或替换。" });
    } catch (error) { return this.set({ phase: "available", message: `下载失败：${error.message}，可以重试。`, progress: undefined }); }
  }
  async install() {
    if (this.status.phase !== "downloaded" || this.installing) return this.getStatus();
    this.installing = true;
    try {
      if (this.automatic) {
        if (!(await this.canRestart())) return this.set({ message: "请先结束传输，并复制或保存接收结果，再安装更新。" });
        this.updater.quitAndInstall(false, true);
      } else await this.openPackage(this.downloadedPath, this.portable);
      return this.getStatus();
    } catch (error) { return this.set({ message: `打开更新失败：${error.message}，可以重试。` }); }
    finally { this.installing = false; }
  }
}

function configureUpdates({ app, ipcMain, net, shell, getWindow }) {
  let requestId = 0;
  const target = variant(app.getName());
  const portable = process.platform === "win32" && !!process.env.PORTABLE_EXECUTABLE_FILE;
  const notify = status => getWindow()?.webContents.send("updates:status", status);
  const controller = new UpdateController({
    version: app.getVersion(), target, portable, packaged: app.isPackaged,
    read: () => readCatalog(net),
    manualDownload: (update, progress) => downloadManual(net, app, update, progress),
    createUpdater: (url, channel) => {
      const { NsisUpdater } = require("electron-updater");
      const updater = new NsisUpdater({ provider: "generic", url, channel });
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.allowDowngrade = false;
      updater.allowPrerelease = false;
      updater.disableWebInstaller = true;
      updater.on("error", error => console.error("Update failed:", error.message));
      updater.on("download-progress", info => controller.set({ progress: Math.max(0, Math.min(100, info.percent)) }));
      return updater;
    },
    canRestart: () => new Promise(resolve => {
      const window = getWindow();
      if (!window || window.isDestroyed()) { resolve(false); return; }
      const id = ++requestId;
      const finish = safe => { clearTimeout(timer); ipcMain.removeListener("updates:activity", listener); resolve(safe); };
      const listener = (event, reply) => {
        if (event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && reply?.id === id) finish(reply.busy === false);
      };
      const timer = setTimeout(() => finish(false), 5000);
      ipcMain.on("updates:activity", listener);
      window.webContents.send("updates:activity-request", id);
    }),
    openPackage: async (file, isPortable) => {
      // Opening a portable EXE while the old instance runs would only focus the
      // old process. Reveal the verified replacement so the user can swap it.
      if (isPortable) { shell.showItemInFolder(file); return; }
      const error = await shell.openPath(file);
      if (error) throw new Error(error);
    },
    notify,
  });
  for (const [channel, action] of [["status", "getStatus"], ["check", "check"], ["download", "download"], ["install", "install"]]) {
    ipcMain.handle(`updates:${channel}`, (event) => {
      const window = getWindow();
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("Invalid update request");
      return controller[action]();
    });
  }
  return controller;
}

module.exports = { UpdateController, configureUpdates, trustedUrl, downloadManual, readCatalog };
