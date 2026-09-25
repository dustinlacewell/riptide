/**
 * Tests for the shipped actions: what they detect and the exact commands
 * they would run. Every process is a fake; every path is a temp dir.
 *
 *   node --test plugin/actions/actions.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createFakeSpawn } from "./fakeSpawn.js";
import pnpmStorePrune from "./pnpm-store-prune.js";
import dockerBuilderPrune from "./docker-builder-prune.js";
import dockerImagePrune from "./docker-image-prune.js";
import wslCompact, {
  compactScript,
  detachScript,
  diskPathProblem,
  dockerDesktopRunning,
  findDisks,
  isSafeDiskPath,
} from "./wsl-compact.js";
import { runAction, runStep } from "./run.js";
import windowsComponentCleanup from "./windows-component-cleanup.js";
import { findDocker, parseDockerSize } from "./docker.js";

async function tempDir(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "riptide-actions-"));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function touch(file) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, "");
}

const argvOf = (steps) => steps.map(({ exe, args }) => [exe, ...args]);

// --- pnpm ------------------------------------------------------------------

test("pnpm: through pnpm.exe, one prune per store that exists", async (t) => {
  const root = await tempDir(t);
  const bin = path.join(root, "bin");
  const local = path.join(root, "local");
  const reported = path.join(root, "drive", ".pnpm-store");
  await touch(path.join(bin, "pnpm.exe"));
  await fsp.mkdir(path.join(local, "pnpm", "store"), { recursive: true });
  await fsp.mkdir(path.join(reported, "v10"), { recursive: true });

  const fake = createFakeSpawn((exe, args) =>
    args.join(" ") === "store path" ? { stdout: [`${reported}\\v10\r\n`] } : { code: 1 },
  );
  const ctx = { env: { PATH: bin, LOCALAPPDATA: local }, spawn: fake.spawn, drives: [] };

  assert.deepEqual(await pnpmStorePrune.detect(ctx), { available: true, bytes: null });
  const pnpm = path.join(bin, "pnpm.exe");
  assert.deepEqual(argvOf(await pnpmStorePrune.steps(ctx)), [
    [pnpm, "store", "prune", "--store-dir", reported],
    [pnpm, "store", "prune", "--store-dir", path.join(local, "pnpm", "store")],
  ]);
  // Probes only ever ask where the store is.
  assert.ok(fake.calls.every((c) => c.args.join(" ") === "store path"));
});

test("pnpm: a pnpm.cmd shim runs pnpm's script under node, never the .cmd", async (t) => {
  const root = await tempDir(t);
  const bin = path.join(root, "npm");
  const local = path.join(root, "local");
  await touch(path.join(bin, "pnpm.cmd"));
  await touch(path.join(bin, "node_modules", "pnpm", "bin", "pnpm.cjs"));
  await fsp.mkdir(path.join(local, "pnpm-store"), { recursive: true });

  const fake = createFakeSpawn(() => ({ code: 1 }));
  const ctx = { env: { PATH: bin, LOCALAPPDATA: local }, spawn: fake.spawn, drives: [] };
  const steps = await pnpmStorePrune.steps(ctx);
  const script = path.join(bin, "node_modules", "pnpm", "bin", "pnpm.cjs");
  assert.deepEqual(argvOf(steps), [
    [process.execPath, script, "store", "prune", "--store-dir", path.join(local, "pnpm-store")],
  ]);
  assert.equal(steps[0].label, `pnpm store prune --store-dir ${path.join(local, "pnpm-store")}`);
  assert.ok(fake.calls.every((c) => !/\.cmd$/i.test(c.exe)));
});

test("pnpm: unavailable without pnpm, or without a store", async (t) => {
  const root = await tempDir(t);
  const fake = createFakeSpawn();
  const none = await pnpmStorePrune.detect({ env: { PATH: "", LOCALAPPDATA: root }, spawn: fake.spawn });
  assert.deepEqual(none, { available: false, reason: "pnpm not found", bytes: null });

  await touch(path.join(root, "bin", "pnpm.exe"));
  const noStore = await pnpmStorePrune.detect({
    env: { PATH: path.join(root, "bin"), LOCALAPPDATA: root },
    spawn: createFakeSpawn(() => ({ code: 1 })).spawn,
    drives: [],
  });
  assert.equal(noStore.available, false);
  assert.equal(noStore.reason, "no pnpm store found");
});

// --- docker ----------------------------------------------------------------

function dockerCtx(bin, respond) {
  const fake = createFakeSpawn(respond);
  return { fake, ctx: { env: { PATH: bin, ProgramFiles: path.join(bin, "none") }, spawn: fake.spawn } };
}

const DF = [
  '{"Active":"2","Reclaimable":"1.5GB (30%)","Size":"5GB","TotalCount":"9","Type":"Images"}\n',
  '{"Active":"0","Reclaimable":"812.4MB","Size":"812.4MB","TotalCount":"40","Type":"Build Cache"}\n',
];

test("docker builder: bytes from df's build-cache reclaimable; exact argv", async (t) => {
  const bin = await tempDir(t);
  await touch(path.join(bin, "docker.exe"));
  const { fake, ctx } = dockerCtx(bin, () => ({ stdout: DF }));

  assert.deepEqual(await dockerBuilderPrune.detect(ctx), { available: true, bytes: "812400000" });
  assert.deepEqual(fake.calls[0].args, ["system", "df", "--format", "json"]);
  assert.deepEqual(argvOf(await dockerBuilderPrune.steps(ctx)), [
    [path.join(bin, "docker.exe"), "builder", "prune", "-f"],
  ]);
});

test("docker builder: unparseable df gives unknown bytes, not zero", async (t) => {
  const bin = await tempDir(t);
  await touch(path.join(bin, "docker.exe"));
  const { ctx } = dockerCtx(bin, () => ({ stdout: ["not json\n"] }));
  assert.deepEqual(await dockerBuilderPrune.detect(ctx), { available: true, bytes: null });
});

test("docker image: dangling only, bytes unknown", async (t) => {
  const bin = await tempDir(t);
  await touch(path.join(bin, "docker.exe"));
  const { ctx } = dockerCtx(bin, () => ({ stdout: DF }));
  assert.deepEqual(await dockerImagePrune.detect(ctx), { available: true, bytes: null });
  assert.deepEqual(argvOf(await dockerImagePrune.steps(ctx)), [
    [path.join(bin, "docker.exe"), "image", "prune", "-f"],
  ]);
});

test("docker: unavailable without the CLI, or with the daemon down", async (t) => {
  const bin = await tempDir(t);
  const missing = dockerCtx(bin, () => ({ code: 0 }));
  assert.deepEqual(await dockerBuilderPrune.detect(missing.ctx), {
    available: false,
    reason: "Docker not installed",
    bytes: null,
  });
  assert.equal(missing.fake.calls.length, 0);

  await touch(path.join(bin, "docker.exe"));
  const down = dockerCtx(bin, () => ({ code: 1, stderr: ["error during connect\n"] }));
  const result = await dockerImagePrune.detect(down.ctx);
  assert.equal(result.available, false);
  assert.equal(result.reason, "Docker is not running");
});

test("docker: the installed CLI under Program Files wins over PATH", async () => {
  const installed = "C:\\PF\\Docker\\Docker\\resources\\bin\\docker.exe";
  const planted = "C:\\early\\docker.exe";
  const env = { PATH: "C:\\early", ProgramFiles: "C:\\PF" };

  const both = new Set([installed, planted]);
  assert.equal(await findDocker(env, { isFile: async (p) => both.has(p) }), installed);

  const pathOnly = new Set([planted]);
  assert.equal(await findDocker(env, { isFile: async (p) => pathOnly.has(p) }), planted);
});

test("docker sizes: decimal units, percentages ignored, junk is null", () => {
  assert.equal(parseDockerSize("0B"), "0");
  assert.equal(parseDockerSize("12.5kB"), "12500");
  assert.equal(parseDockerSize("1.5GB (30%)"), "1500000000");
  assert.equal(parseDockerSize("2TB"), "2000000000000");
  assert.equal(parseDockerSize("lots"), null);
  assert.equal(parseDockerSize(undefined), null);
});

// --- wsl -------------------------------------------------------------------

async function wslMachine(t) {
  const root = await tempDir(t);
  const local = path.join(root, "local");
  const sys = path.join(root, "win");
  const distro = path.join(local, "Packages", "Canonical.Ubuntu_x", "LocalState", "ext4.vhdx");
  const docker = path.join(local, "Docker", "wsl", "disk", "docker_data.vhdx");
  await touch(distro);
  await touch(docker);
  await touch(path.join(local, "Packages", "Other.App", "LocalState", "settings.dat"));
  await touch(path.join(local, "Docker", "wsl", "disk", "notes.txt"));
  await touch(path.join(sys, "System32", "wsl.exe"));
  await touch(path.join(sys, "System32", "diskpart.exe"));
  const env = { LOCALAPPDATA: local, SystemRoot: sys };
  return { root, env, distro, docker, sys };
}

test("wsl: finds distro and Docker disks, nothing else", async (t) => {
  const { env, distro, docker } = await wslMachine(t);
  assert.deepEqual((await findDisks(env)).sort(), [distro, docker].sort());
});

test("wsl: shutdown first, then diskpart per disk, commands on stdin", async (t) => {
  const { env, distro, docker, sys } = await wslMachine(t);
  const ctx = { env, spawn: createFakeSpawn().spawn };

  assert.deepEqual(await wslCompact.detect(ctx), { available: true, bytes: null });

  const steps = await wslCompact.steps(ctx);
  assert.deepEqual(argvOf(steps.slice(0, 1)), [[path.join(sys, "System32", "wsl.exe"), "--shutdown"]]);

  const compacts = steps.slice(1);
  assert.equal(compacts.length, 2);
  const disks = [];
  for (const step of compacts) {
    assert.equal(step.exe, path.join(sys, "System32", "diskpart.exe"));
    assert.deepEqual(step.args, [], "no script file argument");
    assert.equal(step.writes, undefined);
    const disk = /select vdisk file="([^"]+)"/.exec(step.stdin)[1];
    disks.push(disk);
    assert.equal(step.stdin, compactScript(disk));
    assert.ok(step.failPattern.test("Virtual Disk Service error:"));
    assert.equal(step.critical, true);
  }
  assert.deepEqual(disks.sort(), [distro, docker].sort());
});

test("wsl: a failed, killed or timed-out compact is followed by a detach", async (t) => {
  const { env, sys } = await wslMachine(t);
  const diskpart = path.join(sys, "System32", "diskpart.exe");
  const steps = await wslCompact.steps({ env });
  const compact = steps[1];
  const disk = /select vdisk file="([^"]+)"/.exec(compact.stdin)[1];

  // diskpart's own error line, exit 0.
  const failing = createFakeSpawn((exe, args) => ({
    stdout: exe === diskpart && args.length === 0 ? ["Virtual Disk Service error:\r\n"] : [],
  }));
  const failed = await runStep(compact, { spawn: failing.spawn });
  assert.equal(failed.ok, false);
  assert.equal(failing.calls.length, 2);
  assert.equal(failing.calls[1].exe, diskpart);
  assert.equal(failing.calls[1].stdin, `select vdisk file="${disk}"\r\ndetach vdisk noerr\r\nexit\r\n`);
  assert.equal(failing.calls[1].stdin, detachScript(disk));

  // A hang past the timeout: killed, then detached.
  let spawned = 0;
  const hanging = createFakeSpawn(() => (spawned++ === 0 ? { hang: true } : { code: 0 }));
  // A compact is critical and never timed out by us; a kill from outside
  // looks the same to the cleanup, so the timeout stands in for it here.
  const timed = await runStep({ ...compact, critical: false, timeoutMs: 10 }, { spawn: hanging.spawn });
  assert.match(timed.error, /timed out/);
  assert.equal(hanging.calls[0].killed, true);
  assert.equal(hanging.calls[1].stdin, detachScript(disk));

  // Success: no detach.
  const fine = createFakeSpawn();
  assert.equal((await runStep(compact, { spawn: fine.spawn })).ok, true);
  assert.equal(fine.calls.length, 1);
});

const DESKTOP_ROW = '"Docker Desktop.exe","14812","Console","1","182,344 K"\r\n';
const NO_TASKS = "INFO: No tasks are running which match the specified criteria.\r\n";

test("wsl: unavailable while Docker Desktop runs; asked through System32 tasklist", async (t) => {
  const { env, sys } = await wslMachine(t);
  const fake = createFakeSpawn(() => ({ stdout: [DESKTOP_ROW] }));
  assert.deepEqual(await wslCompact.detect({ env, spawn: fake.spawn }), {
    available: false,
    reason: "Quit Docker Desktop first.",
    bytes: null,
  });
  assert.deepEqual(fake.calls.map((c) => [c.exe, ...c.args]), [
    [path.join(sys, "System32", "tasklist.exe"), "/FI", "IMAGENAME eq Docker Desktop.exe", "/FO", "CSV", "/NH"],
  ]);

  const failing = createFakeSpawn(() => ({ code: 1 }));
  const unsure = await wslCompact.detect({ env, spawn: failing.spawn });
  assert.equal(unsure.reason, "could not check for Docker Desktop");

  assert.equal(dockerDesktopRunning([NO_TASKS]), false);
  assert.equal(dockerDesktopRunning(['"Docker Desktop Helper.exe","1"']), false);
});

test("wsl: Docker Desktop started after the scan refuses the run before any step", async (t) => {
  const { env, sys } = await wslMachine(t);
  const tasklist = path.join(sys, "System32", "tasklist.exe");
  const fake = createFakeSpawn((exe) => (exe === tasklist ? { stdout: [DESKTOP_ROW] } : { code: 0 }));
  const result = await runAction(wslCompact, { env, spawn: fake.spawn });
  assert.deepEqual(result, { id: "wsl-compact", ok: false, error: "Quit Docker Desktop first." });
  assert.deepEqual(fake.calls.map((c) => c.exe), [tasklist], "no shutdown, no diskpart");
});

test("wsl: one disk failing does not skip the others; each reports a line", async (t) => {
  const { env, sys } = await wslMachine(t);
  const diskpart = path.join(sys, "System32", "diskpart.exe");
  let compacts = 0;
  const fake = createFakeSpawn((exe, args) => {
    if (exe.endsWith("tasklist.exe")) return { stdout: [NO_TASKS] };
    if (exe === diskpart && args.length === 0) {
      // The first compact fails; its detach cleanup and the second compact follow.
      return compacts++ === 0 ? { stdout: ["DiskPart has encountered an error: in use\r\n"] } : { code: 0 };
    }
    return { code: 0 };
  });
  const lines = [];
  const result = await runAction(wslCompact, { env, spawn: fake.spawn }, { onLine: (n) => lines.push(n.line) });

  assert.deepEqual(result, { id: "wsl-compact", ok: false, error: "1 of 2 failed" });
  const diskpartRuns = fake.calls.filter((c) => c.exe === diskpart);
  assert.equal(diskpartRuns.length, 3, "compact, its detach, then the second compact");
  assert.match(diskpartRuns[1].stdin, /detach vdisk noerr/);
  assert.match(diskpartRuns[2].stdin, /compact vdisk/);
  const verdicts = lines.filter((l) => /^diskpart: compact .*: (ok|failed)/.test(l));
  assert.equal(verdicts.length, 2);
  assert.match(verdicts[0], /: failed — DiskPart has encountered an error: in use$/);
  assert.match(verdicts[1], /: ok$/);
});

test("wsl: the stdin script is exactly the diskpart commands", () => {
  assert.equal(
    compactScript("C:\\Users\\me\\AppData\\Local\\Docker\\wsl\\disk\\docker_data.vhdx"),
    'select vdisk file="C:\\Users\\me\\AppData\\Local\\Docker\\wsl\\disk\\docker_data.vhdx"\r\n' +
      "attach vdisk readonly\r\n" +
      "compact vdisk\r\n" +
      "detach vdisk\r\n" +
      "exit\r\n",
  );
});

test("wsl: non-ASCII disk paths are refused, which covers U+0085, U+2028 and curly quotes", () => {
  for (const p of [
    "C:\\Users\\zoë\\ext4.vhdx",
    "C:\\a\\x\u0085.vhdx",
    "C:\\a\\x\u2028.vhdx",
    "C:\\a\\x\u201d.vhdx",
    "C:\\a\\x\u201c.vhdx",
  ]) {
    assert.equal(diskPathProblem(p), "path has non-ASCII characters", JSON.stringify(p));
    assert.throws(() => compactScript(p), /non-ASCII/);
  }
});

test("wsl: disk paths with quotes, line breaks, no drive or no .vhdx are refused", () => {
  const bad = [
    'C:\\a\\x".vhdx',
    "C:\\a\\x\n.vhdx",
    "C:\\a\\x.vhdx\r\ndelete volume",
    "C:\\a\\x\u0000.vhdx",
    "C:\\a\\ext4.vhd",
    "C:\\a\\ext4.vhdx.txt",
    "a\\ext4.vhdx",
    "\\\\server\\share\\ext4.vhdx",
    "C:\\a\\..\\ext4.vhdx",
    42,
  ];
  for (const p of bad) {
    assert.equal(isSafeDiskPath(p), false, JSON.stringify(p));
    assert.throws(() => compactScript(p));
  }
  assert.equal(isSafeDiskPath("D:\\wsl\\Ubuntu\\ext4.VHDX"), true);
});

test("wsl: unavailable with no disks, or without wsl.exe", async (t) => {
  const root = await tempDir(t);
  await touch(path.join(root, "System32", "wsl.exe"));
  await touch(path.join(root, "System32", "diskpart.exe"));
  const empty = await wslCompact.detect({ env: { LOCALAPPDATA: path.join(root, "none"), SystemRoot: root } });
  assert.deepEqual(empty, { available: false, reason: "no WSL disks found", bytes: null });

  const noWsl = await wslCompact.detect({ env: { LOCALAPPDATA: root, SystemRoot: path.join(root, "nowhere") } });
  assert.equal(noWsl.reason, "WSL not installed");
});

// --- dism ------------------------------------------------------------------

test("dism: exact argv from System32; unknown bytes; caution", async (t) => {
  const root = await tempDir(t);
  await touch(path.join(root, "System32", "Dism.exe"));
  const ctx = { env: { SystemRoot: root } };

  assert.deepEqual(await windowsComponentCleanup.detect(ctx), { available: true, bytes: null });
  assert.deepEqual(argvOf(await windowsComponentCleanup.steps(ctx)), [
    [path.join(root, "System32", "Dism.exe"), "/Online", "/Cleanup-Image", "/StartComponentCleanup"],
  ]);
  assert.equal(windowsComponentCleanup.risk, "caution");

  const missing = await windowsComponentCleanup.detect({ env: { SystemRoot: path.join(root, "x") } });
  assert.equal(missing.available, false);
});
