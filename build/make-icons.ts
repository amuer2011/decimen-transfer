// One SVG supplies the app, favicon, PWA, Apple and Windows shell artwork.
// resvg runs on every build platform; no external rasterizer is required.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const publicDir = fileURLToPath(new URL("../public", import.meta.url));
const logo = readFileSync(join(publicDir, "decimen_logo.svg"), "utf8");
if (!logo.includes("data-icon-background") || !logo.includes('<g data-icon-mark="foreground">')) {
  throw new Error("Icon SVG must declare its background and foreground mark");
}

function fullBleed(markScale: number): string {
  return logo
    .replace(/(<rect data-icon-background[^>]*?) rx="112"/, "$1")
    .replace('<g data-icon-mark="foreground">', `<g data-icon-mark="foreground" transform="translate(256 256) scale(${markScale}) translate(-256 -256)">`);
}

function render(svg: string, size: number): Buffer {
  return new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
}

for (const [name, size, svg] of [
  ["icon-192.png", 192, logo],
  ["icon-512.png", 512, logo],
  ["icon-maskable-512.png", 512, fullBleed(0.8)],
  ["apple-touch-icon.png", 180, fullBleed(1)],
] as const) {
  writeFileSync(join(publicDir, name), render(svg, size));
  console.log(`public/${name} ${size} × ${size}`);
}

// PNG-backed ICO entries are supported by Windows 7 and later. Include small
// shell/taskbar sizes rather than relying on scaling down a single 256px image.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(size => render(logo, size));
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16;
  directory[entry] = directory[entry + 1] = size === 256 ? 0 : size;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(images[index]!.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += images[index]!.length;
}
writeFileSync(join(publicDir, "icon.ico"), Buffer.concat([directory, ...images]));
console.log(`public/icon.ico ${sizes.join(" / ")} px`);

// Keep the inlined, theme-aware header mark in sync with the canonical SVG.
const mark = logo.match(/<g data-icon-mark="foreground">([\s\S]*)<\/g>\s*<\/svg>/)?.[1];
if (!mark) throw new Error("Icon foreground group is missing");
const inlineMark = `<svg class="brand-logo" viewBox="0 0 512 512" fill="none" aria-hidden="true">${mark.replaceAll("#f4f4f0", "currentColor").replace(/\s+/g, " ").trim()}</svg>`;
for (const page of ["../index.html", "../send/index.html", "../receive/index.html"]) {
  const file = fileURLToPath(new URL(page, import.meta.url));
  const html = readFileSync(file, "utf8");
  const header = /<svg class="brand-logo"[\s\S]*?<\/svg>/;
  if (!header.test(html)) throw new Error(`Missing header logo: ${page}`);
  writeFileSync(file, html.replace(header, inlineMark));
}
