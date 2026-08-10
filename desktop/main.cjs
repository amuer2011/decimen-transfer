const {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  session,
  shell,
  systemPreferences,
} = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const { shouldProtectWindow } = require("./content-protection.cjs");

const PRODUCT_NAME = "Decimen Optical Transfer";
const DIST_ROOT = path.join(app.getAppPath(), "dist");
const MAC_SCREEN_CAPTURE_SETTINGS =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
let server;
let baseUrl;
let sourcePickerWindow;
let sourcePickerState;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function nativeImageDataUrl(image) {
  return image && !image.isEmpty() ? image.toDataURL() : null;
}

function pickerSourceData(source) {
  return {
    id: source.id,
    name: source.name,
    kind: source.id.startsWith("screen:") ? "Display" : "Window",
    thumbnail: nativeImageDataUrl(source.thumbnail),
    appIcon: nativeImageDataUrl(source.appIcon),
  };
}

function isOwnWindowSource(source) {
  return source.id.startsWith("window:") && source.name.startsWith(PRODUCT_NAME);
}

function closeSourcePicker(source) {
  const state = sourcePickerState;
  if (!state) return;
  sourcePickerState = undefined;
  const picker = sourcePickerWindow;
  sourcePickerWindow = undefined;
  if (picker && !picker.isDestroyed()) picker.close();
  state.resolve(source ?? null);
}

function showSourcePicker(parentWindow, sources) {
  return new Promise((resolve) => {
    const picker = new BrowserWindow({
      width: 960,
      height: 640,
      minWidth: 720,
      minHeight: 500,
      title: "Capture screen",
      backgroundColor: "#070a11",
      parent: parentWindow && !parentWindow.isDestroyed() ? parentWindow : undefined,
      modal: Boolean(parentWindow && !parentWindow.isDestroyed()),
      resizable: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "picker-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    sourcePickerWindow = picker;
    sourcePickerState = {
      resolve,
      sources: new Map(sources.map((source) => [source.id, source])),
      items: sources.map(pickerSourceData),
    };
    picker.once("ready-to-show", () => picker.show());
    picker.on("closed", () => {
      if (sourcePickerWindow === picker) sourcePickerWindow = undefined;
      if (sourcePickerState) {
        const state = sourcePickerState;
        sourcePickerState = undefined;
        state.resolve(null);
      }
    });
    picker.loadFile(path.join(__dirname, "picker.html")).catch((error) => {
      console.error("Screen source picker failed to load:", error);
      closeSourcePicker(null);
    });
  });
}

function isSourcePickerSender(event) {
  return Boolean(
    sourcePickerWindow &&
      !sourcePickerWindow.isDestroyed() &&
      event.sender === sourcePickerWindow.webContents,
  );
}

function appBundlePath() {
  if (process.platform !== "darwin") return process.execPath;
  return path.resolve(process.execPath, "..", "..", "..");
}

async function showScreenPermissionHelp(parentWindow, message) {
  if (process.platform !== "darwin") {
    const options = {
      type: "warning",
      title: "Screen capture unavailable",
      message,
      detail: "Check the operating system screen-capture permission, then try again.",
      buttons: ["OK"],
    };
    if (parentWindow) await dialog.showMessageBox(parentWindow, options);
    else await dialog.showMessageBox(options);
    return false;
  }

  const status = systemPreferences.getMediaAccessStatus("screen");
  const options = {
    type: "warning",
    title: "Allow screen recording for Decimen",
    message,
    detail:
      `macOS status: ${status}.\n\n` +
      "Open Screen Recording settings, click + if Decimen is not listed, and add the currently opened app. " +
      "Enable it, quit Decimen completely, then reopen it.\n\n" +
      `Current app: ${appBundlePath()}`,
    buttons: ["Open Settings", "Retry", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  };
  const result = parentWindow
    ? await dialog.showMessageBox(parentWindow, options)
    : await dialog.showMessageBox(options);
  if (result.response === 0) {
    await shell.openExternal(MAC_SCREEN_CAPTURE_SETTINGS).catch((error) => {
      console.error("Could not open macOS screen recording settings:", error);
    });
    return false;
  }
  return result.response === 1;
}

ipcMain.on("picker:ready", (event) => {
  if (!isSourcePickerSender(event) || !sourcePickerState) return;
  event.sender.send("picker:sources", sourcePickerState.items);
});

ipcMain.handle("picker:confirm", (event, sourceId) => {
  if (!isSourcePickerSender(event) || typeof sourceId !== "string" || !sourcePickerState) return false;
  const source = sourcePickerState.sources.get(sourceId);
  if (!source) return false;
  setImmediate(() => closeSourcePicker(source));
  return true;
});

ipcMain.handle("picker:cancel", (event) => {
  if (!isSourcePickerSender(event)) return false;
  setImmediate(() => closeSourcePicker(null));
  return true;
});

async function chooseDisplaySource(parentWindow) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let sources;
    try {
      sources = await desktopCapturer.getSources({
        types: ["window", "screen"],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: false,
      });
    } catch (error) {
      console.error("Could not enumerate screen sources:", error);
      const retry = await showScreenPermissionHelp(
        parentWindow,
        "Decimen could not list your displays and windows.",
      );
      if (retry) continue;
      return null;
    }
    const available = sources.filter(
      (source) => source.name.trim() && !isOwnWindowSource(source),
    );
    if (available.length === 0) {
      const retry = await showScreenPermissionHelp(
        parentWindow,
        "No display or window is available for capture.",
      );
      if (retry) continue;
      return null;
    }

    return showSourcePicker(parentWindow, available);
  }
  return null;
}

function configureDisplayCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (!request.videoRequested) {
        callback({});
        return;
      }
      try {
        const parentWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        const source = await chooseDisplaySource(parentWindow);
        callback(source ? { video: source } : {});
      } catch (error) {
        console.error("Screen capture source selection failed:", error);
        callback({});
      }
    },
    // Use the custom picker on every desktop platform so its compact layout,
    // preview step, and own-window filtering behave consistently. The native
    // macOS picker has its own layout and cannot be styled by picker.css.
    { useSystemPicker: false },
  );
}

