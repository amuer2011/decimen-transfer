# Electron LTSC Black Window Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Prevent the Electron native window from rendering black on Windows 10 Enterprise LTSC 2019 while preserving content protection on supported platforms.

**Architecture:** Add a pure CommonJS compatibility helper that maps the Electron platform and OS version to a content-protection decision. The Electron main process will call setContentProtection(true) only when the helper allows it; no renderer, local-server, or transfer code changes.

**Tech Stack:** Electron 40, CommonJS main process, Node node:test, TypeScript tests via tsx, electron-builder portable Windows packaging.

## Global Constraints

- Windows build 19041 is the minimum build for the protected-window behavior used here.
- Windows builds below 19041 must skip setContentProtection(true) so the window remains visible.
- Non-Windows platforms and supported Windows builds must preserve existing content protection.
- Unknown Windows version strings must disable content protection conservatively.
- Do not change GPU flags, renderer styles, local HTTP serving, screen capture selection, or transfer protocol behavior.

---

### Task 1: Add The Failing Compatibility Tests

**Files:**
- Create: tests/content-protection.test.ts
- Create during the red-to-green setup: desktop/content-protection.cjs

**Interfaces:**
- The test will consume shouldProtectWindow(platform: string, systemVersion: string): boolean from desktop/content-protection.cjs.
- The helper will export that function through CommonJS for both the Electron main process and the Node test runner.

- [ ] **Step 1: Write the test before the implementation exists**

Create tests/content-protection.test.ts with this content:

~~~ts
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
~~~

- [ ] **Step 2: Run the focused test and verify the expected red state**

Run:

~~~powershell
node --import tsx --test tests/content-protection.test.ts
~~~

Expected first result: the test runner reports that desktop/content-protection.cjs cannot be loaded because the production helper does not yet exist.

- [ ] **Step 3: Add only an initial CommonJS stub to convert the setup error into an assertion failure**

Create desktop/content-protection.cjs with:

~~~js
module.exports = {
  shouldProtectWindow() {
    return true;
  },
};
~~~

- [ ] **Step 4: Run the focused test again and verify the behavior-specific red state**

Run:

~~~powershell
node --import tsx --test tests/content-protection.test.ts
~~~

Expected result: the LTSC test fails because the initial stub returns true instead of false.

### Task 2: Implement The Pure Windows Build Decision

**Files:**
- Modify: desktop/content-protection.cjs
- Test: tests/content-protection.test.ts

**Interfaces:**
- Consumes: platform and systemVersion strings from the caller.
- Produces: shouldProtectWindow(platform, systemVersion): boolean.

- [ ] **Step 1: Replace the initial stub with the minimal implementation**

Replace desktop/content-protection.cjs with:

~~~js
const MINIMUM_PROTECTED_WINDOWS_BUILD = 19041;

function windowsBuild(systemVersion) {
  const match = /^10\.0\.(\d+)(?:\.|$)/.exec(systemVersion);
  return match ? Number(match[1]) : undefined;
}

function shouldProtectWindow(platform, systemVersion) {
  if (platform !== "win32") return true;
  const build = windowsBuild(systemVersion);
  return build !== undefined && build >= MINIMUM_PROTECTED_WINDOWS_BUILD;
}

module.exports = { shouldProtectWindow };
~~~

- [ ] **Step 2: Run the focused test and verify green**

Run:

~~~powershell
node --import tsx --test tests/content-protection.test.ts
~~~

Expected result: all five tests pass with zero failures.

- [ ] **Step 3: Check the focused diff**

Run:

~~~powershell
git diff --check
git diff -- desktop/content-protection.cjs tests/content-protection.test.ts
~~~

Expected result: no whitespace errors and only the helper plus its focused tests are changed.

### Task 3: Gate The Electron Main-Process Call

**Files:**
- Modify: desktop/main.cjs:1-14,316-320
- Test: tests/content-protection.test.ts

**Interfaces:**
- Consumes: shouldProtectWindow from desktop/content-protection.cjs and Electron process.getSystemVersion().
- Produces: the existing main-window behavior with the protection call gated by OS support.

- [ ] **Step 1: Import the helper beside the existing main-process dependencies**

Add after the Node imports in desktop/main.cjs:

~~~js
const { shouldProtectWindow } = require("./content-protection.cjs");
~~~

- [ ] **Step 2: Gate only the existing protection call**

Replace the unconditional call at the main window creation site with:

~~~js
  // Older Windows builds can render a protected Electron window as black.
  if (shouldProtectWindow(process.platform, process.getSystemVersion())) {
    window.setContentProtection(true);
  }
~~~

Leave the existing whole-display capture comment immediately above this block and leave all other BrowserWindow options unchanged.

- [ ] **Step 3: Run the focused test and type/build checks**

Run:

~~~powershell
node --import tsx --test tests/content-protection.test.ts
npm run build
~~~

Expected result: the focused test passes and the application build exits with code 0.

### Task 4: Run The Full Regression Suite

**Files:**
- Test: tests/*.test.ts

- [ ] **Step 1: Run all existing tests**

Run:

~~~powershell
npm test
~~~

Expected result: every test passes with zero failures.

- [ ] **Step 2: Confirm only scoped source changes remain**

Run:

~~~powershell
git status --short --untracked-files=all
git diff --check
~~~

Expected result: changes are limited to desktop/content-protection.cjs, desktop/main.cjs, and tests/content-protection.test.ts plus this plan document if it has not been committed separately.

### Task 5: Build The Windows Portable EXE

**Files:**
- Read: desktop/electron-builder.yml
- Generate: dist/
- Generate: artifacts/desktop/*.exe

- [ ] **Step 1: Install the locked dependencies if needed**

Run:

~~~powershell
npm ci
~~~

Expected result: npm installs the versions in package-lock.json without modifying the lockfile.

- [ ] **Step 2: Build and package the Windows x64 portable artifact**

Run:

~~~powershell
npm run desktop:win
~~~

Expected result: exit code 0 and a portable x64 EXE under artifacts/desktop/.

- [ ] **Step 3: Verify the generated artifact and package metadata**

Run:

~~~powershell
Get-ChildItem -LiteralPath "artifacts/desktop" -Filter "*.exe" |
  Select-Object FullName, Length, LastWriteTime

Get-FileHash -LiteralPath (Get-ChildItem -LiteralPath "artifacts/desktop" -Filter "*.exe" |
  Select-Object -First 1 -ExpandProperty FullName) -Algorithm SHA256
~~~

Expected result: one updated Windows x64 portable EXE is present with a nonzero size.

### Task 6: Verify The LTSC Workaround

**Files:**
- Use: generated EXE in artifacts/desktop/

- [ ] **Step 1: Launch the new EXE on Windows 10 LTSC 2019**

Run the generated EXE normally on the affected machine. The expected result is a visible Decimen interface instead of the black native window.

- [ ] **Step 2: Confirm supported-system behavior remains unchanged**

On Windows 10 build >= 19041, or on macOS/Linux, the app should still call setContentProtection(true). The pure helper tests are the automated proof of this branch; a manual capture check is optional and outside the LTSC fix itself.

- [ ] **Step 3: Record verification limitations**

If the development environment cannot run the generated EXE on LTSC 2019, report the build/test evidence and state that the final visual confirmation must be performed on the user's LTSC machine.
