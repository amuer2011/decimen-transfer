import type { Plugin } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Remove file inputs and file-oriented copy from the text edition's HTML. */
export function textOnlyHtml(copyIcons = false): Plugin {
  return {
    name: "text-only-html",
    transformIndexHtml(html) {
      return html
        .replace(/<div class="mode-picker"[\s\S]*?<\/div>/, "")
        .replace(/<label class="file-picker"[\s\S]*?<\/label>/, "")
        .replace(/<div class="demo-picker"[\s\S]*?<\/div><\/div>/, "")
        .replace('id="pane-snippet" hidden', 'id="pane-snippet"')
        .replaceAll("OPTICAL TRANSFER", "TEXT TRANSFER")
        .replaceAll("· Decimen</title>", "· Decimen 文本专用版</title>")
        .replaceAll("让文件跨越边界", "让文本跨越边界")
        .replaceAll("发送文件与文本", "发送文本")
        .replaceAll("把文件化作动态二维码", "把文本化作动态二维码")
        .replaceAll("文件或一段文字", "输入或粘贴一段文字")
        .replace(/最大 %MAX_FILE_LABEL% · 文本 %MAX_SNIPPET_LABEL%/g, "仅文本 · 最大 %MAX_SNIPPET_LABEL%")
        .replaceAll("自动还原文件", "自动还原文本")
        .replaceAll("发送文件", "发送文本")
        .replaceAll("选择文件或拖放到上方区域", "输入文本后点击「准备文本」")
        .replaceAll("等待校验完成，保存文件", "等待校验完成，复制文本")
        .replaceAll("文件恢复进度", "文本恢复进度")
        .replaceAll("文件传输二维码", "文本传输二维码");
    },
    generateBundle() {
      if (!copyIcons) return;
      for (const fileName of ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "icon.ico", "apple-touch-icon.png", "decimen_logo.svg"]) {
        this.emitFile({ type: "asset", fileName, source: readFileSync(resolve("public", fileName)) });
      }
    },
  };
}
