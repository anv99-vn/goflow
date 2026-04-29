import { useState, useCallback, useMemo, useRef } from "react";
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
import type { Graph, PackageNode } from "./types";
import { PackageNodeComponent } from "./components/PackageNode";
import { DetailPanel } from "./components/DetailPanel";

const NODE_TYPES = { packageNode: PackageNodeComponent };

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

type Mode = "project" | "file";

export default function App() {
  const [mode, setMode] = useState<Mode>("project");
  const [pathInput, setPathInput] = useState("");
  const [selectedFileNames, setSelectedFileNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedNode, setSelectedNode] = useState<PackageNode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const applyGraph = useCallback(
    (graph: Graph) => {
      const { nodes: n, edges: e } = graphToFlow(graph);
      setNodes(n);
      setEdges(e);
    },
    [setNodes, setEdges]
  );

  const analyze = useCallback(async () => {
    if (!pathInput.trim()) return;
    setLoading(true);
    setError("");
    setSelectedNode(null);

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

      applyGraph(await res.json());
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

        applyGraph(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [applyGraph]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) {
        setSelectedFileNames(files.map((f) => f.name));
        setNodes([]);
        setEdges([]);
        analyzeFiles(files);
      }
      // reset so same selection can be re-triggered
      e.target.value = "";
    },
    [analyzeFiles, setNodes, setEdges]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.name.endsWith(".go")
      );
      if (files.length > 0) {
        setSelectedFileNames(files.map((f) => f.name));
        setNodes([]);
        setEdges([]);
        analyzeFiles(files);
      }
    },
    [analyzeFiles, setNodes, setEdges]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node.data as unknown as PackageNode);
  }, []);

  const stats = useMemo(() => {
    const entrypoints = nodes.filter((n) => (n.data as any).type === "entrypoint").length;
    const packages = nodes.filter((n) => (n.data as any).type === "package").length;
    return { entrypoints, packages, edges: edges.length };
  }, [nodes, edges]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError("");
    setSelectedNode(null);
    setNodes([]);
    setEdges([]);
    setSelectedFileNames([]);
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
            <input
              ref={fileInputRef}
              type="file"
              accept=".go"
              multiple
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              style={{
                background: loading ? "#334155" : "#0ea5e9",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "8px 20px",
                fontWeight: 600,
                fontSize: 13,
                cursor: loading ? "not-allowed" : "pointer",
                transition: "background 0.2s",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span style={{ fontSize: 15 }}>📂</span>
              {loading ? "Analyzing..." : "Choose .go files"}
            </button>
            {selectedFileNames.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", maxWidth: 360 }}>
                {selectedFileNames.length <= 3 ? (
                  selectedFileNames.map((name) => (
                    <span
                      key={name}
                      style={{
                        color: "#7dd3fc",
                        fontSize: 12,
                        background: "#0c2540",
                        border: "1px solid #1e4a7a",
                        borderRadius: 5,
                        padding: "3px 8px",
                        maxWidth: 160,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={name}
                    >
                      {name}
                    </span>
                  ))
                ) : (
                  <span
                    style={{
                      color: "#7dd3fc",
                      fontSize: 12,
                      background: "#0c2540",
                      border: "1px solid #1e4a7a",
                      borderRadius: 5,
                      padding: "3px 10px",
                    }}
                    title={selectedFileNames.join(", ")}
                  >
                    {selectedFileNames.length} files selected
                  </span>
                )}
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
            gap: 24,
            fontSize: 12,
            color: "#64748b",
            flexShrink: 0,
          }}
        >
          <StatBadge label="entrypoints" value={stats.entrypoints} color="#6366f1" />
          <StatBadge label="packages" value={stats.packages} color="#0ea5e9" />
          <StatBadge label="edges" value={stats.edges} color="#475569" />
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
      </div>
    </div>
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
