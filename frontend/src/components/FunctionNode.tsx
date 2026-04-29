import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { FuncNode } from "../types";

const COLORS = {
  main:    { bg: "#1e1b4b", border: "#6366f1", accent: "#818cf8" },
  fn:      { bg: "#0c2540", border: "#0ea5e9", accent: "#38bdf8" },
  missing: { bg: "#2d0a0a", border: "#dc2626", accent: "#f87171" },
};

const ACTIVE_GLOW = "#f59e0b"; // Amber glow for active (when detail panel is open)

interface FunctionNodeData extends FuncNode {
  isActive?: boolean;
  onDelete?: (id: string) => void;
}

export function FunctionNodeComponent({ data }: NodeProps) {
  const nodeData = data as unknown as FunctionNodeData;
  const c = nodeData.missing ? COLORS.missing : nodeData.label === "main" ? COLORS.main : COLORS.fn;
  const isActive = nodeData.isActive === true;

  return (
    <div
      style={{
        background: c.bg,
        border: `1.5px solid ${isActive ? ACTIVE_GLOW : c.border}`,
        borderRadius: 10,
        minWidth: 160,
        maxWidth: 240,
        fontFamily: "monospace",
        fontSize: 12,
        color: "#e2e8f0",
        boxShadow: isActive ? `0 0 16px ${ACTIVE_GLOW}88` : `0 0 0 1px ${c.border}22`,
        transition: "box-shadow 0.2s, border-color 0.2s",
        position: "relative",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: c.accent, border: "none" }} />

      {/* Delete button */}
      {nodeData.label !== "main" && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            nodeData.onDelete?.(nodeData.id);
          }}
          style={{
            position: "absolute",
            top: -8,
            right: -8,
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: "#dc2626",
            border: "2px solid #1e293b",
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
            padding: 0,
            lineHeight: 1,
          }}
          title="Delete function node"
        >
          ×
        </button>
      )}

      {/* Header */}
      <div
        style={{
          padding: "7px 12px",
          borderBottom: `1px solid ${c.border}55`,
          display: "flex",
          alignItems: "center",
          gap: 7,
        }}
      >
        <span style={{ color: c.accent, fontWeight: 700, fontSize: 13 }}>
          {nodeData.label}
        </span>
        {nodeData.missing ? (
          <span style={{ color: "#f87171", fontSize: 9, background: "#450a0a", border: "1px solid #dc2626", borderRadius: 3, padding: "1px 5px" }}>missing</span>
        ) : (
          <span style={{ color: "#475566", fontSize: 10 }}>func</span>
        )}
      </div>

      {/* Params & returns */}
      <div style={{ padding: "6px 12px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
        {(nodeData.params ?? []).length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {nodeData.params.map((p) => (
              <span
                key={p}
                style={{
                  background: "#1e293b",
                  border: "1px solid #334155",
                  borderRadius: 4,
                  padding: "1px 6px",
                  color: "#94a3b8",
                  fontSize: 10,
                }}
              >
                {p}
              </span>
            ))}
          </div>
        )}
        {(nodeData.returns ?? []).length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ color: "#475566", fontSize: 10 }}>→</span>
            {nodeData.returns.map((r) => (
              <span
                key={r}
                style={{
                  background: "#0f2027",
                  border: "1px solid #22543d",
                  borderRadius: 4,
                  padding: "1px 6px",
                  color: "#6ee7b7",
                  fontSize: 10,
                }}
              >
                {r}
              </span>
            ))}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} style={{ background: c.accent, border: "none" }} />
    </div>
  );
}
