import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const { variant, releaseVariants, expectedFiles, selectUpdate, validateNsisInfo } = require("../desktop/update-policy.cjs");
const { UpdateController, trustedUrl } = require("../desktop/updates.cjs");

const target = variant("decimen-optical-transfer", "win32", "x64");
const hash = Buffer.alloc(64, 7).toString("base64");
function catalog(version = "1.0.9", choice = target) {
  return { schema: 1, version, notes: "<script>plain text</script>", variants: {
    [choice.key]: { channel: choice.channel, files: Object.fromEntries(Object.entries(expectedFiles(version, choice)).map(([role, name]) => [role, { name, size: 100, sha512: hash }])) },
  } };
}
function fixture(options: Record<string, unknown> = {}) {
  const calls = { read: 0, check: 0, download: 0, install: 0, manual: 0, open: 0 };
  const file = selectUpdate(catalog(), target, false).file;
  const updater = {
    async checkForUpdates() { calls.check++; return { updateInfo: { version: "1.0.9", files: [{ url: file.name, size: file.size, sha512: file.sha512 }] } }; },
    async downloadUpdate() { calls.download++; },
    quitAndInstall() { calls.install++; },
  };
  const controller = new UpdateController({
    version: "1.0.8", target, portable: false, packaged: true,
    read: async () => { calls.read++; return catalog(); },
    createUpdater: () => updater,
    manualDownload: async (_update: unknown, progress: (p: number) => void) => { calls.manual++; progress(80); return "verified.exe"; },
    canRestart: async () => true,
    openPackage: async () => { calls.open++; },
    ...options,
  });
  return { controller, updater, calls };
}

test("all ten release variants have distinct keys and correctly isolated artifact names", () => {
  const variants = releaseVariants();
  assert.equal(variants.length, 10);
  assert.equal(new Set(variants.map((v: {key: string}) => v.key)).size, 10);
  for (const choice of variants) {
    const update = selectUpdate(catalog("1.0.9", choice), choice, false);
    assert.equal(update.file.name.includes(".Text"), choice.edition === "text");
    assert.equal(update.file.name.includes("win7"), choice.win7);
  }
  assert.deepEqual(variants.filter((v: {platform:string}) => v.platform === "win32").map((v: {channel:string})=>v.channel), ["latest", "win7", "text", "text-win7"]);
});

test("rejects edition switches, traversal, invalid checksums, oversized files and prereleases", () => {
  for (const patch of [{ name: "../evil.exe" }, { name: "https://evil.example/a.exe" }, { name: "Decimen.Optical.Transfer.Text-v1.0.9-win-x64-Setup.exe" }, { sha512: "bad" }, { size: 2 ** 31 }]) {
    const info = catalog(); Object.assign(info.variants[target.key].files.installer, patch);
    assert.throws(() => selectUpdate(info, target, false));
  }
  assert.throws(() => selectUpdate(catalog("1.0.9-beta.1"), target, false));
  assert.throws(() => selectUpdate(catalog(), variant("decimen-optical-transfer-win7", "win32", "x64"), false));
});

test("NSIS metadata must match the verified catalog exactly", () => {
  const update = selectUpdate(catalog(), target, false);
  const valid = { version: update.version, files: [{url:update.file.name,sha512:hash,size:100}] };
  validateNsisInfo(valid, update);
  for (const info of [{...valid,version:"9.0.0"}, {...valid,packages:{}}, {...valid,files:[{...valid.files[0],url:"https://evil.example/x.exe"}]}, {...valid,files:[...valid.files,...valid.files]}]) assert.throws(()=>validateNsisInfo(info,update));
});

test("no startup network access; explicit check, download and restart are separate actions", async () => {
  const { controller, calls } = fixture();
  assert.equal(controller.getStatus().phase,"idle"); assert.equal(calls.read,0);
  await controller.install(); await controller.download(); assert.equal(calls.install,0); assert.equal(calls.download,0);
  assert.equal((await controller.check()).phase,"available"); assert.equal(calls.download,0);
  assert.equal((await controller.download()).phase,"downloaded"); assert.equal(calls.install,0);
  await controller.install(); assert.equal(calls.install,1);
});

test("active transfer or unsaved result blocks installation without losing the downloaded update", async () => {
  let safe = false;
  const {controller,calls}=fixture({canRestart:async()=>safe});
  await controller.check(); await controller.download();
  assert.match((await controller.install()).message,/先结束传输/); assert.equal(calls.install,0);
  assert.equal(controller.getStatus().phase,"downloaded");
  safe=true; await controller.install(); assert.equal(calls.install,1);
});

test("offline errors and corrupt downloads remain retryable and never install", async () => {
  let offline=true;
  const {controller,updater,calls}=fixture({read:async()=>{if(offline)throw new Error("offline");return catalog();}});
  assert.equal((await controller.check()).phase,"error");
  offline=false; await controller.check();
  updater.downloadUpdate=async()=>{throw new Error("checksum mismatch");};
  assert.equal((await controller.download()).phase,"available");
  await controller.install(); assert.equal(calls.install,0);
  updater.downloadUpdate=async()=>{};
  assert.equal((await controller.download()).phase,"downloaded");
});

test("same or older versions do not offer an upgrade",async()=>{
  for(const version of ["1.0.8","1.0.7"]){const {controller,calls}=fixture({read:async()=>catalog(version)});assert.equal((await controller.check()).phase,"current");assert.equal(calls.check,0);}
});

test("portable updates use only the portable artifact and reveal the verified replacement",async()=>{
  const {controller,calls}=fixture({portable:true});
  assert.equal(controller.getStatus().mode,"manual");
  await controller.check(); assert.equal(calls.check,0);
  assert.match(controller.update.file.name,/-x64\.exe$/); assert.doesNotMatch(controller.update.file.name,/-Setup/);
  await controller.download(); await controller.install(); assert.equal(calls.manual,1);assert.equal(calls.open,1);assert.equal(calls.install,0);
});

test("rejects non-GitHub download origins and insecure redirects",()=>{
  for(const url of ["http://github.com/x","file:///tmp/a.exe","https://github.com.evil.example/x","https://user@github.com/x","https://github.com:1234/x"])assert.throws(()=>trustedUrl(url));
  trustedUrl("https://release-assets.githubusercontent.com/file?signature=opaque");
});
