# Moving files between HC Storage Service directories

In Storage → HC SS explorer, select a regular file and choose
**Переместить в папку…**. Browse existing directories in the same published
root, and confirm **Переместить сюда**. The selected file stays in place if
the target has the same name or an error occurs.

The picker requests directory listings via the existing Backend control WS;
the actual `file.move` request goes directly to the selected HC Storage
Service on its file WebSocket. It passes `root`, `path` and `new_path`,
does not download or upload the file, and does not require `allow_delete` —
only `allow_write`.

Works for moves inside the same root and filesystem (hard link plus unlink,
no overwrite). Does not move folders or cross filesystem boundaries.
Permissions and SHA remain unchanged for moved regular files.

Existing file.rename and file.delete commands are not changed.
