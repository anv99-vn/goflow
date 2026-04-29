export interface FunctionInfo {
  name: string;
  params: string[];
  returns: string[];
  callsTo: string[];
  dataOps: string[];
}

export interface PackageNode {
  id: string;
  label: string;
  package: string;
  functions: FunctionInfo[];
  type: "entrypoint" | "package" | "external";
  position: { x: number; y: number };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

export interface Graph {
  nodes: PackageNode[];
  edges: FlowEdge[];
}
