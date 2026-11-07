# KAN-81 — HomeCloudUI → HC SS file transfers

The canonical Storage screen still gets **Backend WS inventory and browsing** through `homecloud_hcss_sources` / `homecloud_hcss_browse`. File transfers never share that control channel and do not use the old Storage Manager.

## Native data plane

HomeCloudUI opens one authenticated WebSocket per file operation directly to HC SS on its Tailscale-only listener. Tauri Rust `homecloud_hcss_file_operation` validates the `ws://100.64.0.0/10:port/ws/files` endpoint before sending the bearer token. A loopback listener is permitted for development only. No DNS, ordinary LAN or public WAN target is accepted by the native command.

A node administrator must enable `file_ws` explicitly and generate a private 256-bit token on the HC SS host (see [HC SS protocol documentation](https://github.com/DaniilGavrin/HomeCloud-Storage-Service/blob/feat/kan-81-secure-file-transfers/docs/KAN-81-FILE-WS-V1.md)). The administrator types the HC SS endpoint and token into the Storage screen. **The token exists only in React component memory**, is cleared when the Backend or node selection changes, and is never persisted to a settings file or forwarded via the Backend WS.

## UI operations

- **Download** on a selected file when root `allow_read` is true; saves through the native file dialog to a temporary local file, verifies SHA-256 and declared size, fsyncs, publishes by exclusive hard link.
- **Upload** from native file dialog when root `allow_write` is true; cannot overwrite an existing remote filename; progress is emitted from native Rust to UI.
- **New folder** when root `allow_write` is true. No implicit recursive parent creation.
- **Rename file** when both write and delete are permitted. Renaming whole directory trees is not supported in this v1 protocol.
- **Delete file** or **empty current folder**, only when `allow_delete`; requires a second explicit confirmation. Recursive delete is unsupported.

Permission checks are repeated on the service; UI controls are only presentation. One command = one WS session. Actions return explicit errors on rejected credentials, forbidden roots, conflicts or interrupted transfer. Failure **never** falls back to legacy storage APIs.

## Manual acceptance checklist

1. From a Tailscale-connected desktop, connect to an explicitly enabled HC SS Tailnet listener (dedicated port). Confirm wrong token/peer denies access.
2. Browse an allowed `disk` or `folder` root via Backend WS. Source path is never arbitrary OS-absolute path.
3. Upload a small test file to disposable directory, inspect remote checksum. Retry same filename must fail without overwrite.
4. Download the same file; verify SHA-256; retry existing local destination must fail.
5. Create folder, rename file, delete file, delete now-empty folder with explicit confirmation.
6. Change Backend or storage node: credentials must clear and no previous node's files remain on screen.
7. Disconnect mid-transfer: temporary file is not published as a completed file. Reconnect and restart from zero.
8. Confirm SourceWS Media Gateway and TV Player still play previously existing media (no changes to media protocol in KAN-81).

Limitations: no persistent transfer queue, resume or directory rename; the admin controls exact allowed roots in local HC SS config. Backend hello is not user-authenticated, so write/delete are **not** added to that control WS. Real-node E2E must be confirmed separately from CI.

Related: https://bytewizardru.atlassian.net/browse/KAN-81
