import type { StructNode } from "../types";

interface Props {
  node: StructNode | null;
  isFromFunction?: boolean;
  onClose: () => void;
}

export function StructDetailPanel({ node, isFromFunction, onClose }: Props) {
  if (!node) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: isFromFunction ? 480 : 16, // Position beside FunctionDetailPanel if opened from there
        width: 320,
        background: "#0f172a",
        border: "1px solid #4338ca",
        borderRadius: 12,
        padding: 20,
        zIndex: 20, // Higher z-index to appear above FunctionDetailPanel
        boxShadow: "0 8px 32px #0008",
        color: "#f1f5f9",
        maxHeight: "80vh",
        overflowY: "auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#a78bfa" }}>{node.label}</div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{node.package}</div>
          <div style={{ fontSize: 10, color: "#818cf8", marginTop: 4 }}>struct</div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      <div style={{ borderTop: "1px solid #1e293b", paddingTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
          Fields ({node.fields?.length ?? 0})
        </div>
        {node.fields?.map((field, i) => (
          <div
            key={i}
            style={{
              background: "#1e1b4b",
              borderRadius: 6,
              padding: "6px 10px",
              marginBottom: 4,
              fontSize: 12,
              color: "#c7d2fe",
              fontFamily: "monospace",
            }}
          >
            {field}
          </div>
        ))}
        {(!node.fields || node.fields.length === 0) && (
          <div style={{ color: "#475569", fontSize: 13 }}>No fields</div>
        )}
      </div>
    </div>
  );
}
