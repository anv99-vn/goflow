import type { PackageNode, FunctionInfo } from "../types";

interface Props {
  node: PackageNode | null;
  onClose: () => void;
}

export function DetailPanel({ node, onClose }: Props) {
  if (!node) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        width: 320,
        background: "#0f172a",
        border: "1px solid #1e293b",
        borderRadius: 12,
        padding: 20,
        zIndex: 10,
        boxShadow: "0 8px 32px #0008",
        color: "#f1f5f9",
        maxHeight: "80vh",
        overflowY: "auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{node.label}</div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{node.package}</div>
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
          Functions ({node.functions?.length ?? 0})
        </div>
        {node.functions?.map((fn) => (
          <FunctionCard key={fn.name} fn={fn} />
        ))}
        {(!node.functions || node.functions.length === 0) && (
          <div style={{ color: "#475569", fontSize: 13 }}>No functions found</div>
        )}
      </div>
    </div>
  );
}

function FunctionCard({ fn }: { fn: FunctionInfo }) {
  return (
    <div
      style={{
        background: "#1e293b",
        borderRadius: 8,
        padding: "10px 12px",
        marginBottom: 8,
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600, color: "#7dd3fc", marginBottom: 6 }}>
        {fn.name}()
      </div>

      {fn.params?.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "#64748b", fontSize: 11 }}>params: </span>
          <span style={{ color: "#cbd5e1" }}>{fn.params.join(", ")}</span>
        </div>
      )}

      {fn.returns?.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "#64748b", fontSize: 11 }}>returns: </span>
          <span style={{ color: "#cbd5e1" }}>{fn.returns.join(", ")}</span>
        </div>
      )}

      {fn.dataOps?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
          {fn.dataOps.map((op) => (
            <span
              key={op}
              style={{
                background: "#334155",
                color: "#94a3b8",
                borderRadius: 4,
                padding: "1px 6px",
                fontSize: 10,
              }}
            >
              {op}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
