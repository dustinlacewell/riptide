/**
 * Dev entry point.
 *
 * The MFT scan needs a raw volume handle, which Windows refuses without
 * elevation. A process cannot elevate itself in place — elevation happens
 * only at process creation — so when we start unelevated we relaunch through
 * ShellExecute's "runas" verb and hand off.
 *
 * That relaunch always creates a new console window: a child cannot inherit
 * this terminal across the elevation boundary. So the window you typed into
 * exits, and Vite's output lives in the new one.
 */

import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

if (process.platform !== "win32") {
  console.log("Not Windows — MFT scanning is unavailable. Starting Vite.");
  runVite();
} else if (isElevated()) {
  console.log("Running elevated — MFT scanning is available.\n");
  runVite();
} else {
  relaunchElevated();
}

// ---------------------------------------------------------------------------

function isElevated() {
  // `net session` needs administrator rights and touches nothing. Cheaper and
  // more reliable here than starting PowerShell to ask .NET.
  const probe = spawnSync("net", ["session"], {
    stdio: "ignore",
    windowsHide: true,
  });
  return probe.status === 0;
}

function runVite() {
  const vite = spawn(
    process.execPath,
    [path.join(projectDir, "node_modules", "vite", "bin", "vite.js")],
    { cwd: projectDir, stdio: "inherit" },
  );

  vite.on("exit", (code) => process.exit(code ?? 0));

  // Let Vite own Ctrl+C; it shuts the server down cleanly on its own.
  process.on("SIGINT", () => {});
}

function relaunchElevated() {
  console.log("Requesting administrator rights for MFT scanning…");
  console.log("Vite will open in a new window. This one will close.\n");

  // -NoExit keeps the elevated console open so Vite's output and its URL stay
  // readable. Paths go through -ArgumentList entries rather than string
  // interpolation so a space in the path cannot split the command.
  const inner = [
    "-NoExit",
    "-NoProfile",
    "-Command",
    `Set-Location -LiteralPath '${projectDir.replace(/'/g, "''")}'; ` +
      `& '${process.execPath.replace(/'/g, "''")}' ` +
      `'${path.join(projectDir, "node_modules", "vite", "bin", "vite.js").replace(/'/g, "''")}'`,
  ];

  const launcher = [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Start-Process powershell -Verb RunAs -ArgumentList " +
      inner.map((a) => `'${a.replace(/'/g, "''")}'`).join(","),
  ];

  const result = spawnSync("powershell.exe", launcher, {
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.status !== 0) {
    console.error(
      "\nElevation was declined or failed.\n" +
        "Run `npm run dev:plain` to start without it — scans fall back to a\n" +
        "directory walk, which works but is slower.",
    );
    process.exit(1);
  }
}
