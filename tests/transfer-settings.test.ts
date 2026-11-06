import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
const require = createRequire(import.meta.url);
const { createSettingsStore, configureTransferSettings } = require("../desktop/settings.cjs");

test("desktop tuning survives a new store instance and keeps send/receive settings independent", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "decimen-settings-"));
  try {
    const filename = path.join(directory, "transfer-settings.json");
    const store = createSettingsStore(filename);
    assert.equal(store.set("send", { fps: "30", frameBytes: "1000", ecc: "M", displaySize: "1000", text: "private", filename: "secret.txt" }), true);
    assert.equal(createSettingsStore(filename).set("receive", { width: "1920", capFps: "60", workers: "8" }), true);
    const reopened = createSettingsStore(filename);
    assert.deepEqual(reopened.get("send"), { fps: "30", frameBytes: "1000", ecc: "M", displaySize: "1000" });
    assert.deepEqual(reopened.get("receive"), { width: "1920", capFps: "60", workers: "8" });
    assert.equal(readFileSync(filename, "utf8").includes("private"), false);
    assert.equal(store.set("__proto__", { workers: "1" }), false);
    writeFileSync(filename, "broken JSON");
    assert.deepEqual(reopened.get("receive"), {});
    assert.equal(reopened.set("receive", { workers: "2" }), true);
    assert.deepEqual(createSettingsStore(filename).get("receive"), { workers: "2" });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("settings IPC rejects other windows and child frames", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "decimen-settings-ipc-"));
  try {
    const handlers = new Map<string, Function>();
    const mainFrame = {};
    const webContents = { mainFrame };
    configureTransferSettings({ app: { getPath: () => directory }, ipcMain: { on: (name: string, handler: Function) => handlers.set(name, handler) }, getWindow: () => ({ webContents }) });
    const allowed = { sender: webContents, senderFrame: mainFrame, returnValue: undefined as unknown };
    handlers.get("settings:set")!(allowed, "receive", { workers: "8" });
    assert.equal(allowed.returnValue, true);
    for (const event of [{ sender: {}, senderFrame: mainFrame, returnValue: undefined as unknown }, { sender: webContents, senderFrame: {}, returnValue: undefined as unknown }]) {
      handlers.get("settings:set")!(event, "receive", { workers: "32" });
      assert.equal(event.returnValue, false);
      handlers.get("settings:get")!(event, "receive");
      assert.deepEqual(event.returnValue, {});
    }
    handlers.get("settings:get")!(allowed, "receive");
    assert.deepEqual(allowed.returnValue, { workers: "8" });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
