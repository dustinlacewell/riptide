---
id: "clean-through-the-tool-2026-09-25"
status: "todo"
priority: "high"
assignee: null
dueDate: null
created: "2026-09-25T00:00:00.000Z"
modified: "2026-09-25T00:00:00.000Z"
completedAt: null
labels: []
order: "a1"
---

# Clean through the tool

A third delete mode. It runs a fixed command per pack, such as docker builder prune, pnpm store prune, or WSL vhdx compaction (about 19 GB here).

Commands live in code, at plugin/actions/<id>.js. They never live in pack JSON.

Plan-token and typed-count gates cover these action items too.
