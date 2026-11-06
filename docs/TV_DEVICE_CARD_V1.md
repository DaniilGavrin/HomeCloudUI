# TV Device Card V1 (KAN-76)

## Scope

HomeCloudUI recognizes the actual `client_type: "tv"` used by the Tauri Android TV Player. The pure classifier in `src/components/devices/deviceKind.ts` also supports selected legacy TV descriptors, but never determines device type from `device_id`.

TV records are sourced exclusively from the existing Rust `device_registry` (keyed by `server_id` + `device_id`); Online/Offline and last-seen information are not guessed by the frontend. Other device types retain their existing JSON command editor.

When a TV is selected, the detail view shows a distinct TV card with two **working** actions:

1. **Перейти в мультимедиа** — navigates to the existing Media section; the playback target is selected there.
2. **Обновить список устройств** — invokes `homecloud_device_refresh` for *that TV's server*, requesting an updated `clients.list` from Backend, with errors surfaced in the UI.

Both controls remain safe if the device becomes Offline. The existing Offline-only remove action still works, and the TV card correctly communicates the disconnected state.

**Not part of V1:** any simulated Play/Pause/Seek/Volume buttons, a fabricated active media room, or automatic selection of this TV in Media. Online only means Backend currently sees a WebSocket client, **not** that a movie is playing.

## Follow-up

Wire a typed `media.rooms.snapshot/list` reader and `media.room.control` commands with room_id/playback_id/generation, subscribe to room change events, handle reconnects and stale generations, then add proper playback controls. Backend, Media Gateway, TV Player, and protocol are unchanged by this PR.

## Checks

```bash
npm ci
npm run test:devices
npm run build
```

The desktop release pipeline runs those checks before parallel native Windows and Linux builds. Physical UI acceptance with a connected Android TV remains a separate test.
