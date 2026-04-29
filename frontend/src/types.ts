export interface FunctionInfo {
  name: string;
  params: string[];
  returns: string[];
  callsTo: string[];
  dataOps: string[];
  body: string;
}

export interface StructInfo {
  name: string;
  fields: string[];
}

export interface PackageNode {
  id: string;
  label: string;
  package: string;
  functions: FunctionInfo[];
  structs: StructInfo[];
  type: "entrypoint" | "package" | "external";
  position: { x: number; y: number };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

export interface FuncNode {
  id: string;
  label: string;
  package: string;
  params: string[];
  returns: string[];
  body: string;
  missing?: boolean;
  position: { x: number; y: number };
}

export interface FuncEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

export interface StructNode {
  id: string;
  label: string;
  package: string;
  fields: string[];
  position: { x: number; y: number };
}

export interface StructEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

export interface Graph {
  nodes: PackageNode[];
  edges: FlowEdge[];
  functionNodes: FuncNode[];
  functionEdges: FuncEdge[];
  structNodes: StructNode[];
  structEdges: StructEdge[];
}
