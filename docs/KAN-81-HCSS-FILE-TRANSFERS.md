# KAN-81 — HomeCloudUI and HC SS file operations

## Architecture

- **Backend WS**: agent inventory/status, root listings, file metadata and cursor pagination. No file bytes traverse the Backend or the old Storage Manager.
- **HC SS private file WebSocket**: streams binary file data directly from the desktop to the selected storage node; no mandatory Tailscale or separate bearer key in the HomeCloudUI.
- **HomeCloudUI**: discovers the private `file_ws` endpoint through `storage.agent.status`, connects via Tauri Rust, and displays native dialogs/progress/errors.
- **HC SS root permissions**: server-enforced `allow_read`, `allow_write`, `allow_delete`, confined paths, atomic file creation and no-overwrite. UI permissions only control presentation.

`file_ws.auth_mode = "trusted_network"` with `allowed_client_ips: []` permits **any private IPv4 client able to reach the dedicated listener**, without manual IP or token registration. An exact allowlist can optionally narrow the peers. The storage service must bind an explicit private IPv4; external/WAN exposure must be denied by the network and host firewall. This mode is **not per-user authentication**, and a compromised LAN host can execute all operations granted to a root. Refer to [HC SS trusted private-LAN setup](https://github.com/DaniilGavrin/HomeCloud-Storage-Service/blob/main/docs/TRUSTED-PRIVATE-FILE-WS.md).

The older `auth_mode = "token"` remains supported by HC SS but is not automatically exposed to keyless HomeCloudUI. No endpoint is published when `file_ws` is disabled. All server entries are user-managed; the UI does not force a `127.0.0.1` Backend connection.

## Supported v1 operations

- Download through native save dialog, temporary local file, SHA-256 and size verification, fsync and exclusive no-overwrite publish.
- Upload through native open dialog, streaming/chunks, server-side SHA-256/size verification, exclusive temporary file and atomic no-overwrite publish.
- Create one directory (no automatic recursive parent creation).
- Rename regular files only (requires write + delete); no directory rename.
- Delete a regular file or an **empty** directory only (requires `allow_delete` and explicit UI confirmation).
- Paginate file listings in the Backend (500 items per page). Switching Backend/storage root invalidates pending selections and stale results.

No transfer falls back to deprecated Storage Manager commands. V1 does not include resume, range downloads, persistent transfer queues or recursive delete.

## Acceptance on real hardware

1. Back up storage config and data. Configure a **disposable folder-root** with narrowly scoped write/delete permissions; retain production roots as read-only.
2. Deploy compatible HC SS, Backend and HomeCloudUI binaries. Confirm port 8093 is bound only to the storage server's private address and not reachable from WAN/guest networks.
3. In HomeCloudUI, add/select an actual Backend, choose the HC SS node and permitted root. The file endpoint should appear automatically with **no key, Tailnet configuration or desktop IP registration**.
4. Download and upload test content; compare SHA-256; ensure duplicate filenames never overwrite existing data and transfers report progress.
5. Create a folder, rename a test file, delete with confirmation, delete the now-empty folder. Check invalid paths, read-only roots, large files and interruption cleanup.
6. Switch nodes, interrupt Backend or HC SS, reconnect, and verify browsing still uses the correct node. Confirm SourceWS → Gateway → TV playback still works.

CI success is not proof of on-device E2E. Mark KAN-81 complete only after the above checks.

Related: https://bytewizardru.atlassian.net/browse/KAN-81
