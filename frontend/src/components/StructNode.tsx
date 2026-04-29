import { Handle, Position } from "@xyflow/react";
import type { StructNode as StructNodeType } from "../types";

const TYPE_COLORS: Record<string, string> = {
  struct: "#a78bfa",
};

export function StructNodeComponent({ data }: { data: StructNodeType & { isActive?: boolean } }) {
  const color = TYPE_COLORS["struct"];

  return (
    <div
      style={{
        minWidth: 160,
        background: data.isActive ? "#2e1065" : "#1e1b4b",
        border: `2px solid ${data.isActive ? "#a78bfa" : "#4338ca"}`,
        borderRadius: 10,
        padding: "10px 14px",
        color: "#e0e7ff",
        fontSize: 13,
        fontWeight: 600,
        boxShadow: data.isActive ? "0 0 12px #a78bfa88" : "0 2px 8px #0003",
        transition: "all 0.2s",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: color }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>📦</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{data.label}</div>
          <div style={{ fontSize: 10, color: "#a5b4fc", fontWeight: 400 }}>struct</div>
        </div>
      </div>
      {data.fields && data.fields.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: "#c7d2fe" }}>
          {data.fields.slice(0, 3).map((f, i) => (
            <div key={i} style={{ marginBottom: 2 }}>{f}</div>
          ))}
          {data.fields.length > 3 && (
            <div style={{ color: "#818cf8", fontSize: 10 }}>+{data.fields.length - 3} more</div>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: color }} />
    </div>
  );
}
