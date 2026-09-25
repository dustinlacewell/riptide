/**
 * Deletion.
 *
 * Two modes: recycle (default, recoverable) and permanent. Recycle goes
 * through the Shell.Application COM object, which is what Explorer itself
 * uses, so the items land in the Recycle Bin and can be restored from there.
 * fs.rm cannot do this — a direct unlink bypasses the bin entirely.
 */

import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";

/**
 * Paths we refuse to delete regardless of what the UI asked for. A pattern
 * typo should not be able to take out a drive root or a system directory.
 */
const REFUSED = [
  /^[A-Za-z]:\\?$/,
  /^[A-Za-z]:\\Windows$/i,
  /^[A-Za-z]:\\Program Files( \(x86\))?$/i,
  /^[A-Za-z]:\\ProgramData$/i,
  /^[A-Za-z]:\\Users$/i,
  /^[A-Za-z]:\\Users\\[^\\]+$/i,
  /^[A-Za-z]:\\\$Recycle\.Bin/i,
  /^[A-Za-z]:\\System Volume Information/i,
];

/**
 * Check a set of paths before deleting anything.
 *
 * The depth rule guards against a pattern typo — a scan for "node_modules"
 * should never offer to delete a top-level directory. Cache packs are not
 * pattern matches but specific named paths, and several real stores do live
 * at a drive root (D:\.pnpm-store), so that check is waivable. The
 * protected-path list is not.
 *
 * @param {string[]} paths
 * @param {{requireDepth?: boolean}} opts
 * @returns {{allowed: string[], refused: Array<{path: string, reason: string}>}}
 */
export function screenPaths(paths, { requireDepth = true } = {}) {
  const allowed = [];
  const refused = [];

  for (const raw of paths) {
    const full = path.resolve(raw);

    const blocked = REFUSED.find((re) => re.test(full));
    if (blocked) {
      refused.push({ path: full, reason: "protected system path" });
      continue;
    }

    if (!requireDepth) {
      allowed.push(full);
      continue;
    }
    // Depth below the drive root. path.parse gives us the root ("C:\"), so
    // what remains is the real nesting depth — the drive letter itself must
    // not count as a segment, or "C:\node_modules" reads as depth 2.
    const { root: driveRoot } = path.parse(full);
    const depth = full
      .slice(driveRoot.length)
      .split(path.sep)
      .filter(Boolean).length;

    if (depth < 2) {
      refused.push({ path: full, reason: "too close to drive root" });
      continue;
    }
    allowed.push(full);
  }

  return { allowed, refused };
}

/**
 * Delete a set of already-screened paths, reporting progress as it goes.
 *
 * @param {string[]} paths already screened
 * @param {{permanent?: boolean,
 *          onProgress?: (n: {done: number, total: number, path: string,
 *                            ok: boolean, error?: string}) => void}} opts
 * @returns {Promise<Array<{path: string, ok: boolean, error?: string}>>}
 */
export async function zapPaths(paths, { permanent = false, onProgress } = {}) {
  const report = (result, done) => {
    onProgress?.({ ...result, done, total: paths.length });
    return result;
  };

  if (permanent) return removeAll(paths, report);
  return recycleAll(paths, report);
}

/**
 * Permanent delete.
 *
 * fs.rm does the work in-process, so this is bounded by disk rather than by
 * process startup. A few run at once — a node_modules tree is many small
 * unlinks, and overlapping them keeps the drive busy — but not so many that
 * they thrash.
 */
async function removeAll(paths, report) {
  const results = [];
  let done = 0;

  for (const batch of chunk(paths, 4)) {
    const settled = await Promise.all(
      batch.map(async (target) => {
        try {
          // force:true would swallow a missing path and report success.
          // The recycle path reports "not found" for that, and the UI drops
          // rows on success, so both must agree or a stale row vanishes
          // without explanation.
          await fsp.rm(target, { recursive: true });
          return { path: target, ok: true };
        } catch (err) {
          const error = err.code === "ENOENT" ? "not found" : err.message;
          return { path: target, ok: false, error };
        }
      }),
    );
    for (const result of settled) results.push(report(result, ++done));
  }

  return results;
}

/**
 * Recycle Bin delete.
 *
 * Every path goes through a single PowerShell process. Spawning one per
 * folder costs ~200ms of interpreter startup each, which for a few hundred
 * folders dominates the actual work.
 *
 * Paths reach the script through stdin rather than the command line: a
 * command line is capped near 32k characters, and a few hundred deep paths
 * exceed that. stdin has no such limit and needs no quoting.
 */
async function recycleAll(paths, report) {
  const byPath = new Map(paths.map((p) => [p.toLowerCase(), p]));
  const results = [];
  let done = 0;

  await new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", RECYCLE_SCRIPT],
      { windowsHide: true },
    );

    let out = "";
    let errText = "";

    child.stdout.on("data", (data) => {
      out += data;
      const lines = out.split("\n");
      out = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let note;
        try {
          note = JSON.parse(trimmed);
        } catch {
          continue; // stray output; the script only emits JSON lines
        }

        // Trust our own path list over whatever came back on the pipe.
        const original = byPath.get(String(note.path ?? "").toLowerCase());
        if (!original) continue;

        results.push(
          report(
            note.ok
              ? { path: original, ok: true }
              : { path: original, ok: false, error: note.error ?? "failed" },
            ++done,
          ),
        );
      }
    });

    child.stderr.on("data", (data) => {
      errText += data;
    });

    child.on("error", reject);
    child.on("close", () => {
      // Anything the script never reported on did not get deleted.
      for (const target of paths) {
        if (!results.some((r) => r.path === target)) {
          results.push(
            report(
              {
                path: target,
                ok: false,
                error: errText.trim() || "no result reported",
              },
              ++done,
            ),
          );
        }
      }
      resolve();
    });

    child.stdin.write(paths.join("\n"));
    child.stdin.end();
  });

  return results;
}

/**
 * Reads one path per line from stdin, sends each to the Recycle Bin, and
 * writes one JSON result line per path.
 *
 * InvokeVerb queues the shell operation and returns before it completes, so
 * each delete is confirmed by waiting for the path to disappear.
 */
const RECYCLE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject Shell.Application
$folders = @{}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $target = $line.Trim()
  if ($target -eq '') { continue }

  $result = @{ path = $target; ok = $false; error = $null }

  try {
    if (-not (Test-Path -LiteralPath $target)) {
      throw 'not found'
    }

    $parent = Split-Path -Parent $target
    $leaf   = Split-Path -Leaf   $target

    # One NameSpace per directory, reused across its children.
    if (-not $folders.ContainsKey($parent)) {
      $folders[$parent] = $shell.NameSpace($parent)
    }
    $folder = $folders[$parent]
    if ($null -eq $folder) { throw "cannot open parent: $parent" }

    $item = $folder.ParseName($leaf)
    if ($null -eq $item) { throw "cannot find item: $leaf" }

    $item.InvokeVerb('delete')

    $waited = 0
    while ((Test-Path -LiteralPath $target) -and $waited -lt 60000) {
      Start-Sleep -Milliseconds 50
      $waited += 50
    }
    if (Test-Path -LiteralPath $target) { throw 'timed out' }

    $result.ok = $true
  } catch {
    $result.error = $_.Exception.Message
  }

  [Console]::Out.WriteLine((ConvertTo-Json $result -Compress))
  [Console]::Out.Flush()
}
`;

function* chunk(items, size) {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}
