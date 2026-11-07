# HomeCloudUI 0.2.1 — KAN-82 physical QA fixes

## Pointer-driven drag/drop in Windows WebView2
- Replaces HTML5 drag/drop (`dataTransfer`) which WebView2 intercepts.
- Mirrors the user's WebOS Files pointer gesture with a 7px threshold,
  ghost preview, target hover highlighting, Escape cancellation, suppressed
  post-drag click, and autoscroll.
- Drop targets: directories in grid/list, current directory, root breadcrumb,
  and stored favorite directories inside the SAME published HC SS root.
- Default drag moves; holding Ctrl copies. Same-directory Ctrl+drag selects
  `name (копия).extension`, then numbered copies.
- Never accepts cross-node or cross-root targets, self/descendant moves, or
  operations lacking the published HC SS root permission.

## Delete authorization diagnosis
- File deletion already exists on HC SS. Requires the explicit
  `allow_delete: true` in the configured storage root; `allow_write: true`
  does **not** grant deletion.
- The UI now opens an explanation dialog even if the root denies deletion.
  Confirmation is disabled until the server advertises `allow_delete`.
- Error details for `DELETE_FORBIDDEN` and `PERMISSION_DENIED` are reported.
- No ACL override or backdoor is introduced. Administrators can check the
  root's actual JSON config at `/root/homecloud/storage-service.json`.
- Deleting a nonempty directory is still intentionally unsupported.

## Verification
- `npm run build`, `npm run test:storage`, `cargo test --lib`,
  Windows x64 NSIS and Linux bundles through PR/main CI.
- Physical Windows test with expendable data in an allowed storage root:
  open/confirm/delete, drag file into folder, Ctrl+drag copy, drag folder to
  another folder, root breadcrumb drop, favorites drop, and ESC cancel.
