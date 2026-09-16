#!/usr/bin/env node
/**
 * Orchestrates all capacitor sync steps in one script:
 *   1. sync-backend  — copies backend source + installs deps
 *   2. bundle-backend — esbuild bundles into main.bundle.js, cleans source
 *   3. copy-missing-assets — ensures Android assets are up to date
 *   4. fetch-ffmpeg — downloads ffmpeg binary for Android
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import fs from "node:fs";

const guiDistSrc = path.resolve(__dirname, "..", "..", "gui", "dist");
const guiDistDest = path.resolve(__dirname, "..", "www", "nodejs", "gui", "dist");
if (fs.existsSync(guiDistSrc)) {
  fs.mkdirSync(path.dirname(guiDistDest), { recursive: true });
  fs.cpSync(guiDistSrc, guiDistDest, { recursive: true });
  console.log("[sync] Synced root gui/dist to capacitor nodejs gui/dist");
}

const steps = [
  "bundle-backend.mjs",
  "copy-missing-assets.mjs",
  "fetch-ffmpeg.mjs",
];

const passArgs = process.argv.slice(2);

for (const script of steps) {
  const scriptPath = path.join(__dirname, script);
  console.log(`\n▶ Running ${script}...\n`);
  const extraArgs = script === "fetch-ffmpeg.mjs" ? passArgs : [];
  execFileSync("node", [scriptPath, ...extraArgs], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "inherit",
  });
}

console.log("\n✅ All sync steps complete.\n");
