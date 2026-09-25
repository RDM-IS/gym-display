/// <reference types="vitest/config" />
import { execSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// DRIFT-ALARM (2026-09-25): the build stamps the commit it came from into the
// bundle, so "is the live site current?" is an exact comparison instead of a
// guess at which source strings ought to be present. Cloudflare Pages sets
// CF_PAGES_COMMIT_SHA; a local build falls back to git; neither is fatal.
function commitSha(): string {
  const fromPages = process.env.CF_PAGES_COMMIT_SHA;
  if (fromPages) return fromPages.trim();
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

// Emits /version.json and a <meta name="commit-sha"> so the deployed commit is
// readable from the served site without parsing the hashed JS bundle.
function versionStamp(): Plugin {
  const sha = commitSha();
  return {
    name: "version-stamp",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ sha, short: sha.slice(0, 7), builtAt: new Date().toISOString() }),
      });
    },
    transformIndexHtml() {
      return [{ tag: "meta", attrs: { name: "commit-sha", content: sha }, injectTo: "head" as const }];
    },
  };
}

export default defineConfig({
  plugins: [react(), versionStamp()],
  server: { port: 5173 },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
