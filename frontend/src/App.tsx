import { useState, useCallback, useMemo, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  MarkerType,
} from "@xyflow/react";
import type { Connection, Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Graph, PackageNode, FuncNode } from "./types";
import { PackageNodeComponent } from "./components/PackageNode";
import { FunctionNodeComponent } from "./components/FunctionNode";
import { DetailPanel } from "./components/DetailPanel";
import { FunctionDetailPanel } from "./components/FunctionDetailPanel";

const NODE_TYPES = {
  packageNode: PackageNodeComponent,
  functionNode: FunctionNodeComponent,
};

function graphToFlow(graph: Graph): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = (graph.nodes ?? []).map((n) => ({
    id: n.id,
    type: "packageNode",
    position: n.position,
    data: { ...n },
  }));

  const edges: Edge[] = (graph.edges ?? []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#475569" },
    style: { stroke: "#475569" },
    labelStyle: { fill: "#94a3b8", fontSize: 11 },
    labelBgStyle: { fill: "#0f172a" },
  }));

  return { nodes, edges };
}

// --- Saved positions (localStorage) ---
const FUNC_POS_KEY = "goflow:func-positions";

type SavedPositions = Record<string, { x: number; y: number }>;

function loadFuncPositions(): SavedPositions {
  try { return JSON.parse(localStorage.getItem(FUNC_POS_KEY) ?? "{}"); }
  catch { return {}; }
}

function persistFuncPositions(pos: SavedPositions) {
  localStorage.setItem(FUNC_POS_KEY, JSON.stringify(pos));
}
// ----------------------------------------

function funcGraphToFlow(
  graph: Graph,
  savedPos: SavedPositions = {}
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = (graph.functionNodes ?? []).map((n) => ({
    id: n.id,
    type: "functionNode",
    position: savedPos[n.id] ?? n.position,
    data: { ...n },
  }));

  const edges: Edge[] = (graph.functionEdges ?? []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#38bdf8" },
    style: { stroke: "#38bdf8" },
    labelStyle: { fill: "#7dd3fc", fontSize: 11 },
    labelBgStyle: { fill: "#0c2540" },
  }));

  return { nodes, edges };
}

type Mode = "project" | "file";
type ViewMode = "package" | "function";

