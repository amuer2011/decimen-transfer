import type { Plugin } from "vite";

export function rewriteStandaloneLinks(page: "send" | "receive"): Plugin {
  return {
    name: "rewrite-standalone-links",
    transformIndexHtml(html) {
      const nav = /<nav class="mode-nav"[^>]*>[\s\S]*?<\/nav>/;
      const brand = /<a class="brand" href="\.\.\/">([\s\S]*?)<\/a>/;
      if (!nav.test(html) || !brand.test(html)) throw new Error("Standalone header rewrite missed its target");
      return html
        .replace(nav, `<span class="mode-badge">${page === "send" ? "发送" : "接收"}</span>`)
        .replace(brand, '<span class="brand">$1</span>')
        .replace(/<link rel="(?:icon|apple-touch-icon)"[^>]*>/g, "");
    },
  };
}
