# Changelog

All notable changes to this project are documented here. Format follows [Conventional Commits](https://www.conventionalcommits.org/).

## 2026-04-29

### [2c91a22](https://github.com/anomalyco/goflow/commit/2c91a22) - feat: add DetailPanel UI component and implement automated development startup scripts with port management

### [8df3b24](https://github.com/anomalyco/goflow/commit/8df3b24) - feat: function detail panel, missing node detection, saved positions, syntax highlighting

#### Backend
- Add `FuncNode.Missing` field: calls to undefined functions (non-builtins) create red "missing" nodes in the function graph
- Add `goBuiltins` map to exclude append/len/make/etc. from missing detection
- Add `FuncNode.Body` field populated from go/printer for source display
- Invert layout direction: entrypoint (main) on right, dependencies on left

#### Frontend
- `FunctionDetailPanel.tsx`: click a function node to see full syntax-highlighted source code (react-syntax-highlighter with PrismLight + Go grammar)
- `FunctionNode.tsx`: red border/bg + "missing" badge for undefined functions
- `App.tsx`: save dragged node positions to localStorage per node ID; restore on re-analyze
- `types.ts`: FuncNode.body and FuncNode.missing fields

---

### [c88212d](https://github.com/anomalyco/goflow/commit/c88212d) - feat: add function-level call graph and multi-file upload improvements

#### Backend
- Add `FuncNode`/`FuncEdge` structs and `Graph.FunctionNodes`/`FunctionEdges` fields
- `buildFunctionGraph()` extracts intra-package function calls with AST argument expressions
- `exprString()` converts ast.Expr to readable strings for edge labels
- `applyFuncLayout()` BFS layout seeded from "main" functions
- `FunctionInfo.Body` field captures function source via go/printer
- `handleAnalyzeFile` groups uploaded files into per-package subdirectories for multi-package uploads
- Add `demo/` directory (main.go, sum.go, sum3.go) as test case

#### Frontend
- `FunctionNode.tsx`: new ReactFlow node component for function-level graph
- `App.tsx`: `funcGraphToFlow()` transform; Package/Function view toggle in stats bar
- `App.tsx`: `selectedFiles` state with addFiles/removeFile accumulation
- `App.tsx`: useEffect triggers re-analysis on file list change
- `types.ts`: FuncNode, FuncEdge interfaces; Graph extended with functionNodes/functionEdges

---

### [aeca9e7](https://github.com/anomalyco/goflow/commit/aeca9e7) - docs: add CLAUDE.md with project architecture and build instructions

---

### [7ffa5c1](https://github.com/anomalyco/goflow/commit/7ffa5c1) - feat: add multi-file picker, remove external nodes, update .gitignore

#### Backend
- Add `POST /api/analyze-file` endpoint that accepts multipart file uploads
- Support analyzing uploaded .go files in a temp directory

#### Frontend
- Support selecting multiple .go files at once
- Add "Go Files" mode tab alongside existing "Project" mode
- Show selected filenames as badges with remove functionality
- Support drag & drop of .go files onto the canvas
- Remove EXTERNAL nodes from the graph (stdlib/third-party deps no longer shown)

#### Other
- Expand .gitignore: Go binaries, logs, editor dirs, .env, go.work, temp dirs

---

### [f45aaaf](https://github.com/anomalyco/goflow/commit/f45aaaf) - Initial commit: GoFlow - Go source code data flow visualizer

#### Features
- Go AST analyzer: auto-detects func main, groups by package, traces data flow
- HTTP API server with embedded React frontend (Go embed)
- React Flow interactive graph: nodes, edges, detail panel, minimap
- Single binary deployment via start.bat
