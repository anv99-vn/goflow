# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

GoFlow is a Go source-code data-flow visualizer. A single Go binary serves a React/TypeScript SPA and two JSON APIs. Users paste a local directory path or upload `.go` files; the backend AST-parses them and returns a graph that the frontend renders as an interactive node diagram.

## Build & Run

```bat
start.bat
```

This script builds the frontend (`npm run build`), copies `frontend/dist/` → `backend/dist/`, compiles the Go binary (`goflow.exe`), and launches the app at `http://localhost:8080`.

## Development

Run the Vite dev server for frontend hot-reload. API calls (`/api/*`) must reach the Go backend, so run both:

```bash
# Terminal 1 – backend (serves APIs on :8080)
cd backend && go run .

# Terminal 2 – frontend (HMR on :5173, proxied /api to :8080 if configured)
cd frontend && npm run dev
```

> The Vite config has no proxy configured yet, so during dev the frontend dev server at `:5173` cannot reach `/api/*`. Either add a Vite proxy or work against the compiled binary.

## Lint & type-check

```bash
# Frontend
cd frontend && npm run lint          # eslint
cd frontend && npx tsc --noEmit     # type-check only (no emit)

# Backend
cd backend && go vet ./...
```

## Architecture

### Backend — `backend/`

`main.go` wires three HTTP handlers and serves the embedded SPA with a catch-all fallback to `index.html`.

| Endpoint | Purpose |
|---|---|
| `POST /api/analyze` | Body `{"path":"..."}` — analyzes a local directory |
| `POST /api/analyze-file` | Multipart upload of one or more `.go` files; written to a temp dir then analyzed |
| `GET /api/health` | Liveness check |

`analyzer/analyzer.go` is the core engine:

1. **`loadPackages`** — `filepath.WalkDir` over the root, `go/parser.ParseDir` per directory, skips `vendor`, hidden dirs, and `_test` packages.
2. **`extractFunctions`** — for each `*ast.FuncDecl`, collects cross-package call edges by matching selector-expression identifiers against the file's import map. Detects coarse data operations (`iterate`, `filter`, `transform`, `merge`, `copy`) via AST node type inspection.
3. **`Analyze`** — builds `Node` objects (one per package, typed as `entrypoint` for `package main`), then `Edge` objects only between *internal* packages (external/stdlib imports are dropped). Calls `applyLayout`.
4. **`applyLayout`** — BFS from entrypoint nodes assigns x/y positions using layered spacing (250 px horizontal, 150 px vertical).

### Frontend — `frontend/src/`

| File | Role |
|---|---|
| `types.ts` | TypeScript mirrors of the Go JSON structs (`Graph`, `PackageNode`, `FlowEdge`, `FunctionInfo`) |
| `App.tsx` | Top-level: two modes (`project` / `file`), API calls, `graphToFlow()` transform, ReactFlow canvas |
| `components/PackageNode.tsx` | Custom ReactFlow node; color-codes by type (`entrypoint`=indigo, `package`=sky, `external`=slate); shows data-op badges |
| `components/DetailPanel.tsx` | Absolute-positioned panel on right side; opens on node click; lists functions with params/returns/ops |

`graphToFlow()` in `App.tsx` maps backend `Graph` → ReactFlow `Node[]`/`Edge[]`, attaching arrow markers and label styles.

Node types flow: backend `"entrypoint" | "package" | "external"` → `TYPE_COLORS` in `PackageNode.tsx` → MiniMap color callback in `App.tsx`.

### Key constraint — embed path

`backend/main.go` embeds `dist` relative to the `backend/` directory. Vite's default `outDir` is `frontend/dist`. These are **different paths** — the copy step between them is required for `go build` to succeed with a populated SPA.
