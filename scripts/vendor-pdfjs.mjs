import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(projectRoot, "node_modules/pdfjs-dist/build");
const packageRoot = resolve(projectRoot, "node_modules/pdfjs-dist");
const targetRoot = resolve(projectRoot, "vendor/pdfjs");

await mkdir(targetRoot, { recursive: true });
await copyFile(resolve(packageRoot, "LICENSE"), resolve(targetRoot, "LICENSE"));

const sharedBuildOptions = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome100", "edge100", "firefox102", "safari15.4"],
  minify: true,
  legalComments: "none"
};

await build({
  ...sharedBuildOptions,
  entryPoints: [resolve(sourceRoot, "pdf.worker.mjs")],
  outfile: resolve(targetRoot, "pdf.worker.js"),
  globalName: "pdfjsWorker"
});

await build({
  ...sharedBuildOptions,
  entryPoints: [resolve(sourceRoot, "pdf.mjs")],
  outfile: resolve(targetRoot, "pdf.js"),
  globalName: "pdfjsLib"
});

console.log("Built file://-compatible PDF.js browser bundles in vendor/pdfjs.");
