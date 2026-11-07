# ByteWizard HomeCloud UI

Desktop and panel interface for the self-hosted HomeCloud platform. Built with
Tauri 2 (Rust), React, TypeScript and Vite.

## Local development

Requires Node.js 22+, Rust stable (edition 2024) and Tauri 2 platform
prerequisites. On Linux, install WebKitGTK 4.1 development libraries.

```bash
npm ci
npm run dev                # browser-only frontend
npm run tauri -- dev       # native Tauri window and Rust WebSocket services
npm run build              # TypeScript and Vite checks
```

## Desktop CI/CD

[GitHub Actions: HomeCloud UI - Windows + Linux Release](.github/workflows/desktop-release.yml)

- **Pull request targeting `main`**: run frontend checks, then build
  **Windows x64** (NSIS `.exe`) and **Linux x64** (`.deb`, `.AppImage`) in
  parallel. Packages are retained as workflow artifacts, but not published.
- **Merge or direct push into `main`**: run those same three jobs and
  **publish a GitHub prerelease only after all builds pass**. The release tag
  is `ui-<first 12 digits of commit SHA>`, and includes the three packages
  and `SHA256SUMS.txt`.
- **Manual run on `main`**: use workflow dispatch; re-running the same commit
  refreshes existing release assets rather than producing another tag.

Source is built using the committed `package-lock.json` and
`src-tauri/Cargo.lock`. Build runners are separate Windows and Ubuntu GitHub
hosts; no code cross-compilation between operating systems.

**Compatibility:** Linux x64 bundles are built on Ubuntu 24.04 and therefore
target modern glibc/WebKitGTK systems; a future dedicated ARM64/kiosk build
will be tracked separately. Neither the Windows NSIS installer nor the Linux
packages are OS/code-signing certified. Windows may display a SmartScreen
warning until Authenticode signing is configured. These rolling packages are
marked *prerelease*; do not treat green CI as on-device acceptance.

`SHA256SUMS.txt` can be checked in the same downloaded directory:

```bash
sha256sum -c SHA256SUMS.txt
```

This pipeline only builds and publishes packages. It does not deploy to
HomeCloud nodes, restart the Backend, or modify Storage Service.

## Automatic HC SS file transfers

HC Storage Service publishes its file WebSocket addresses through Backend.
HomeCloudUI tries the published private LAN and overlay addresses in order,
without manual URL fields, authentication modes, tokens or IP allowlists.
The server firewall controls access to port 8093 and HC SS enforces root
read/write/delete permissions. If the chosen address is unreachable, the UI
reports the connection error instead of asking for a `file_ws` setting.

Deploy order: HomeCloudBackend, HC Storage Service, then HomeCloudUI.
