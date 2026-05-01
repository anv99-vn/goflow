import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

SyntaxHighlighter.registerLanguage("go", go);
SyntaxHighlighter.registerLanguage("python", python); // GDScript is Python-like
import type { FuncNode, StructNode } from "../types";

interface Props {
  node: FuncNode | null;
  structNodes: StructNode[];
  language?: string;
  onStructClick: (structNode: StructNode) => void;
  onClose: () => void;
}

export function FunctionDetailPanel({ node, structNodes, language = "go", onStructClick, onClose }: Props) {
  if (!node) return null;

  const isGDScript = language === "gdscript";

  // Find structs used by this function
  const usedStructs = structNodes.filter((s) => {
    const allText = [...(node.params ?? []), ...(node.returns ?? []), node.body ?? ""].join(" ");
    return allText.includes(s.label);
  });

  // Reconstruct readable signature from parts
  const params = (node.params ?? []).join(", ");
  const returns = (node.returns ?? []).join(", ");
  const signature = isGDScript
    ? `func ${node.label}(${params})${returns ? " -> " + returns : ""}:`
    : `func ${node.label}(${params})${returns ? " " + returns : ""}`;

  // Full source = signature + body
  const fullSource = node.body
    ? isGDScript ? `${signature}\n${node.body}` : `${signature} ${node.body}`
    : signature;

  const hlLang = isGDScript ? "python" : "go";

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        width: "max-content",
        minWidth: 420,
        maxWidth: "min(900px, calc(100vw - 48px))",
        background: "#0f172a",
        border: "1px solid #1e4a7a",
        borderRadius: 12,
        zIndex: 10,
        boxShadow: "0 8px 32px #0008",
        color: "#f1f5f9",
        maxHeight: "85vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 20px 12px",
          borderBottom: "1px solid #1e293b",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#7dd3fc", fontFamily: "monospace" }}>
            {node.label}
          </div>
          <div style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>
            {node.package}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 18, lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      {/* Signature chips */}
      <div style={{ padding: "12px 20px", borderBottom: "1px solid #1e293b", flexShrink: 0 }}>
        {(node.params ?? []).length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "#64748b", alignSelf: "center" }}>params</span>
            {node.params.map((p) => (
              <span key={p} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 4, padding: "2px 8px", fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>
                {p}
              </span>
            ))}
          </div>
        )}
        {(node.returns ?? []).length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontSize: 11, color: "#64748b", alignSelf: "center" }}>returns</span>
            {node.returns.map((r) => (
              <span key={r} style={{ background: "#0f2027", border: "1px solid #22543d", borderRadius: 4, padding: "2px 8px", fontSize: 11, color: "#6ee7b7", fontFamily: "monospace" }}>
                {r}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Structs used */}
      {usedStructs.length > 0 && (
        <div style={{ padding: "12px 20px", borderBottom: "1px solid #1e293b", flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
            Structs Used ({usedStructs.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {usedStructs.map((s) => (
              <button
                key={s.id}
                onClick={() => onStructClick(s)}
                style={{
                  background: "#1e1b4b",
                  border: "1px solid #4338ca",
                  borderRadius: 6,
                  padding: "4px 10px",
                  fontSize: 12,
                  color: "#c7d2fe",
                  fontFamily: "monospace",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#2e1065";
                  e.currentTarget.style.borderColor = "#a78bfa";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#1e1b4b";
                  e.currentTarget.style.borderColor = "#4338ca";
                }}
              >
                📦 {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Source code */}
      <div style={{ padding: "12px 20px", flex: 1, overflowY: "auto", minHeight: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
          Source
        </div>
        <SyntaxHighlighter
          language={hlLang}
          style={vscDarkPlus}
          customStyle={{
            margin: 0,
            padding: "14px 16px",
            background: "#020617",
            border: "1px solid #1e293b",
            borderRadius: 8,
            fontSize: 13,
            fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
            lineHeight: 1.7,
          }}
          showLineNumbers
          lineNumberStyle={{ color: "#334155", minWidth: "2.5em" }}
        >
          {fullSource}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
