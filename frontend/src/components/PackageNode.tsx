import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { PackageNode as PackageNodeData } from "../types";

const TYPE_COLORS: Record<string, string> = {
  entrypoint: "#6366f1",
  package: "#0ea5e9",
  external: "#64748b",
};

const OP_COLORS: Record<string, string> = {
  merge: "#f59e0b",
  transform: "#10b981",
  filter: "#ef4444",
  iterate: "#8b5cf6",
  copy: "#06b6d4",
};

export function PackageNodeComponent({ data, selected }: NodeProps) {
  const pkg = data as unknown as PackageNodeData;
  const color = TYPE_COLORS[pkg.type] ?? "#0ea5e9";

  const allOps = Array.from(
    new Set(pkg.functions?.flatMap((f) => f.dataOps ?? []) ?? [])
  );

  return (
    <div
      style={{
        background: selected ? "#1e293b" : "#0f172a",
        border: `2px solid ${color}`,
        borderRadius: 10,
        padding: "12px 16px",
        minWidth: 180,
        maxWidth: 240,
        boxShadow: selected ? `0 0 12px ${color}88` : "0 2px 8px #0004",
        transition: "box-shadow 0.2s",
      }}
    >
      <Handle type="target" position={Position.Left} />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span
          style={{
            background: color,
            borderRadius: 4,
            padding: "2px 7px",
            fontSize: 10,
            fontWeight: 700,
            color: "#fff",
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          {pkg.type}
        </span>
      </div>

      <div style={{ fontWeight: 700, fontSize: 15, color: "#f1f5f9", marginBottom: 4 }}>
        {pkg.label}
      </div>
      <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 8, wordBreak: "break-all" }}>
        {pkg.package}
      </div>

      {/* Functions count */}
      {pkg.functions?.length > 0 && (
        <div style={{ fontSize: 11, color: "#cbd5e1", marginBottom: 6 }}>
          {pkg.functions.length} function{pkg.functions.length > 1 ? "s" : ""}
        </div>
      )}

      {/* Data ops badges */}
      {allOps.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {allOps.map((op) => (
            <span
              key={op}
              style={{
                background: OP_COLORS[op] ?? "#475569",
                color: "#fff",
                borderRadius: 4,
                padding: "1px 6px",
                fontSize: 10,
                fontWeight: 600,
              }}
            >
              {op}
            </span>
          ))}
        </div>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
