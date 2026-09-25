# Cache candidates — review

Five agents surveyed this machine, developer tooling, creative apps, Windows/browsers,
and the `D:\code` tree. The unambiguous entries are already written to `packs/`
(84 total, up from 32). Everything below needs your call.

Mark each **Y** or **N** in the Verdict column. Anything marked Y I will write as a
pack entry; anything with a "needs" note also requires the work described.

---

## 1. Needs a new pack feature: `siblingFile`

The pack format's `under` field matches a **fixed parent directory name**. That works
for `.vite` under `node_modules`. It cannot express these, because the parent name
varies per project.

The agent confirmed the danger empirically: `ai/dlss5window/src/bin/*.rs` is
hand-written Rust source in a directory named `bin`.

Supporting these means adding a `siblingFile` field (glob-matched against files in the
candidate's parent directory). The MFT tree already holds the data, so this is a
filter, not a new scan.

| Dir | Identified by | Measured on this machine | Verdict |
|---|---|---|---|
| `target` (Rust) | sibling `Cargo.toml` | **19 GB** across 5 projects (7.3, 5.7, 3.4, 2.1, 0.48) | |
| `bin`, `obj` (.NET) | sibling `*.csproj` / `*.sln` / `*.fsproj` | 129 `bin`, 67 `obj`; small each | |
| `build` (CMake) | sibling `CMakeCache.txt`, or child `CMakeFiles/` | 98 instances, mixed | |
| `Debug` / `Release` | sibling `*.vcxproj` / `*.sln` | 56 instances | |
| `cmake-build-*` (CLion) | name is distinctive; wildcard match needed | 4 instances | |

**Add `siblingFile` support?** → **Verdict: ____**

If N, the 19 GB of Rust `target` stays invisible.

---

## 2. Large, safe, but expensive to restore

Regenerable, but the cost is real. I'd add these with a `caution` note rather than
silently.

| Entry | Path | Size here | Cost | Verdict |
|---|---|---|---|---|
| Ollama models | `~/.ollama` | **6.1 GB** | Re-pull each model; slow | |
| Hugging Face hub | `~/.cache/huggingface` | **1.5 GB** | Re-download weights | |
| LM Studio models | `~/.lmstudio/models` | not installed | GGUF files, 4-40 GB each | |
| TensorFlow datasets | `~/tensorflow_datasets` | not checked | Datasets, can be GB | |
| Playwright browsers | already covered | 1.5 GB | Already in packs | — |
| Vagrant boxes | `~/.vagrant.d/boxes` | not installed | Re-download base images | |
| minikube | `~/.minikube` | not installed | Re-download node images | |

---

## 3. Mixed content — cache next to real data

These directories hold both. Adding the parent path would delete settings, history, or
credentials. Each would need entries scoped to specific subfolders.

| Entry | The problem | Size here | Verdict |
|---|---|---|---|
| VS Code app data | `Cache`, `CachedData`, `logs`, `CachedExtensionVSIXs` are safe. `User/` holds settings, extensions, and **`User/History`** (local edit history — real data). | 3.2 GB | |
| Cursor app data | Same shape as VS Code; may also hold chat history | 4.0 GB | |
| Windsurf app data | Same shape | 1.1 GB | |
| JetBrains per-IDE | `caches`, `index`, `log` under each `%LOCALAPPDATA%\JetBrains\<Product><Ver>` are safe; `%APPDATA%\JetBrains` is settings | part of 7.9 GB | |
| Chrome / Edge / Brave | Only `Cache`, `Code Cache`, `GPUCache`, `Service Worker\CacheStorage` are safe. `Cookies`, `Login Data`, `Bookmarks`, `Local Storage` are **not**. | 7.7 GB Chrome | |
| Firefox | `cache2` inside a randomly-named profile dir — needs a wildcard path | not measured | |
| `.rustup` | `downloads/` is cache; `toolchains/` is installed compilers | 3.5 GB | |
| `.dotnet` | mixed; `.dotnet/tools` holds installed CLI tools | 502 MB | |
| PlatformIO | `packages`/`platforms` re-download; may hold custom board defs | 2.5 GB | |
| Vortex mod manager | `cache` is safe; `downloads` holds mod archives you may want | 1.8 GB | |
| Azure / gcloud CLI | Mostly cache, but holds **auth tokens** — deleting forces re-login | present | |

---

## 4. Needs a tool command, not file deletion

Deleting these by hand works but is the wrong mechanism.

| Entry | Right mechanism | Size here | Verdict |
|---|---|---|---|
| pnpm store | `pnpm store prune` — `node_modules` hard-link into it | 2.6 GB | |
| Docker build cache | `docker builder prune` | inside vhdx | |
| git loose objects | `git gc` / `git prune` | per-repo | |
| Windows Update download | Stop `wuauserv` first, then delete | varies | |
| Event logs | `wevtutil cl` — raw deletion can corrupt | varies | |
| Windows Search index | Safe, but triggers a long background re-index | varies | |
| Font cache | Stop "Windows Font Cache Service" first; needs admin | small | |

---

## 5. Your call — session and temp data

| Entry | Path | Size here | The catch | Verdict |
|---|---|---|---|---|
| Claude Code scratch | `%LOCALAPPDATA%\Temp\claude` | **18.1 GB** | Per-session worktrees. A running session's folder must not be touched — **this session lives here**. Largest: dlss5window 6.5 GB, meta 5.5 GB, space-game 5.4 GB. | |
| User temp | `%LOCALAPPDATA%\Temp` | varies | Files in use must be skipped | |
| System temp | `C:\Windows\Temp` | varies | Needs admin | |
| Unidentified temp dir | `%LOCALAPPDATA%\Temp\ri5lyjgg` | 2.8 GB | Unknown owner — worth looking at before anything | |
| Windows Prefetch | `C:\Windows\Prefetch` | 10-50 MB | Slows next launches, gains almost nothing | |
| Package Cache | `%LOCALAPPDATA%\Microsoft\Package Cache`, `C:\ProgramData\Package Cache` | 2.5 GB | Needed for uninstall/repair without the original installer | |

---

## 6. Creative apps — not installed here, from vendor docs

None of these exist on this machine, so paths are documented defaults rather than
verified. Worth adding for portability, or skip until you install one.

| Entry | Path | Verdict |
|---|---|---|
| Adobe media cache | `%APPDATA%\Adobe\Common\Media Cache Files` | |
| Adobe Camera Raw cache | `%LOCALAPPDATA%\Adobe\CameraRaw\Cache` | |
| Substance 3D Painter | `%LOCALAPPDATA%\Adobe\Adobe Substance 3D Painter\cache` | |
| Blender kernel cache | `%APPDATA%\Blender Foundation\Blender\<ver>\cache` | |
| Unreal DDC (global) | `%LOCALAPPDATA%\UnrealEngine\Common\DerivedDataCache` | |
| Unreal DDC (project) | `<project>/DerivedDataCache`, `<project>/Intermediate` | |
| Unity shader cache | `<project>/Library/ShaderCache` | |
| Unity Library (whole) | `<project>/Library` — safe but full reimport | |
| Godot shader cache | `<project>/.godot/shader_cache` | |
| Ableton database | `%LOCALAPPDATA%\Ableton\Live Database` | |
| Steam shader cache | `<steam>\steamapps\shadercache` — **your Steam is at `P:\steam`** | |
| Steam depot cache | `<steam>\depotcache` | |
| Epic web cache | `%LOCALAPPDATA%\EpicGamesLauncher\Saved\webcache` | |

Steam's install path is not fixed, so these need a path template or discovery step.

---

## Refused — will not add

Recorded so nobody re-proposes them.

**Look like caches, break the system:**
- `C:\Windows\WinSxS` — component store. Only `DISM /StartComponentCleanup`.
- `C:\Windows\System32\DriverStore\FileRepository` — live driver repo. Only `pnputil`.
- `C:\Windows\Installer` — MSI cache. Deleting breaks repair and uninstall.
- `C:\Windows\assembly\NativeImages_*` — NGEN cache, tracked by a service.

**Look like caches, hold the only copy:**
- Outlook `.ost` — named "offline cache"; can be the sole local copy of mail.
- WSL2 / Docker `ext4.vhdx` — an entire filesystem. **19.4 GB on this machine.**
- VirtualBox / Hyper-V VM disks.
- Android AVD images — emulator state, slow to rebuild.

**User work, not cache:**
- DaVinci `.gallery` — captured grading stills.
- Unreal `<project>/Saved` — autosaves, configs, crash logs.
- Audacity `SessionData` — recovery data for unsaved projects.
- VS Code `User/History` — local edit history.
- Browser `Cookies`, `Login Data`, `Bookmarks`, `Local Storage`.
- Steam `steamapps/common` — installed games.

**Installed software, not downloads:**
- `~/.jdks` — JDKs installed by JetBrains IDEs.
- `~/.opam`, `~/.ghcup` — compiler toolchains.
- Android SDK.

**Ambiguous names, confirmed dangerous in your tree:**
- `vendor` (24 instances) — some are committed dependency source. Go's
  `vendor/modules.txt` marks legitimate vendoring that must survive.
- `deps` (27 instances) — `cpp/yui/deps/yoga` is a checked-in library.
- `.idea` (29), `.vscode` (150) — run configs and settings.
- `coverage` — some teams commit baseline reports.
- bare `dist` (217 instances) — worth discussing separately; some projects
  commit a built `dist`.