function configureDownloads() {
  // Keep the browser-style Save action in the host user's normal Downloads
  // folder rather than Electron's private application data directory.
  session.defaultSession.setDownloadPath(app.getPath("downloads"));
}

function requestedFile(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://127.0.0.1").pathname);
  const relative = path.normalize(`.${pathname}`);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    return null;
  }
  const candidate = path.join(DIST_ROOT, relative);
  if (pathname.endsWith("/")) return path.join(candidate, "index.html");
  return candidate;
}

function startLocalServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((request, response) => {
      let filePath;
      try {
        filePath = requestedFile(request.url || "/");
      } catch {
        response.writeHead(400).end("Bad request");
        return;
      }
      if (!filePath) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      fs.stat(filePath, (error, stat) => {
        if (error || !stat.isFile()) {
          response.writeHead(404).end("Not found");
          return;
        }
        response.setHeader(
          "Content-Type",
          MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        );
        response.setHeader("Cache-Control", "no-store");
        fs.createReadStream(filePath).pipe(response);
      });
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("The desktop local server did not expose a port."));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function initialPath(args = process.argv) {
  if (args.includes("--send")) return "/send/";
  if (args.includes("--receive")) return "/receive/";
  return "/";
}

async function createWindow() {
  baseUrl = await startLocalServer();
  const window = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 420,
    minHeight: 560,
    title: PRODUCT_NAME,
    backgroundColor: "#070a11",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // A whole-display source is still the full display, but the OS will omit
  // this protected window from the captured pixels instead of feeding the
  // receiver UI back into its own QR decoder.
  // Older Windows builds can render a protected Electron window as black.
  if (shouldProtectWindow(process.platform, process.getSystemVersion())) {
    window.setContentProtection(true);
  }
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  await window.loadURL(`${baseUrl}${initialPath()}`);
}

const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    const requestedPath = initialPath(commandLine);
    if (baseUrl && requestedPath !== "/") void window.loadURL(`${baseUrl}${requestedPath}`);
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(() => {
    configureDownloads();
    configureDisplayCapture();
    return createWindow();
  }).catch((error) => {
    console.error(error);
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });

  app.on("before-quit", () => {
    closeSourcePicker(null);
    server?.close();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
