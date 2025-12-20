# Astral Proxy (Winstreak.ws Proxy)
### A cross‑platform Minecraft Java Edition proxy and tooling suite, built with TypeScript/Node.js. Astral Proxy sits between your Minecraft client and Hypixel server to provide quality‑of‑life features like Discord Rich Presence, bedwars utilities, mod hooks and robust caching — while remaining fast and lightweight.

> Not affiliated with Mojang, Microsoft, Hypixel, or any server/operator. Use responsibly and in accordance with all applicable Terms of Service and rules.

---

## Highlights

- Cross‑platform binaries for Windows, macOS, and Linux
- First‑run Microsoft Account sign‑in (device code flow)
- Discord Rich Presence integration
- Mod system with simple loader API
- Hypixel utilites, focused on bedwars gameplay.
- Local caching for profiles and configuration

## Disclaimers

- Astral Proxy does not condone cheating or rule violations. You are solely responsible for how you use it.
- Some servers disallow proxies or traffic manipulation. Verify and respect each server's rules.
- The software is provided "as is" without warranties of any kind. Use at your own risk.
- Authentication tokens and cached data are stored locally; protect your machine and account.

---

## Downloads (Releases)

Prebuilt downloads are provided in GitHub Releases. Choose the artifact for your OS:

- Windows: `Astral-win-x64.exe` — download and run the executable.
- macOS (Intel x64): `Astral-mac-x64.dmg` — open, then drag `Astral.app` to Applications.
- Linux (x64): `Astral-linux-x64.tar.gz` — extract, run `./install.sh` (optional), then run the `astral` binary.

> Tip: If your OS warns about an unknown publisher, this is expected for community builds.

---

## Build From Source

Astral Proxy is built with Node.js and pnpm. You can run it in dev mode or produce platform binaries yourself.

### Prerequisites
- Node.js 18+ (20 LTS recommended)
- pnpm (`npm i -g pnpm`)
- Git

### Install & Run (Dev)
```bash
pnpm install
pnpm dev
```
This starts the TypeScript entry (`src/index.ts`) via `tsx` and watches assets/manifests.

### Build & Run (Production JS)
```bash
pnpm build
pnpm start
```
This compiles TypeScript to `dist/` and runs `dist/index.js`.

### Bundle & Package (Desktop Binaries)
Platform builds use `pkg` with esbuild bundling:
```bash
# Bundle app (generates manifest, builds bundle)
pnpm run build:bundle

# Windows x64 EXE (with post‑build signing flow)
pnpm run build:win

# Linux x64 tarball
pnpm run build:linux

# macOS x64 DMG
pnpm run build:mac

# Build all platforms (on a machine with needed toolchains)
pnpm run build:all
```
Artifacts are emitted under `dist/<platform>` (e.g., `dist/win-x64/Astral-win-x64.exe`).

---

## Configuration

Most configuration is managed via https://astral.winstreak.ws/config (Discord authentication required). Local data directories:

- `data/config/config.json`: primary app and proxy configuration
- `data/config/discord-user.json`: Discord integration config cache (do not edit manually)
- `data/config/minecraft-user.json`: Minecraft account/user config cache (do not edit manually)

Caches and profiles:
- `data/cache/profiles/` and `profiles/`

---

## Setup & Usage

### Initial setup
- Install Astral (see Downloads above) and launch it.
- On first launch, Astral prints an authentication link in the console. Open it and authenticate via Discord.
- Configure options at https://astral.winstreak.ws/config.

### Play via the proxy
- Add `localhost:25566` to your Minecraft server list.
- Connect to `localhost:25566`; you will be prompted to log in using Microsoft authentication.
- Use the same Microsoft account you intend to play on; other accounts will not work.
- After successful login and Microsoft Account authentication, Astral automatically redirects you to `hypixel.net`.

### Connectivity controls
- If the WebSocket drops, use `/a:restartws` in chat to re‑establish the connection to our servers.

### IRC usage
- Join the IRC channel with: `/a:irc join general` (currently only `general` exists).
- The default IRC prefix is `-` and can be changed in your config.
- To send a message to IRC, start your chat message with your IRC prefix; any message that starts with this prefix is sent to IRC instead of public chat.
- Leave IRC with: `/a:irc leave`.
- IRC will only work if you set a username with our discord bot.
- When someone joins or leaves the IRC channel, a notice like `<Username> has joined/left the channel` is shown.

---
 

## Security & Privacy

- Tokens and cache files are stored locally under `data/cache/profiles/` and `profiles/`.
- Do not share these files; treat them like secrets.
- Astral Proxy does not transmit your credentials to third parties.
- Keep your system secure and up to date.

---

## Privacy & TOS

By using Astral you automatically accept our Privacy Policy and Terms of Service. Please review them:

- Privacy Policy: https://astral.winstreak.ws/privacy/
- Terms of Service: https://astral.winstreak.ws/terms/

---

## Contributing

Contributions are welcome!

By submitting a pull request or other contribution to this repository, you
agree that your contribution is licensed under the Apache License, Version 2.0,
and that you have the right to submit the work under these terms.

### How to contribute
1. Fork the repository and create a feature branch.
2. Install dependencies and run checks:
   ```bash
   pnpm install
   pnpm lint
   pnpm format # optional
   ```
3. Open a Pull Request against `main` with a clear description of your changes.

## Troubleshooting

- Build issues: ensure Node 18+ and latest pnpm.
- Windows SmartScreen/Gatekeeper: use "Run anyway" or right‑click → Open.
- Login problems: delete stale caches under `data/cache/profiles/` then relaunch.
- Proxy connection: verify server address/port in `config.json` and firewall rules.

---

## Links

- Releases: https://github.com/winstreak-ws/astral-proxy/releases
- Issues: https://github.com/winstreak-ws/astral-proxy/issues
- Discussions: https://github.com/winstreak-ws/astral-proxy/discussions
