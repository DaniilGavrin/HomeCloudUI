# KAN-79 — HC SS → TV Playback, Pause and Full Stop

## Supported remote workflow

1. In **Мультимедиа → На серверах**, choose the Backend carrying the TV and HC Storage Service.
2. The **HC SS → TV** box loads `storage.agent.status`, shows connected storage agents and only their **online, allow_list + allow_read** roots.
3. Navigate directories using `storage.fs.list`; choose a playable audio/video file with an HCS1 `hc1.…` file ID **provided by HC Storage Service**. Never synthesize file IDs from a local path.
4. Choose the online TV registered on the **same Backend**. Network is normally **LAN** because TV and Gateway sit on the same home network, even when the controlling PC connects to Backend through Tailscale.
5. The Rust `homecloud_hcss_play` command checks the source agent is registered/online, reads the Backend's own node ID via `cluster.status`, obtains an already-active room scoped to that TV, and calls `media.rooms.play` through the existing identified Backend WS. When a room exists, it passes its `room_id` to request a new playback generation rather than creating a competing room.
6. Backend issues a room offer to TV and Gateway. The Gateway fetches media from HC SS directly; the Backend **never** carries media bytes. The UI displays true room state from KAN-77 subscriptions.

## Remote controls

- **Pause TV / Resume TV**: `media.room.control` with room, playback and generation IDs. Requires ACTIVE room and READY TV attachment; waits for actual state updates from the TV decoder.
- **Полный стоп TV**: `media.rooms.stop` on the selected room. Backend transitions it to CLOSED, notifies Gateway and TV with `media.room.closed`; the Gateway removes streams and workers, and TV closes its stream and decoder surface. The control does not depend on TV Online when Backend still knows the room.
- The TV device detail card likewise permits Full Stop for a known room even if TV appears Offline.
- **Limit:** Backend's transport-delivered STOP **does not prove** physical TV execution. If the TV has lost its WS/network connection, the Backend and Gateway still release the room, but the standalone TV player may not receive the close event until reconnection. Do not claim the TV is physically stopped without confirmation.
- Never claim `command_status:accepted` proves playback. Only Backend decoder-derived `playback_state` can show PLAYING/PAUSED.

## Distinct file catalogs

- The existing section **«Медиатека HomeCloud»** lists *Backend Storage Manager* files with a different `file_id` contract. It is retained for download and **cannot** directly start a HC SS stream.
- The HC SS launcher uses `storage.agent.status` and `storage.fs.list` only, with root-scoped HCS1 IDs returned by HC SS.
- Current Backend forwarding does not support the HC SS `cursor` field, so the browser shows at most the **first 500 directory entries**. Deep browsing works by entering subfolders. Pagination can follow with a separate Backend protocol patch.

## Test / acceptance

CI runs TypeScript/Vite, Rust unit tests, native Windows NSIS and Linux deb/AppImage. For a real remote E2E demo, confirm the TV Player and Gateway are updated and running, HC SS is registered and reachable by the Gateway, and the selected file has a compatible audio/video codec.

1. Start an MP3/WAV or supported MP4; confirm the room appears and real decoder reports PLAYING.
2. Click Pause and verify sound/video actually pauses while room remains ACTIVE. Click Resume and verify continuation.
3. Click **Полный стоп TV** from the work PC through Tailscale. Confirm that the room closes, Gateway stops its source stream and the Android TV returns to the idle shell. Check again after a reconnect.
4. Repeat while TV peer is disconnected to test Backend cleanup, *without* misrepresenting it as proof of immediate physical stop.
5. Confirm a second file can replace the existing room and stale generations cannot affect the new stream.

No Backend, Gateway, or HC SS server deployment is performed by this UI PR. If a real demo fails, record each node's runtime version and logs before changing the protocol.
