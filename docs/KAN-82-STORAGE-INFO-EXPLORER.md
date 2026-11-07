# HomeCloudUI 0.2.2 — Storage inventory inside Explorer (KAN-82)

HomeCloudUI has one file/storage workflow:

- The redundant **Хранилища** navigation item and Home shortcut were removed.
- The legacy StoragePage/HcssStorageOverviewPage and their old CSS were removed.
- **Проводник** now exposes an always-available **ⓘ Хранилища** button.
- This opens a read-only, structured inventory dialog, organized by storage
  node and four tabs: Overview, Disks/Partitions, File access, Connection.
- Each opening refreshes via existing Backend `homecloud_hcss_sources`.
  A separate Refresh button does not interrupt Explorer file operations.
- All known nodes are selectable (including offline nodes); stale information
  remains readable and is clearly labeled if Backend is unavailable.
- Overview: node and filesystem counts, physical devices, published roots and
  mounted filesystem usage. Block-device capacity is never double-counted as
  an independent mount.
- Disks: mounted filesystem type/path/device/size/free/available/read-only,
  plus a separate physical block-device inventory.
- File access: every published root with its separate list/read/write/delete
  permissions and live/offline status. No permissions can be changed in UI.
- Connection: server, node ID, last-seen, boot/session metadata,
  published FileWS endpoints and capabilities.

No Backend, HC SS, protocol or authorization changes. All file operations,
Ctrl+drag and TV launch stay in the Explorer workspace. Offline status and
unknown metadata are not invented. The information dialog is read-only.

QA:
1. Confirm the sidebar and Home have only **Проводник**, not **Хранилища**.
2. Open `ⓘ Хранилища` while browsing `storage-hdd`.
3. Verify /mnt/storage disk usage, root permissions, Last seen, LAN/Tailscale
   endpoints and offline behavior.
4. Switch tabs and node without changing the active Explorer folder.
5. Recheck delete, copy, move, drag/drop and TV launch from Explorer.
