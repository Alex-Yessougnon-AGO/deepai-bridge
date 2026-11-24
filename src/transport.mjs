/**
 * Transport discovery.
 *
 * The DeepAI Code app spawns a `pi` child process that owns the local model
 * transport and holds a per-launch capability token in its environment.
 * /proc/<pid>/environ is readable by the same user even when
 * kernel.yama.ptrace_scope = 1 (that only guards /proc/<pid>/mem).
 */
import fs from "node:fs";

const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d+$/;

function envOf(pid) {
  const out = {};
  let raw;
  try {
    raw = fs.readFileSync(`/proc/${pid}/environ`, "utf8");
  } catch {
    return out;
  }
  for (const kv of raw.split("\0")) {
    const i = kv.indexOf("=");
    if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return out;
}

/** Live transport: { pid, url, token, thread } or null. */
export function findTransport() {
  let best = null;
  let pids;
  try {
    pids = fs.readdirSync("/proc");
  } catch {
    return null;
  }
  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) continue;
    let comm = "";
    try {
      comm = fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim();
    } catch {
      continue;
    }
    if (!comm.startsWith("pi") && comm !== "bun") continue;
    const env = envOf(pid);
    if (!env.T3_DEEPAI_TOKEN || !env.T3_DEEPAI_URL) continue;
    const url = env.T3_DEEPAI_URL.replace(/\/$/, "");
    if (!LOOPBACK.test(url)) continue;
    const found = {
      pid,
      url,
      token: env.T3_DEEPAI_TOKEN,
      thread: env.T3_DEEPAI_THREAD_ID || "",
    };
    if (comm === "pi") return found; // a real agent runtime beats a fallback
    best ??= found;
  }
  return best;
}

/** Is the desktop app itself running? */
export function appRunning() {
  for (const pid of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
      if (/deepai[-_]?code/.test(cmd) && !/--type=/.test(cmd)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
