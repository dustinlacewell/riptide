/**
 * Tests for directory listing. Real directories under D:\tmp, made and
 * removed by each test — the picker's job is to survive whatever the disk
 * actually holds, which a mock cannot rehearse.
 *
 *   node --test plugin/dirs.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { execFileSync } from "node:child_process";

import { listDirs, parentOf, parseAttrib } from "./dirs.js";

const TMP = process.platform === "win32" ? "D:\\tmp" : os.tmpdir();

/** Make a scratch tree and hand back its path plus a cleanup function. */
async function scratch() {
  await fsp.mkdir(TMP, { recursive: true });
  const dir = await fsp.mkdtemp(path.join(TMP, "riptide-dirs-"));
  return [dir, () => fs.rmSync(dir, { recursive: true, force: true })];
}

const names = (result) => result.entries.map((e) => e.name);

test("lists only the immediate subdirectories", async () => {
  const [dir, clean] = await scratch();
  try {
    await fsp.mkdir(path.join(dir, "alpha", "nested"), { recursive: true });
    await fsp.mkdir(path.join(dir, "beta"));
    await fsp.writeFile(path.join(dir, "a-file.txt"), "x");

    const result = await listDirs(dir);
    assert.deepEqual(names(result), ["alpha", "beta"], "files and grandchildren are out");
  } finally {
    clean();
  }
});

test("sorts case-insensitively", async () => {
  const [dir, clean] = await scratch();
  try {
    for (const n of ["Zeta", "apple", "Banana"]) {
      await fsp.mkdir(path.join(dir, n));
    }
    assert.deepEqual(names(await listDirs(dir)), ["apple", "Banana", "Zeta"]);
  } finally {
    clean();
  }
});

test("reports the resolved absolute path and its parent", async () => {
  const [dir, clean] = await scratch();
  try {
    await fsp.mkdir(path.join(dir, "child"));
    const result = await listDirs(path.join(dir, "child", "..", "child"));
    assert.equal(result.path, path.join(dir, "child"));
    assert.equal(result.parent, dir);
  } finally {
    clean();
  }
});

test("each entry carries its full path", async () => {
  const [dir, clean] = await scratch();
  try {
    await fsp.mkdir(path.join(dir, "one"));
    const [entry] = (await listDirs(dir)).entries;
    assert.equal(entry.path, path.join(dir, "one"));
  } finally {
    clean();
  }
});

test("a drive root has no parent", async () => {
  const root = process.platform === "win32" ? "D:\\" : "/";
  assert.equal((await listDirs(root)).parent, null);
  assert.equal(parentOf(root), null);
});

test("skips symlinks and junctions", async (t) => {
  const [dir, clean] = await scratch();
  try {
    await fsp.mkdir(path.join(dir, "real"));

    try {
      await fsp.symlink(path.join(dir, "real"), path.join(dir, "link"), "junction");
    } catch {
      clean();
      return t.skip("cannot create a junction here");
    }

    assert.deepEqual(names(await listDirs(dir)), ["real"], "a link would let the tree loop");
  } finally {
    clean();
  }
});

test("one unreadable child does not sink the listing", async (t) => {
  if (process.platform !== "win32") return t.skip("uses icacls");

  const [dir, clean] = await scratch();
  const locked = path.join(dir, "locked");

  // The deny ACE also blocks deleting the directory, so it comes off before
  // cleanup runs — otherwise the scratch tree outlives the test.
  const unlock = () => {
    try {
      execFileSync("icacls", [locked, "/reset"], { windowsHide: true, stdio: "ignore" });
      execFileSync("icacls", [locked, "/grant", `${os.userInfo().username}:(F)`], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      /* already open, or never locked */
    }
  };

  try {
    await fsp.mkdir(path.join(dir, "open"));
    await fsp.mkdir(locked);

    try {
      execFileSync("icacls", [locked, "/inheritance:r", "/deny", `${os.userInfo().username}:(F)`], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      return t.skip("cannot deny access here");
    }

    const result = await listDirs(dir);
    assert.deepEqual(names(result), ["locked", "open"], "both rows still render");

    const denied = result.entries.find((e) => e.name === "locked");
    assert.equal(denied.accessible, false, "and the unreadable one is marked");
  } finally {
    unlock();
    clean();
  }
});

test("marks hidden directories but keeps them listed", async (t) => {
  if (process.platform !== "win32") return t.skip("uses attrib");

  const [dir, clean] = await scratch();
  try {
    await fsp.mkdir(path.join(dir, "plain"));
    const secret = path.join(dir, "secret");
    await fsp.mkdir(secret);
    execFileSync("attrib", ["+H", secret], { windowsHide: true });

    const result = await listDirs(dir);
    assert.deepEqual(names(result), ["plain", "secret"], "hiding is a hint, not a filter");
    assert.equal(result.entries.find((e) => e.name === "secret").hidden, true);
    assert.equal(result.entries.find((e) => e.name === "plain").hidden, false);

    execFileSync("attrib", ["-H", secret], { windowsHide: true });
  } finally {
    clean();
  }
});

test("rejects a path that does not exist", async () => {
  const [dir, clean] = await scratch();
  try {
    await assert.rejects(
      () => listDirs(path.join(dir, "nowhere")),
      (err) => err.code === "ENOTDIR" && /no such directory/.test(err.message),
    );
  } finally {
    clean();
  }
});

test("rejects a file", async () => {
  const [dir, clean] = await scratch();
  try {
    const file = path.join(dir, "not-a-dir.txt");
    await fsp.writeFile(file, "x");
    await assert.rejects(
      () => listDirs(file),
      (err) => err.code === "ENOTDIR" && /not a directory/.test(err.message),
    );
  } finally {
    clean();
  }
});

test("an empty directory lists nothing and still reports its parent", async () => {
  const [dir, clean] = await scratch();
  try {
    const result = await listDirs(dir);
    assert.deepEqual(result.entries, []);
    assert.equal(result.parent, TMP);
  } finally {
    clean();
  }
});

// --- attrib parsing -------------------------------------------------------

test("parseAttrib: reads the hidden and system flags", () => {
  const names_ = parseAttrib(
    [
      "A  SH                C:\\DumpStack.log.tmp",
      "    H   I            C:\\ProgramData",
      "     R               C:\\Program Files",
      "                     C:\\Windows",
      "   SH                C:\\System Volume Information",
    ].join("\r\n"),
  );

  assert.deepEqual(
    [...names_].sort(),
    ["dumpstack.log.tmp", "programdata", "system volume information"],
  );
});

test("parseAttrib: an H or S in the name is not a flag", () => {
  // The flag field ends where the path begins; letters after that are name.
  const names_ = parseAttrib("                     D:\\code\\SHouty");
  assert.equal(names_.size, 0);
});

test("parseAttrib: ignores noise lines", () => {
  assert.equal(parseAttrib("Parameter format not correct -\r\n\r\n").size, 0);
});
