const semver = require("semver");

const RELEASES = "https://github.com/amuer2011/decimen-transfer/releases";
const EDITIONS = ["full", "text"];

function variant(name, platform = process.platform, arch = process.arch) {
  const edition = name.includes("-text") ? "text" : "full";
  const win7 = platform === "win32" && name.endsWith("-win7");
  const channel = edition === "text" ? (win7 ? "text-win7" : "text") : (win7 ? "win7" : "latest");
  return { edition, win7, platform, arch, channel, key: `${edition}-${win7 ? "win7" : platform}-${arch}` };
}

function expectedFiles(version, target) {
  const base = `Decimen.Optical.Transfer${target.edition === "text" ? ".Text" : ""}`;
  if (target.platform === "win32" && target.arch === "x64") {
    const stem = `${base}-v${version}-${target.win7 ? "win7" : "win"}-x64`;
    return { installer: `${stem}-Setup.exe`, portable: `${stem}.exe` };
  }
  if (target.platform === "darwin" && ["x64", "arm64"].includes(target.arch)) {
    return { installer: `${base}-v${version}-mac-${target.arch}.dmg` };
  }
  if (target.platform === "linux" && target.arch === "arm64") {
    return { installer: `${base}-${version}-kylin-aarch64.deb` };
  }
  throw new Error("当前系统或架构没有对应的更新包。");
}

function releaseVariants() {
  return EDITIONS.flatMap(edition => [
    variant(`decimen-optical-transfer${edition === "text" ? "-text" : ""}`, "win32", "x64"),
    variant(`decimen-optical-transfer${edition === "text" ? "-text" : ""}-win7`, "win32", "x64"),
    ...["x64", "arm64"].map(arch => variant(`decimen-optical-transfer${edition === "text" ? "-text" : ""}`, "darwin", arch)),
    variant(`decimen-optical-transfer${edition === "text" ? "-text" : ""}`, "linux", "arm64"),
  ]);
}

function selectUpdate(catalog, target, portable) {
  if (!catalog || catalog.schema !== 1 || !semver.valid(catalog.version) || semver.prerelease(catalog.version)) {
    throw new Error("更新清单版本无效。");
  }
  const entry = catalog.variants?.[target.key];
  if (!entry || entry.channel !== target.channel) throw new Error("当前版本的更新包尚未就绪，请稍后重试。");
  const role = portable ? "portable" : "installer";
  const file = entry.files?.[role];
  const expected = expectedFiles(catalog.version, target)[role];
  if (!file || file.name !== expected || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 1024 ** 3 ||
      typeof file.sha512 !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)) {
    throw new Error("更新包名称、大小或校验信息无效。");
  }
  return {
    version: catalog.version,
    notes: typeof catalog.notes === "string" ? catalog.notes.slice(0, 16000) : "",
    file,
    baseUrl: `${RELEASES}/download/v${catalog.version}/`,
  };
}

function validateNsisInfo(info, update) {
  // Reject edition/Win7 switches, absolute URLs, web installers and mismatched
  // manifests before handing any executable to the updater.
  const files = info?.files;
  if (info?.version !== update.version || info.packages || !Array.isArray(files) || files.length !== 1 ||
      files[0].url !== update.file.name || files[0].sha512 !== update.file.sha512 || files[0].size !== update.file.size) {
    throw new Error("安装更新清单与当前版本不匹配，已停止更新。");
  }
}

module.exports = { RELEASES, variant, expectedFiles, releaseVariants, selectUpdate, validateNsisInfo };
