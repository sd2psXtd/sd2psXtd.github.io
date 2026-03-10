# PS2 Memory Card Browser

Client-side browser for PS2 memory card image files (`.ps2`, `.bin`, `.vmc`,
`.mcd`, `.mc2`).

## Structure

- `index.html`: page layout and app bootstrap
- `styles.css`: UI styling
- `js/constants.js`: filesystem constants and format helpers
- `js/app-utils.js`: shared file/drop/download helpers
- `js/app-history.js`: bounded undo/redo snapshot history
- `js/card-index.js`: card-wide index building, global search source, and diff
  summary helpers
- `js/ps2mc-parser.js`: PS2 MC superblock/FAT/directory parser
- `js/ps2mc-editor.js`: writable operations, integrity scan, and safe repair
  operations
- `js/ps2mc-newcard.js`: new empty card image generation
- `js/zip-utils.js`: ZIP read/write helpers for import/export
- `js/ui.js`: rendering helpers for status/info/table/details
- `js/app.js`: application state, orchestration, and event binding

## Notes

- Parser supports both raw images and ECC-appended page layouts.
- Directories are browsed from `rootdir_fat_cluster`.
- FAT traversal uses `ifc_list` double-indirect lookup.
- Timestamp decoding follows the known PS2 directory-entry date layout.
- Writable operations are available:
  - Add file
  - Add folder (root only; nested folders are blocked)
  - Delete file
  - Delete folder recursively (including contents)
- ECC-appended images are converted to raw layout on load so they can be edited.
- Undo/redo is available for edit actions.
- Rename entries is supported.
- Search supports current-directory and global modes.
- Folder export to ZIP is supported.
- ZIP import to root is supported (top-level folders are recreated; deeper paths
  are flattened inside those folders).
- Integrity checker and safe repair preview/apply are supported.
- Right-click entries/the table background to open context actions.
- Drag and drop files onto the directory table to upload them into the current
  directory.
- Use `New Empty Card` to create a fresh PS2 card image in-browser (1MB to
  64MB).
- New names are currently limited to ASCII (max 31 bytes).
- Open the app through a local web server. `file://` loading blocks ES module
  imports in Chrome/Safari.

## Run Locally

From the repository root:

```bash
cd memcard_browser
python3 -m http.server 8080
```

Then open:

- `http://localhost:8080/`

## References

- [PSDevWiki: PS2 Memory Card](https://www.psdevwiki.com/ps2/Memory_Card)
- [PS2MCFS notes (mymc)](http://www.csclub.uwaterloo.ca:11068/mymc/ps2mcfs.html)
