/**
 * Transport discovery, per platform.
 *
 * The DeepAI Code app spawns a `pi` child process that owns the local model
 * transport and holds a per-launch capability token in its environment.
 *
 * Linux   /proc/<pid>/environ      readable by the same user; yama only guards /proc/<pid>/mem
 * macOS   `ps eww`                 environment of a process of the same user
 * Windows PEB via NtQueryInformationProcess (PowerShell + P/Invoke)
 *
 * Override with DEEPAI_TRANSPORT_URL / DEEPAI_TRANSPORT_TOKEN when discovery
 * cannot work (containers, remote host, locked-down Windows).
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d+$/;
const CANDIDATE = /^(pi|bun)(\.exe)?$/;

const env = process.env;

function fromEnv() {
  const url = (env.DEEPAI_TRANSPORT_URL || "").replace(/\/$/, "");
  const token = env.DEEPAI_TRANSPORT_TOKEN || "";
  if (!url || !token) return null;
  return { pid: null, url, token, thread: env.T3_DEEPAI_THREAD_ID || "", via: "env" };
}

function parseEnvBlock(text) {
  const out = {};
  for (const kv of String(text).split("\0")) {
    const i = kv.indexOf("=");
    if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return out;
}

/** Accept a pid whose environment looks like the transport. */
function build(pid, envMap, via) {
  if (!envMap?.T3_DEEPAI_TOKEN || !envMap?.T3_DEEPAI_URL) return null;
  const url = envMap.T3_DEEPAI_URL.replace(/\/$/, "");
  if (!LOOPBACK.test(url)) return null;
  return { pid, url, token: envMap.T3_DEEPAI_TOKEN, thread: envMap.T3_DEEPAI_THREAD_ID || "", via };
}

function pidsLinux() {
  const out = [];
  for (const pid of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const comm = fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim();
      if (CANDIDATE.test(comm)) out.push({ pid, env: () => parseEnvBlock(fs.readFileSync(`/proc/${pid}/environ`, "utf8")) });
    } catch {}
  }
  return out;
}

function pidsMac() {
  const out = [];
  let listing = "";
  try {
    listing = execFileSync("ps", ["-Ao", "pid=,comm="], { encoding: "utf8", timeout: 10_000 });
  } catch {
    return out;
  }
  for (const line of listing.split("\n")) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const base = m[2].trim().split("/").pop();
    if (!CANDIDATE.test(base)) continue;
    const pid = m[1];
    out.push({
      pid,
      env: () => {
        // `ps eww` appends KEY=VALUE pairs after the command line.
        const raw = execFileSync("ps", ["eww", "-p", pid, "-o", "command="], { encoding: "utf8", timeout: 10_000 });
        const map = {};
        for (const token of raw.split(/\s+/)) {
          const i = token.indexOf("=");
          if (i > 2 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(token.slice(0, i))) map[token.slice(0, i)] = token.slice(i + 1);
        }
        return map;
      },
    });
  }
  return out;
}

const WIN_PS = `
$ErrorActionPreference='SilentlyContinue'
if (-not ('PEnv' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PEnv {
  [StructLayout(LayoutKind.Sequential)] public struct PBI { public IntPtr R; public IntPtr P; public IntPtr I; }
  [DllImport("ntdll.dll")] public static extern int NtQueryInformationProcess(IntPtr h, int c, ref PBI p, int l, out int r);
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(int a, bool i, int p);
  [DllImport("kernel32.dll")] public static extern bool ReadProcessMemory(IntPtr h, IntPtr a, byte[] b, int s, out IntPtr r);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  public static string Env(int pid) {
    IntPtr h = OpenProcess(0x0410, false, pid);
    if (h == IntPtr.Zero) return "";
    try {
      PBI pbi = new PBI(); int r;
      if (NtQueryInformationProcess(h, 0, ref pbi, Marshal.SizeOf(pbi), out r) != 0) return "";
      long addr = (long)pbi.P + 0x20;
      IntPtr read;
      byte[] ptr = new byte[8];
      if (!ReadProcessMemory(h, (IntPtr)addr, ptr, 8, out read)) return "";
      long u = BitConverter.ToInt64(ptr, 0);
      if (u == 0) return "";
      long lenAddr = u + 0x3F0, bufAddr = u + 0x3F8;
      byte[] lenB = new byte[8];
      if (!ReadProcessMemory(h, (IntPtr)lenAddr, lenB, 8, out read)) return "";
      int len = (int)BitConverter.ToInt64(lenB, 0);
      if (len <= 0 || len > 1 << 20) return "";
      byte[] data = new byte[len];
      if (!ReadProcessMemory(h, (IntPtr)bufAddr, data, len, out read)) return "";
      return System.Text.Encoding.Unicode.GetString(data);
    } finally { CloseHandle(h); }
  }
}
'@
}
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(pi|bun)(\\.exe)?$' } | ForEach-Object {
  $e = [PEnv]::Env($_.ProcessId)
  if ($e) { "###" + $_.ProcessId + "###" + $e }
}
`;

function pidsWindows() {
  const out = [];
  let raw = "";
  try {
    raw = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WIN_PS], {
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return out;
  }
  for (const block of raw.split("###").slice(1)) {
    // blocks alternate: pid, environment
    void block;
  }
  const parts = raw.split("###");
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const pid = parts[i].trim();
    const map = parseEnvBlock(parts[i + 1].replace(/\r/g, ""));
    out.push({ pid, env: () => map });
  }
  return out;
}

function candidates() {
  if (process.platform === "linux") return pidsLinux();
  if (process.platform === "darwin") return pidsMac();
  if (process.platform === "win32") return pidsWindows();
  return [];
}

/** Live transport: { pid, url, token, thread } or null. */
export function findTransport() {
  const direct = fromEnv();
  if (direct) return direct;
  for (const candidate of candidates()) {
    try {
      const found = build(candidate.pid, candidate.env(), process.platform);
      if (found) return found;
    } catch {}
  }
  return null;
}

/** Is the desktop app itself running? */
export function appRunning() {
  try {
    if (process.platform === "linux") {
      for (const pid of fs.readdirSync("/proc")) {
        if (!/^\d+$/.test(pid)) continue;
        try {
          const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
          if (/deepai[-_]?code/.test(cmd) && !/--type=/.test(cmd)) return true;
        } catch {}
      }
      return false;
    }
    if (process.platform === "darwin") {
      return execFileSync("pgrep", ["-f", "deepai_code|DeepAI Code"], { encoding: "utf8" }).trim() !== "";
    }
    if (process.platform === "win32") {
      const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", "(Get-Process | Where-Object { $_.ProcessName -match 'deepai' } | Measure-Object).Count"], { encoding: "utf8", timeout: 15_000 });
      return Number(out.trim()) > 0;
    }
  } catch {}
  return false;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
