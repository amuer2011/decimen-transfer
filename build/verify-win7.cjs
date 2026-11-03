// Inspect the shipped runtime, not the portable NSIS wrapper or a cached ZIP.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");

async function verify() {
  const { version } = require("../package.json");
  const output = path.resolve(__dirname, "../artifacts/desktop/win7");
  const fileName = `Decimen.Optical.Transfer-v${version}-win7-x64.exe`;
  const portable = path.join(output, fileName);
  const executable = path.join(output, "win-unpacked/Decimen Optical Transfer Win7.exe");
  assert.ok(fs.statSync(portable).size > 50 * 1024 * 1024, "Portable EXE missing or too small");
  assert.ok(fs.existsSync(path.join(output, "win-unpacked/resources/app.asar")), "app.asar missing");
  const header = Buffer.alloc(8192);
  const fd = fs.openSync(executable, "r");
  try { fs.readSync(fd, header, 0, header.length, 0); } finally { fs.closeSync(fd); }
  assert.equal(header.toString("ascii", 0, 2), "MZ");
  const pe = header.readUInt32LE(0x3c);
  assert.ok(pe + 6 <= header.length, "Invalid PE header offset");
  assert.equal(header.readUInt32LE(pe), 0x4550, "Invalid PE signature");
  assert.equal(header.readUInt16LE(pe + 4), 0x8664, "Application runtime must be x64");
  // Node supplies real stdout pipes for a Windows GUI executable. PowerShell's
  // direct invocation can return before capturing any output from Electron.
  const runtime = spawnSync(executable, ["-p", "process.versions.electron"], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    windowsHide: true, encoding: "utf8", timeout: 30000,
  });
  if (runtime.error) throw runtime.error;
  assert.equal(runtime.status, 0, runtime.stderr);
  assert.equal(runtime.stdout.trim(), "22.3.27", "Wrong Electron runtime");
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(portable)) hash.update(chunk);
  const digest = hash.digest("hex");
  fs.writeFileSync(path.join(output, "SHA256SUMS-win7.txt"), `${digest}  ${fileName}\n`, "ascii");
  console.log(`Verified x64 / Electron 22.3.27: ${fileName}\nSHA-256: ${digest}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### Win7 SP1 x64\n\nFile: ${fileName}\n\nElectron 22.3.27 / Chromium 108\n\nSHA-256: ${digest}\n`);
  }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
