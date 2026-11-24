/**
 * Account + theos allowance.
 *
 * The signed-in account lives in the app's secret store as plain JSON
 * ({"apiKey","username","isPro"}). The daily allowance is read from the same
 * endpoint the app polls, with the same lane headers, so the numbers shown are
 * the ones the server actually holds for this machine and day.
 *
 * The grant itself is decided server-side (per machine, per day); nothing a
 * client sends raises it. What the bridge can do is make it visible and keep
 * paid models from being spent by accident.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import https from "node:https";
import dns from "node:dns";

// api.deepai.org resolves to IPv6 only on some resolvers; undici's fetch does not
// fall back the way curl does, so pin IPv4 and use node:https directly.
dns.setDefaultResultOrder("ipv4first");

const SECRET = path.join(os.homedir(), ".deepai-code/userdata/secrets/deepai-account.bin");
const ORIGIN = process.env.DEEPAI_API_ORIGIN || "https://api.deepai.org";
const LANE = "7";
const TTL = 60_000;
export const APP_VERSION = () => process.env.DEEPAI_APP_VERSION || "0.3.50";

let cached = null;
let cachedAt = 0;
let nonce = null;

export function account() {  try {
    const raw = JSON.parse(fs.readFileSync(SECRET, "utf8"));
    if (raw?.apiKey) return raw;
  } catch {}
  return null;
}

function machineHeader() {
  for (const file of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      const id = fs.readFileSync(file, "utf8").trim().toLowerCase();
      if (/^[0-9a-f]{32}$/.test(id) && !/^0+$/.test(id))
        return crypto.createHash("sha256").update(id).digest("hex");
    } catch {}
  }
  return null;
}

/** Current allowance, cached briefly. null when unavailable. */
export async function allowance({ refresh = false } = {}) {
  if (!refresh && cached && Date.now() - cachedAt < TTL) return cached;
  const acc = account();
  if (!acc) return null;

  const headers = {
    "api-key": acc.apiKey,
    "X-DeepAI-Code-Theos": LANE,
    "X-DeepAI-Code-Instance": crypto.randomBytes(16).toString("hex"),
    "X-DeepAI-Code-Beacon": `v=${APP_VERSION()};up=${Math.floor(process.uptime())};pi=1`,
  };
  const machine = machineHeader();
  if (machine) headers["X-DeepAI-Code-Machine"] = machine;
  if (nonce) headers["X-DeepAI-Code-Check-In"] = nonce;

  try {
    const res = await post(`${ORIGIN}/deepai_code/theos`, headers, 20_000);
    if (!res || res.status !== 200) return cached;
    const data = res.body;
    if (data?.check_in?.nonce) nonce = data.check_in.nonce;
    cached = {
      enabled: Boolean(data?.enabled),
      balance: Number(data?.balance ?? 0),
      granted: Number(data?.granted ?? 0),
      refreshAt: data?.refresh_at ?? null,
      username: acc.username ?? null,
      isPro: Boolean(acc.isPro),
      at: new Date().toISOString(),
    };
    cachedAt = Date.now();
    return cached;
  } catch {
    return cached;
  }
}

/** Minimal HTTPS GET over IPv4 returning parsed JSON. */
function post(url, headers, timeout) {
  return new Promise((resolve) => {
    const req = https.get(url, { family: 4, headers, timeout }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}
