# Platforms

The tricky part is not the protocol, it is finding the transport token that the
running app holds in its child process. Each platform reads it differently.

How to verify on any platform:

```bash
deepbridge doctor
```

## Linux

Uses `/proc/<pid>/environ`. `kernel.yama.ptrace_scope = 1` blocks
`/proc/<pid>/mem` but not `/proc/<pid>/environ`, so no privilege is needed.

The app path defaults to `~/AppImages/deepai_code.appimage`; override with
`DEEPAI_APP_BIN` when yours lives elsewhere.

## macOS

Uses `ps eww`, which prints a process environment when the process belongs to the
same user. Nothing else changes; `brew install node` if `node` is missing.

The app path defaults to `~/AppImages/deepai_code.appimage`. For a `.app`
bundle, point at the inner binary:

```bash
export DEEPAI_APP_BIN="/Applications/DeepAI Code.app/Contents/MacOS/DeepAI Code"
```

`deepbridge install` writes the PATH line to `~/.zshrc` and `~/.bashrc`.

## Windows

WSL works exactly like Linux. Native Windows needs PowerShell: the token is read
from the process PEB through `NtQueryInformationProcess`.

1. Install Node.js 18+ (`winget install OpenJS.NodeJS.LTS`).
2. From the repository, in PowerShell:

```powershell
node src\bridge.mjs        # first run creates ~/.deepai-bridge/token
```

3. Point Claude Code at it (user environment, once):

```powershell
setx ANTHROPIC_BASE_URL "http://127.0.0.1:41200"
setx ANTHROPIC_AUTH_TOKEN "<token from %USERPROFILE%\.deepai-bridge\token>"
setx CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY "1"
setx ANTHROPIC_MODEL "claude-3-haiku--deepseek-v4.1-flash"
```

4. Start `node src\bridge.mjs` before a session, or register a launcher:

```powershell
$a = New-ScheduledTaskAction -Execute "node" -Argument "$HOME\deepai-bridge\src\bridge.mjs"
$a
Register-ScheduledTask -TaskName deepbridge -Action $a -Trigger (New-JobTrigger -AtLogOn)
```

Native Windows is the least tested path here. If PEB reading is blocked by
policy, use the escape hatch: start the bridge and export
`DEEPAI_TRANSPORT_URL` / `DEEPAI_TRANSPORT_TOKEN` yourself, which skips
discovery entirely.

## Docker

The app is an Electron GUI, so the usual container shape is: app on the host,
bridge inside a container is *not* useful (it needs the host's processes). Two
workable setups:

### 1. Bridge on the host, clients in containers

Start the bridge on the host (`deepbridge serve`), then from the container use
the host gateway:

```bash
docker run --rm --add-host host.docker.internal:host-gateway \
  -e OPENAI_BASE_URL=http://host.docker.internal:41200/v1 \
  -e OPENAI_API_KEY=<token> <image>
```

### 2. Bridge and app on the same host, remote clients over Tailscale

The bridge listens on loopback only. To expose it, put it behind a proxy bound to
the tailnet interface, or run it with a different bind (see the note below), then
from a laptop:

```bash
export ANTHROPIC_BASE_URL=http://<host>.<tailnet>.ts.net:41200
export ANTHROPIC_AUTH_TOKEN=<token>
```

Keep the token private: anyone who reaches the port consumes your theos.

### Remote/injected deployment

When no discovery is possible (app in another namespace, kiosk builds), inject
the transport directly:

```bash
DEEPAI_TRANSPORT_URL=http://127.0.0.1:<port> \
DEEPAI_TRANSPORT_TOKEN=<capability> \
node src/bridge.mjs
```

The values come from the `pi` process of the app:

```bash
tr '\0' '\n' < /proc/<pi-pid>/environ | grep T3_DEEPAI
```
