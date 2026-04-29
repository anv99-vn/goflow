import { useState, useCallback, useMemo } from "react";
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

export default function App() {
  const [pathInput, setPathInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedNode, setSelectedNode] = useState<PackageNode | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
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

      const graph: Graph = await res.json();
      const { nodes: n, edges: e } = graphToFlow(graph);
      setNodes(n);
      setEdges(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [pathInput, setNodes, setEdges]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node.data as unknown as PackageNode);
  }, []);

  const stats = useMemo(() => {
    const entrypoints = nodes.filter((n) => (n.data as any).type === "entrypoint").length;
    const packages = nodes.filter((n) => (n.data as any).type === "package").length;
    const external = nodes.filter((n) => (n.data as any).type === "external").length;
    return { entrypoints, packages, external, edges: edges.length };
  }, [nodes, edges]);

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
            width: 340,
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
          <StatBadge label="external" value={stats.external} color="#64748b" />
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
      <div style={{ flex: 1, position: "relative" }}>
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
            <div style={{ fontSize: 48 }}>⬡</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Enter a Go project path to visualize its data flow</div>
            <div style={{ fontSize: 13 }}>Auto-detects func main as entry point · Groups by package</div>
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

function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
      <span style={{ color: "#94a3b8", fontWeight: 600 }}>{value}</span>
      <span>{label}</span>
    </span>
  );
}
