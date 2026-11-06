/// <reference types="vite/client" />

/** Compile-time edition flag; file-transfer branches are omitted from text builds. */
declare const __TEXT_ONLY__: boolean;

/**
 * Emitted by the `inline-zxing-wasm` plugin in build/inline-zxing-wasm.ts:
 * the decoder wasm as a data: URI. Only standalone builds import it — served
 * builds resolve receive/wasm-url.ts instead and never touch this module.
 */
declare module "virtual:zxing-wasm-data-url" {
  const dataUrl: string;
  export default dataUrl;
}