export default function App() {
  const [mode, setMode] = useState<Mode>("project");
  const [viewMode, setViewMode] = useState<ViewMode>("package");
  const [currentGraph, setCurrentGraph] = useState<Graph | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedNode, setSelectedNode] = useState<PackageNode | null>(null);
  const [selectedFuncNode, setSelectedFuncNode] = useState<FuncNode | null>(null);
  const [funcPositions, setFuncPositions] = useState<SavedPositions>(loadFuncPositions);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const applyGraph = useCallback(
    (graph: Graph, vm: ViewMode = "package", savedPos?: SavedPositions) => {
      setCurrentGraph(graph);
      const pos = savedPos ?? funcPositions;
      const { nodes: n, edges: e } =
        vm === "function" ? funcGraphToFlow(graph, pos) : graphToFlow(graph);
      setNodes(n);
      setEdges(e);
    },
    [setNodes, setEdges, funcPositions]
  );

  const analyze = useCallback(async () => {
    if (!pathInput.trim()) return;
    setLoading(true);
    setError("");
    setSelectedNode(null);
    setSelectedFuncNode(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathInput.trim() }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      setViewMode("package");
      applyGraph(await res.json(), "package");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [pathInput, applyGraph]);

  const analyzeFiles = useCallback(
    async (files: File[]) => {
      const goFiles = files.filter((f) => f.name.endsWith(".go"));
      if (goFiles.length === 0) return;

      setLoading(true);
      setError("");
      setSelectedNode(null);

      const formData = new FormData();
      goFiles.forEach((f) => formData.append("file", f));

      try {
        const res = await fetch("/api/analyze-file", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }

        setViewMode("package");
        applyGraph(await res.json(), "package");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [applyGraph]
  );

  // Merge newly picked files with existing, deduplicate by name
  const addFiles = useCallback((incoming: File[]) => {
    const goFiles = incoming.filter((f) => f.name.endsWith(".go"));
    if (goFiles.length === 0) return;
    setSelectedFiles((prev) => {
      const existingNames = new Set(prev.map((f) => f.name));
      return [...prev, ...goFiles.filter((f) => !existingNames.has(f.name))];
    });
  }, []);

  const removeFile = useCallback((name: string) => {
    setSelectedFiles((prev) => prev.filter((f) => f.name !== name));
  }, []);

  // Re-analyze whenever the file list changes (add or remove)
  useEffect(() => {
    if (mode !== "file") return;
    if (selectedFiles.length === 0) {
      setNodes([]);
      setEdges([]);
      setCurrentGraph(null);
      return;
    }
    analyzeFiles(selectedFiles);
  }, [selectedFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      addFiles(files);
      e.target.value = ""; // reset so same file can be re-picked
    },
    [addFiles]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      addFiles(Array.from(e.dataTransfer.files));
    },
    [addFiles]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === "functionNode") {
      setSelectedFuncNode(node.data as unknown as FuncNode);
      setSelectedNode(null);
    } else {
      setSelectedNode(node.data as unknown as PackageNode);
      setSelectedFuncNode(null);
    }
  }, []);

  const onNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type !== "functionNode") return;
    setFuncPositions((prev) => {
      const next = { ...prev, [node.id]: node.position };
      persistFuncPositions(next);
      return next;
    });
  }, []);

  const stats = useMemo(() => {
    const entrypoints = nodes.filter((n) => (n.data as any).type === "entrypoint").length;
    const packages = nodes.filter((n) => (n.data as any).type === "package").length;
    return { entrypoints, packages, edges: edges.length };
  }, [nodes, edges]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setViewMode("package");
    setCurrentGraph(null);
    setError("");
    setSelectedNode(null);
    setSelectedFuncNode(null);
    setNodes([]);
    setEdges([]);
    setSelectedFiles([]);
  };

  const switchViewMode = (vm: ViewMode) => {
    if (!currentGraph) return;
    setViewMode(vm);
    setSelectedNode(null);
    setSelectedFuncNode(null);
    const { nodes: n, edges: e } =
      vm === "function" ? funcGraphToFlow(currentGraph, funcPositions) : graphToFlow(currentGraph);
    setNodes(n);
    setEdges(e);
  };

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#020617", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div
        style={{
          padding: "12px 24px",
          background: "#0f172a",
          borderBottom: "1px solid #1e293b",
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexShrink: 0,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 18, color: "#7dd3fc", letterSpacing: -0.5 }}>
          GoFlow
        </div>
        <div style={{ color: "#475569", fontSize: 13 }}>Go Data Flow Visualizer</div>

        <div style={{ flex: 1 }} />

        {/* Mode tabs */}
        <div
          style={{
            display: "flex",
            background: "#1e293b",
            borderRadius: 8,
            padding: 3,
            gap: 2,
          }}
        >
          <ModeTab label="Project" active={mode === "project"} onClick={() => switchMode("project")} />
          <ModeTab label="Go Files" active={mode === "file"} onClick={() => switchMode("file")} />
        </div>

        {mode === "project" ? (
          <>
            <input
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && analyze()}
              placeholder="Path to Go project (e.g. C:/myproject)"
              style={{
                background: "#1e293b",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "8px 14px",
                color: "#f1f5f9",
                fontSize: 13,
                width: 320,
                outline: "none",
              }}
            />
            <button
              onClick={analyze}
              disabled={loading || !pathInput.trim()}
              style={{
                background: loading ? "#334155" : "#6366f1",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "8px 20px",
                fontWeight: 600,
                fontSize: 13,
                cursor: loading ? "not-allowed" : "pointer",
                transition: "background 0.2s",
              }}
            >
              {loading ? "Analyzing..." : "Analyze"}
            </button>
          </>
        ) : (
          <>
            <label
              style={{
                background: loading ? "#334155" : "#0ea5e9",
                color: "#fff",
                borderRadius: 8,
                padding: "8px 20px",
                fontWeight: 600,
                fontSize: 13,
                cursor: loading ? "not-allowed" : "pointer",
                transition: "background 0.2s",
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexShrink: 0,
                userSelect: "none",
              }}
            >
              <input
                type="file"
                multiple
                // @ts-ignore
                webkitdirectory=""
                onChange={handleFileChange}
                disabled={loading}
                style={{ display: "none" }}
              />
              <span style={{ fontSize: 15 }}>📂</span>
              {loading ? "Analyzing..." : selectedFiles.length === 0 ? "Choose .go files" : "Add more files"}
            </label>
            {selectedFiles.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", maxWidth: 480 }}>
                {selectedFiles.map((f) => (
                  <span
                    key={f.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      color: "#7dd3fc",
                      fontSize: 12,
                      background: "#0c2540",
                      border: "1px solid #1e4a7a",
                      borderRadius: 5,
                      padding: "3px 6px 3px 8px",
                      maxWidth: 180,
                    }}
                    title={f.name}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.name}
                    </span>
                    <button
                      onClick={() => removeFile(f.name)}
                      disabled={loading}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#475569",
                        cursor: loading ? "not-allowed" : "pointer",
                        padding: 0,
                        fontSize: 13,
                        lineHeight: 1,
                        flexShrink: 0,
                      }}
                      title={`Remove ${f.name}`}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Stats bar */}
      {nodes.length > 0 && (
        <div
          style={{
            padding: "6px 24px",
            background: "#0f172a",
            borderBottom: "1px solid #1e293b",
            display: "flex",
            alignItems: "center",
            gap: 24,
            fontSize: 12,
            color: "#64748b",
            flexShrink: 0,
          }}
        >
          <StatBadge label="entrypoints" value={stats.entrypoints} color="#6366f1" />
          <StatBadge label="packages" value={stats.packages} color="#0ea5e9" />
          <StatBadge label="edges" value={stats.edges} color="#475569" />

          <div style={{ flex: 1 }} />

          {/* View mode toggle */}
          {currentGraph && (currentGraph.functionNodes ?? []).length > 0 && (
            <div style={{ display: "flex", background: "#1e293b", borderRadius: 7, padding: 2, gap: 2 }}>
              <ViewTab label="Package" active={viewMode === "package"} onClick={() => switchViewMode("package")} />
              <ViewTab label="Function" active={viewMode === "function"} onClick={() => switchViewMode("function")} />
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            background: "#450a0a",
            border: "1px solid #7f1d1d",
            color: "#fca5a5",
            padding: "10px 24px",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* Canvas */}
      <div
        style={{ flex: 1, position: "relative" }}
        onDragOver={(e) => mode === "file" && e.preventDefault()}
        onDrop={(e) => mode === "file" && handleDrop(e)}
      >
        {nodes.length === 0 && !loading && !error && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: "#334155",
              gap: 12,
            }}
          >
            <div style={{ fontSize: 48 }}>{mode === "file" ? "📄" : "⬡"}</div>
            {mode === "project" ? (
              <>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Enter a Go project path to visualize its data flow</div>
                <div style={{ fontSize: 13 }}>Auto-detects func main as entry point · Groups by package</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Choose .go files to visualize their data flow</div>
                <div style={{ fontSize: 13 }}>Click "Choose .go files" above · Or drag & drop multiple .go files here</div>
              </>
            )}
          </div>
        )}

        {loading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(2,6,23,0.6)",
              zIndex: 10,
              color: "#7dd3fc",
              fontSize: 15,
              fontWeight: 600,
              gap: 10,
            }}
          >
            <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
            Analyzing...
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onNodeDragStop={onNodeDragStop}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          colorMode="dark"
        >
          <Background color="#1e293b" gap={24} />
          <Controls />
          <MiniMap
            nodeColor={(n) => {
              const t = (n.data as any)?.type;
              if (t === "entrypoint") return "#6366f1";
              if (t === "external") return "#475569";
              return "#0ea5e9";
            }}
            style={{ background: "#0f172a", border: "1px solid #1e293b" }}
          />
        </ReactFlow>

        <DetailPanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
        <FunctionDetailPanel
          node={selectedFuncNode}
          onClose={() => setSelectedFuncNode(null)}
        />
      </div>
    </div>
  );
}

function ViewTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? "#334155" : "transparent",
        color: active ? "#7dd3fc" : "#64748b",
        border: "none",
        borderRadius: 5,
        padding: "4px 10px",
        fontSize: 11,
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        transition: "all 0.15s",
      }}
    >
      {label}
    </button>
  );
}

function ModeTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? "#334155" : "transparent",
        color: active ? "#f1f5f9" : "#64748b",
        border: "none",
        borderRadius: 6,
        padding: "5px 12px",
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        transition: "all 0.15s",
      }}
    >
      {label}
    </button>
  );
}

function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
      <span style={{ color: "#94a3b8", fontWeight: 600 }}>{value}</span>
      <span>{label}</span>
    </span>
  );
}
