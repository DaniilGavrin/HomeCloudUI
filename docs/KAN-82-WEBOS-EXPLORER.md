# KAN-82 — WebOS-style Explorer over HC Storage Service

## Product boundary
HomeCloudUI 0.2.0 replaces the `Мультимедиа` menu item with **Проводник**.
The embedded audio/video/image player is gone. Media playback on TV remains
a Backend command initiated from an HC SS file in Explorer. The TV device
page retains playback and room management.

The **Хранилища** page is inventory-only (node status, volumes, roots);
the file workspace is no longer stacked below storage statistics.

## Implemented in 0.2.0 alpha
The owner's WebOS Files layout is ported to HomeCloud, including list/grid,
search in loaded directory, sorting, hidden files, favorites, breadcrumb
navigation/back/forward/up, keyboard multi-selection, cut/copy/paste,
context menu, internal drag-and-drop, operations history and modals for
properties/create/rename/destination/delete/TV playback confirmation.

File content remains in HC SS. Direct file I/O is via HC SS FileWS v1,
while Backend handles discovery, catalog listings and TV room control.
The native Tauri client selects LAN/Tailscale endpoints already published
by Backend. No manual keys or local filesystem access to server roots.

New HC SS FileWS operations: `file.touch` (empty file), `file.copy`
(independent file/directory copy), `file.move` on directories.
Server-side copies have bounded directory enumeration and stream
`file.progress` messages. Publication happens only after successful
copy into a private staging tree; partial copies are rolled back.
File copies cannot replace existing targets; the same holds for normal
moves in uncontested namespaces. Files remain 0666 and folders 0777,
matching earlier HomeCloud storage policy.

## Deployment order
1. Update HomeCloud Storage Service from main commit 5523b3dc.
2. Confirm the service is active, health `127.0.0.1:8092/readyz`,
   LAN/Tailscale `:8093`, existing files unchanged.
3. Install the HomeCloudUI 0.2.0 Windows x64 NSIS from its commit-scoped
   GitHub release (not an unverified PR artifact).
4. Validate copy/move/mkdir/touch/rename/delete/read/download/drag-drop
   on disposable test data before real files.
5. Confirm the TV room launch prompt before replacing an existing room.
6. Keep older HC SS binary backup for rollback.

## Known deliberate limitations
- `file.delete` removes regular files or **empty** directories only.
  Recursive deletion/recycle bin/undo are not yet available; the UI warns.
- Operations do not cross different storage roots/nodes.
- No deep recursive search, OS desktop drag import, resilient resumable
  upload/download, bulk local folder download or template creation.
- Server-side copy is non-atomic as a batch when multiple items are selected;
  completed preceding items remain if a later item fails.
- TV rendering is delegated to HomeCloud TV Player; HomeCloudUI never
  decodes or displays a stream.
- E2E physical hardware and visual touch/mouse QA remain to be performed
  before marking KAN-82 Done.

**Backwards compatibility:** Old HomeCloudUI binaries continue working
with the extended HC SS server. The new Explorer requires the new HC SS
binary for copy, touch and directory move; legacy FileWS methods unchanged.
