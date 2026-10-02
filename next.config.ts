import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";
let commit = "unknown";
try { commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* Source archives may omit Git metadata. */ }

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "192.168.0.160"],
  output: "standalone",
  env: { XBOOK_BUILD_COMMIT: commit },
};

export default nextConfig;
