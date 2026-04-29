import { Handle, Position } from "@xyflow/react";
import type { FuncNode } from "../types";

const COLORS = {
  main: { bg: "#1e1b4b", border: "#6366f1", accent: "#818cf8" },
  fn:   { bg: "#0c2540", border: "#0ea5e9", accent: "#38bdf8" },
};

export function FunctionNodeComponent({ data }: { data: FuncNode }) {
  const c = data.label === "main" ? COLORS.main : COLORS.fn;

  return (
    <div
      style={{
        background: c.bg,
        border: `1.5px solid ${c.border}`,
        borderRadius: 10,
        minWidth: 160,
        maxWidth: 240,
        fontFamily: "monospace",
        fontSize: 12,
        color: "#e2e8f0",
        boxShadow: `0 0 0 1px ${c.border}22`,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: c.accent, border: "none" }} />

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
          {data.label}
        </span>
        <span style={{ color: "#475569", fontSize: 10 }}>func</span>
      </div>

      {/* Params & returns */}
      <div style={{ padding: "6px 12px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
        {(data.params ?? []).length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {data.params.map((p) => (
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
        {(data.returns ?? []).length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ color: "#475569", fontSize: 10 }}>→</span>
            {data.returns.map((r) => (
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
