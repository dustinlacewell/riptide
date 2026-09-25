# riptide

Find build junk across a drive, uncheck what you want to keep, delete the rest.

```
npm install
npm run dev
```

The Vite dev server is the backend. `plugin/` runs in Node with full
filesystem access and serves an API on `/__riptide`; `src/` is the React UI.
One process, one command.

## Scanning

Two strategies. riptide picks one automatically and tells you which ran.

**MFT** — opens the raw volume and streams the NTFS Master File Table. Every
file and directory has a ~1 KB record there holding its name, its parent's
record number, and its size, so one large sequential read yields the entire
tree. No directory traversal at all.

**Walk** — an ordinary recursive `readdir` that prunes at each match, so it
never descends into a matched subtree. Always available.

Measured on this machine, `D:\code` (4.87M records, 343 hits):

| strategy | time |
|---|---|
| MFT | 26s |
| walk | 60s |

Both return identical path lists.

### The MFT path needs elevation

An unelevated `open("\\\\.\\C:")` returns `EPERM`. Run the dev server from an
administrator shell to get the fast path; otherwise riptide falls back to the
walk and says so in the UI.

## Deleting

Deletion is gated in three places:

1. **Screening** — drive roots, `Windows`, `Program Files`, `ProgramData`,
   user profile roots, `$Recycle.Bin`, and anything less than two levels below
   a drive root are refused outright. Paths are resolved first, so `..` cannot
   smuggle one through.
2. **Server-held plans** — `/plan` screens and re-measures the selection, then
   returns a token. `/zap` takes the token, never a path list, so what gets
   deleted is exactly what was screened and displayed.
3. **Typed confirmation** — the dialog shows the count, the bytes, and a
   sample of paths, and requires typing the count.

Deletes go to the Recycle Bin by default via `Shell.Application`, the same
mechanism Explorer uses, so they can be restored. Permanent deletion is an
explicit per-operation checkbox.

## Layout

```
plugin/
  index.js        API routes on the dev server
  zap.js          path screening + recycle/permanent delete
  mft/
    boot.js       $Boot geometry
    runlist.js    data run decoding
    record.js     fixups + file record parsing
    tree.js       parent-child assembly, path resolution, size rollup
    scan.js       volume I/O; MFT strategy with walk fallback
src/
  App.jsx         scan form, results table, selection
  ConfirmDialog.jsx
  source/
    context.js    SourceProvider: data source, preference store, clock
    httpSource.js NDJSON streaming client for the plugin's routes
```

The MFT parsers are pure functions over buffers. `npm test` exercises them
against synthetic records — no volume, no elevation.

## Notes on the format

Three things in NTFS reliably cause wrong output rather than errors:

- **Fixups.** NTFS overwrites the last two bytes of every sector in a record
  with a signature and stores the originals in the header. Skip the
  restoration and every 512th byte pair is garbage.
- **`clustersPerRecord` is signed.** Positive counts clusters; negative is a
  log2 byte size. On most volumes it is -10, meaning 1024 bytes — not 10
  clusters.
- **`$FILE_NAME` field order.** Name length sits at 0x40 and namespace at
  0x41. Reversed, every name truncates to the namespace enum (1-3 chars) and
  the scan silently returns nothing, while short test fixtures still pass.
