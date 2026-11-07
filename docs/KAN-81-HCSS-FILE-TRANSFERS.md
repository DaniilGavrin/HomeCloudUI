# Update: User-configured Backend pool and auto-discovered HC SS file endpoint

HomeCloudUI no longer creates an undeletable `127.0.0.1` Backend. All servers are ordinary user-managed pool entries. On the first start with no saved servers, the pool is empty; an explicitly set `HOMECLOUD_WS_URL` can still bootstrap one entry. Existing stored `primary` entries are migrated: generated loopback stub is removed, while a remote address is retained under a new, removable node ID. The former dedicated primary WebSocket is not started.

HC SS now supports `file_ws.auth_mode: "trusted_network"`, bound to a private IPv4 with exact `allowed_client_ips`. HC SS advertises a file endpoint in `storage.agent.inventory`; Backend validates and exposes it through `storage.agent.status`. The UI uses this endpoint automatically, without user-entered URL, Tailnet requirement or static bearer key. File bytes still travel directly to HC SS, not via Backend.

This mode is **not user authentication**. The existing Backend `hello` is not an authenticated user login. Trusted-network mode relies on isolation of the chosen private network, an explicit exact source-IP ACL and HC SS root permissions. Do not expose port 8093 publicly. For an untrusted LAN use the existing token mode, a TLS-capable authenticated design, or a protected tunnel. No `file_ws` endpoint is published when the service is disabled or in legacy token mode.

The existing file-ws v1 behavior (size limits, SHA-256, no-overwrite, mkdir, rename regular files, delete regular files/empty folders) is unchanged. This change does not imply that the running HC SS on an existing installation has been updated or that delete/write has been enabled.

---

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
