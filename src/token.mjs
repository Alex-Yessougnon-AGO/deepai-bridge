/** Bridge token: created once, stored 0600, reused afterwards. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const STATE = path.join(os.homedir(), ".deepai-bridge");
const FILE = path.join(STATE, "token");

export function bridgeToken() {
  try {
    const existing = fs.readFileSync(FILE, "utf8").trim();
    if (existing) return existing;
  } catch {}
  const token = `dbr_${crypto.randomBytes(24).toString("hex")}`;
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(FILE, token, { mode: 0o600 });
  return token;
}
