## KAN-81 file transfer integrity recovery

Downloads and uploads already compare SHA-256; with this update the native Tauri
client automatically retries checksum/size inconsistencies **up to 3 total
attempts**. Each attempt uses a fresh WebSocket and transfer ID. For download,
temporary files are discarded before retry; nothing reaches the user's chosen
destination until integrity is verified. For upload, HC SS discards an
invalid temporary upload and never publishes it.

Permission errors, existing-target conflicts, invalid paths and unrelated
connection errors are NOT retried. Exhausted integrity attempts raise an
explicit error to the user. A successful auto-recovery is reported in the UI.

HC Storage Service creates newly uploaded regular files with 0666 and
newly-created directories with 0777; no executable bits are added to files.
Existing disk contents are untouched. These modes allow all Unix local users
to modify the new entries, so filesystem access and network firewall policy
must match the owner's intended shared-storage trust boundary.
