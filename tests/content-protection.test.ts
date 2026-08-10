import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { shouldProtectWindow } = require("../desktop/content-protection.cjs") as {
  shouldProtectWindow: (platform: string, systemVersion: string) => boolean;
};

test("skips content protection on Windows 10 LTSC 2019", () => {
  assert.equal(shouldProtectWindow("win32", "10.0.17763"), false);
});

test("enables content protection at Windows 10 build 19041", () => {
  assert.equal(shouldProtectWindow("win32", "10.0.19041"), true);
});

test("skips content protection immediately below the supported Windows boundary", () => {
  assert.equal(shouldProtectWindow("win32", "10.0.19040"), false);
});

test("keeps content protection on supported Windows builds", () => {
  assert.equal(shouldProtectWindow("win32", "10.0.19044"), true);
  assert.equal(shouldProtectWindow("win32", "10.0.26100"), true);
});

test("keeps content protection on non-Windows platforms", () => {
  assert.equal(shouldProtectWindow("darwin", "23.0.0"), true);
  assert.equal(shouldProtectWindow("linux", "6.8.0"), true);
});

test("skips protection when a Windows version cannot be parsed", () => {
  assert.equal(shouldProtectWindow("win32", "unknown"), false);
});
