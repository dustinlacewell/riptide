---
id: "server-deletes-only-paths-it-found-2026-09-25"
status: "done"
priority: "high"
assignee: null
dueDate: null
created: "2026-09-25T00:00:00.000Z"
modified: "2026-09-25T07:09:41.678Z"
completedAt: "2026-09-25T07:09:41.678Z"
labels: []
order: "a0"
---

# Server deletes only paths it found

/plan refuses any path not offered by a recent scan. System folders (Windows, Program Files, Recycle Bin, System Volume Information) are refused as whole subtrees.

Both checks live in one shared protect module.
