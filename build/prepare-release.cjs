// Verify every edition before making a release visible to update clients.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const yaml = require("js-yaml");
const { releaseVariants, expectedFiles, validateNsisInfo } = require("../desktop/update-policy.cjs");

async function digest(file, algorithm, encoding) {
  const hash = createHash(algorithm);
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}

async function prepare(input, output, tag) {
  const { version } = require("../package.json");
  if (tag !== `v${version}`) throw new Error(`Tag ${tag} does not match package version ${version}`);
  await fs.promises.mkdir(output, { recursive: true });
  async function collect(directory) {
    for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
      const source = path.join(directory, entry.name);
      if (entry.isDirectory()) { await collect(source); continue; }
      if (entry.name.startsWith("builder-") || !/\.(exe|dmg|zip|deb|yml|blockmap|html|txt)$/.test(entry.name)) continue;
      const destination = path.join(output, entry.name);
      if (fs.existsSync(destination) && await digest(source, "sha256", "hex") !== await digest(destination, "sha256", "hex")) throw new Error(`Conflicting asset: ${entry.name}`);
      await fs.promises.copyFile(source, destination);
    }
  }
  await collect(input);
  const catalog = { schema: 1, version, notes: await fs.promises.readFile(path.join(__dirname, "../RELEASE_NOTES.md"), "utf8"), variants: {} };
  for (const target of releaseVariants()) {
    const files = {};
    for (const [role, name] of Object.entries(expectedFiles(version, target))) {
      const file = path.join(output, name);
      const size = (await fs.promises.stat(file)).size;
      if (size < 1024 * 1024) throw new Error(`Asset too small: ${name}`);
      files[role] = { name, size, sha512: await digest(file, "sha512", "base64") };
    }
    if (target.platform === "win32") {
      const metadata = yaml.load(await fs.promises.readFile(path.join(output, `${target.channel}.yml`), "utf8"));
      validateNsisInfo(metadata, { version, file: files.installer });
      if (!fs.existsSync(path.join(output, `${files.installer.name}.blockmap`))) throw new Error(`Missing blockmap: ${target.key}`);
    }
    catalog.variants[target.key] = { channel: target.channel, files };
  }
  for (const edition of ["", ".Text"]) for (const arch of ["x64", "arm64"]) {
    const name = `Decimen.Optical.Transfer${edition}-v${version}-mac-${arch}.zip`;
    if (!fs.existsSync(path.join(output, name))) throw new Error(`Missing macOS update ZIP: ${name}`);
  }
  await fs.promises.writeFile(path.join(output, "updates.json"), JSON.stringify(catalog, null, 2) + "\n");
  let sums = "";
  for (const name of (await fs.promises.readdir(output)).filter(n => n !== "SHA256SUMS.txt").sort()) sums += `${await digest(path.join(output, name), "sha256", "hex")}  ${name}\n`;
  await fs.promises.writeFile(path.join(output, "SHA256SUMS.txt"), sums);
  console.log(`Verified ${Object.keys(catalog.variants).length} client variants; release ${tag} is complete.`);
}

if (require.main === module) prepare(process.argv[2], process.argv[3], process.argv[4]).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { prepare };
