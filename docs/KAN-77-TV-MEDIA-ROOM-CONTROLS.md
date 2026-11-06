# KAN-77: TV room controls V1

The desktop HomeCloudUI retains one identified Backend WebSocket per configured server (primary and secondary Server Pool). Media-room control traffic is multiplexed with other Backend commands. **No media packets are sent through the Backend.**

## Server synchronization

- Subscribe to `media.room.changed` and `media.room.closed` on each Backend control socket, then asynchronously request `media.rooms.snapshot` on that same socket.
- Store separate room maps per `server_id`, keyed by `room_id`. The selected TV matches `target.device_id` **within** its server, not globally.
- Buffer authoritative events while the snapshot is loading; apply only events after the snapshot's `sequence` and `instance_id`.
- Reject out-of-order/gapped events and clear stale state on socket disconnect or a changed Backend `instance_id`.
- A late snapshot from a refresh cannot overwrite more recent live room events.
- Display `playback_state` and `position_ms` directly from Backend; neither a queued command nor a successful WebSocket write is evidence that the TV decoded anything.

## Controls

`homecloud_media_command` is a restricted Tauri command that accepts only:

| UI action | Backend command | Parameters |
|---|---|---|
| Play / Pause / Resume | `media.room.control` | `room_id`, `playback_id`, `generation`, `command_id`, `action` |
| Set volume | `media.room.control` | action `volume`, volume 0..100 |
| Mute / Unmute | `media.room.control` | action `mute`, boolean muted |
| Seek -/+ 10 s | `media.rooms.seek` | `position_ms` bounded to 0..7 days |
| Stop | `media.rooms.stop` | `command_id`, `room_id` |

Rust verifies that the selected room still matches the same server, TV device, playback and generation before issuing every command. Backend validates the command again; stale requests are rejected. Controls other than Stop require an ACTIVE room and READY TV attachment. The volume slider sends only on Apply, not continuously.

After a successful request, the UI reports only that Backend received the command and waits for authoritative room updates. `control_status` is shown separately; `EXECUTED` is never inferred from `DELIVERED`.

## Limitations / acceptance

- An active media room must already exist. **The old MediaPage still has a generic clients.send interface and does not create media rooms**. Wiring Storage file selection to `media.rooms.play` is a separate task.
- Realtime position is last-reported `position_ms`, not a synthetic running timer; Backend does not currently include duration.
- The requested seek target is separate from the confirmed TV position.
- GitHub Actions checks TypeScript/Vite, device classification tests, Rust lib tests (Linux), then Windows NSIS and Linux deb/AppImage and publishes a main prerelease.
- Physical Android TV + Gateway + Storage integration is **not** proven by CI and remains on review until on-device tests.

## Manual test

1. Connect HomeCloudUI and TV Player to the same Backend and verify TV is Online.
2. Open Devices → TV. Confirm `media.rooms.snapshot` syncs and absent rooms show an empty state.
3. Create a real media room using the existing Backend protocol (e.g. developer/test client). Confirm the matching room appears on exactly one server.
4. Verify Play/Pause/Volume/Mute and Seek; check Backend's `control_status` and TV's actual decoder state independently.
5. Disconnect TV/Backend, verify controls disable and old room does not survive reconnect.
6. Switch source or seek (generation increments), verify old commands fail safely.
