import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  MarkerType,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import type { Connection, Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Graph, PackageNode, FuncNode, StructNode } from "./types";
import { PackageNodeComponent } from "./components/PackageNode";
import { FunctionNodeComponent } from "./components/FunctionNode";
import { StructNodeComponent } from "./components/StructNode";
import { DetailPanel } from "./components/DetailPanel";
import { FunctionDetailPanel } from "./components/FunctionDetailPanel";
import { StructDetailPanel } from "./components/StructDetailPanel";

const NODE_TYPES = {
  packageNode: PackageNodeComponent,
  functionNode: FunctionNodeComponent,
  structNode: StructNodeComponent,
};

// ─── Graph helpers ────────────────────────────────────────────────────────────

type SavedPositions = Record<string, { x: number; y: number }>;

function graphToFlow(
  graph: Graph,
  savedPos: SavedPositions = {},
  selectedStruct?: StructNode | null
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = (graph.nodes ?? []).map((n) => ({
    id: n.id,
    type: "packageNode",
    position: savedPos[n.id] ?? n.position,
    data: { ...n },
  }));
  (graph.structNodes ?? []).forEach((n) => {
    nodes.push({
      id: n.id,
      type: "structNode",
      position: savedPos[n.id] ?? n.position,
      data: { ...n, isActive: selectedStruct?.id === n.id },
    });
  });

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
  (graph.structEdges ?? []).forEach((e) => {
    edges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#a78bfa" },
      style: { stroke: "#a78bfa", strokeDasharray: "5 5" },
      labelStyle: { fill: "#c4b5fd", fontSize: 11 },
      labelBgStyle: { fill: "#1e1b4b" },
    });
  });
  return { nodes, edges };
}

function funcGraphToFlow(
  graph: Graph,
  savedPos: SavedPositions = {},
  activeId: string | null = null,
  hiddenIds: Set<string> = new Set(),
  deleteFunc?: (id: string) => void
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = (graph.functionNodes ?? [])
    .filter((n) => !hiddenIds.has(n.id))
    .map((n) => ({
      id: n.id,
      type: "functionNode",
      position: savedPos[n.id] ?? n.position,
      data: { ...n, isActive: n.id === activeId, onDelete: deleteFunc },
    }));

  const visible = new Set(nodes.map((n) => n.id));
  const edges: Edge[] = (graph.functionEdges ?? [])
    .filter((e) => visible.has(e.source) && visible.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#38bdf8" },
      style: { stroke: "#38bdf8" },
      labelStyle: { fill: "#7dd3fc", fontSize: 11 },
      labelBgStyle: { fill: "#0c2540" },
    }));
  return { nodes, edges };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  fileNames: string[];
}

type ViewMode = "package" | "function";

interface CustomFuncNode { id: string; label: string; x: number; y: number; }
interface CustomFuncEdge { id: string; source: string; target: string; }

interface HistoryState {
  savedPositions: SavedPositions;
  customFuncNodes: CustomFuncNode[];
  customFuncEdges: CustomFuncEdge[];
  hiddenFuncIds: string[];
}

// ─── Debounce helper ──────────────────────────────────────────────────────────

function useDebounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useCallback(
    (...args: Parameters<T>) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => fn(...args), delay);
    },
    [fn, delay]
  ) as T;
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  // Projects (from backend)
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  // Graph state
  const [currentGraph, setCurrentGraph] = useState<Graph | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("package");
  const [savedPositions, setSavedPositions] = useState<SavedPositions>({});
  const [hiddenFuncIds, setHiddenFuncIds] = useState<Set<string>>(new Set());
  const [activeFuncId, setActiveFuncId] = useState<string | null>(null);
  const [customFuncNodes, setCustomFuncNodes] = useState<CustomFuncNode[]>([]);
  const [customFuncEdges, setCustomFuncEdges] = useState<CustomFuncEdge[]>([]);

  // Undo/Redo history
  const [pastStates, setPastStates] = useState<HistoryState[]>([]);
  const [futureStates, setFutureStates] = useState<HistoryState[]>([]);
  const isUndoingRef = useRef<boolean>(false);
  const rfRef = useRef<{ getViewport: () => { x: number; y: number; zoom: number }; setViewport: (vp: { x: number; y: number; zoom: number }, opts?: { duration: number }) => void } | null>(null);
  const dragStartState = useRef<HistoryState | null>(null);

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  // Selection state
  const [selectedNode, setSelectedNode] = useState<PackageNode | null>(null);
  const [selectedFuncNode, setSelectedFuncNode] = useState<FuncNode | null>(null);
  const [selectedStructNode, setSelectedStructNode] = useState<StructNode | null>(null);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Capture current state for history
  const captureState = useCallback((): HistoryState => ({
    savedPositions: { ...savedPositions },
    customFuncNodes: [...customFuncNodes],
    customFuncEdges: [...customFuncEdges],
    hiddenFuncIds: [...hiddenFuncIds],
  }), [savedPositions, customFuncNodes, customFuncEdges, hiddenFuncIds]);

  // Push current state to past and clear future
  const pushHistory = useCallback(() => {
    if (isUndoingRef.current) return;
    setPastStates((prev) => [...prev, captureState()]);
    setFutureStates([]);
  }, [captureState]);

  // ── Graph application ────────────────────────────────────────────────────

  const deleteFuncNode = useCallback(
    (id: string) => {
      pushHistory();
      if (id.startsWith("custom_")) {
        // Full removal for custom nodes
        setCustomFuncNodes((prev) => prev.filter((n) => n.id !== id));
        setCustomFuncEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
        setNodes((nds) => nds.filter((n) => n.id !== id));
        setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      } else {
        // Hide analysis nodes
        setHiddenFuncIds((prev) => new Set([...prev, id]));
      }
      if (activeFuncId === id) {
        setSelectedFuncNode(null);
        setActiveFuncId(null);
      }
    },
    [activeFuncId, setNodes, setEdges, pushHistory]
  );

  const renameCustomNode = useCallback((id: string, newLabel: string) => {
    pushHistory();
    setCustomFuncNodes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, label: newLabel } : n))
    );
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, label: newLabel } } : n
      )
    );
  }, [setNodes, pushHistory]);

  // Build ReactFlow nodes/edges from custom data and merge with analysis output
  const mergeCustomIntoFlow = useCallback((
    analysisNodes: Node[],
    analysisEdges: Edge[],
    customNodes: CustomFuncNode[],
    customEdges: CustomFuncEdge[],
    positions: SavedPositions,
  ) => {
    const cn: Node[] = customNodes.map((n) => ({
      id: n.id,
      type: "functionNode" as const,
      position: positions[n.id] ?? { x: n.x, y: n.y },
      data: {
        id: n.id, label: n.label, package: "", params: [], returns: [], body: "",
        isCustom: true,
        onDelete: deleteFuncNode,
        onRename: renameCustomNode,
      },
    }));
    const visible = new Set([...analysisNodes.map((x) => x.id), ...cn.map((x) => x.id)]);
    const ce: Edge[] = customEdges
      .filter((e) => visible.has(e.source) && visible.has(e.target))
      .map((e) => ({
        id: e.id, source: e.source, target: e.target,
        markerEnd: { type: MarkerType.ArrowClosed, color: "#4ade80" },
        style: { stroke: "#4ade80" },
      }));
    return { nodes: [...analysisNodes, ...cn], edges: [...analysisEdges, ...ce] };
  }, [deleteFuncNode, renameCustomNode]);

  const undo = useCallback(() => {
    if (pastStates.length === 0) return;
    isUndoingRef.current = true;
    const prevState = pastStates[pastStates.length - 1];
    const currentState = captureState();
    setPastStates((prev) => prev.slice(0, -1));
    setFutureStates((prev) => [...prev, currentState]);
    setSavedPositions(prevState.savedPositions);
    setCustomFuncNodes(prevState.customFuncNodes);
    setCustomFuncEdges(prevState.customFuncEdges);
    setHiddenFuncIds(new Set(prevState.hiddenFuncIds));
    // Re-apply graph with restored state
    if (currentGraph) {
      if (viewMode === "function") {
        const { nodes: n, edges: e } = funcGraphToFlow(
          currentGraph, prevState.savedPositions, null, new Set(prevState.hiddenFuncIds), deleteFuncNode
        );
        const merged = mergeCustomIntoFlow(n, e, prevState.customFuncNodes, prevState.customFuncEdges, prevState.savedPositions);
        setNodes(merged.nodes);
        setEdges(merged.edges);
      } else {
        const { nodes: n, edges: e } = graphToFlow(currentGraph, prevState.savedPositions);
        setNodes(n);
        setEdges(e);
      }
    }
    setTimeout(() => { isUndoingRef.current = false; }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastStates, captureState, currentGraph, viewMode, funcGraphToFlow, mergeCustomIntoFlow, setNodes, setEdges, deleteFuncNode]);

  const redo = useCallback(() => {
    if (futureStates.length === 0) return;
    isUndoingRef.current = true;
    const nextState = futureStates[futureStates.length - 1];
    const currentState = captureState();
    setFutureStates((prev) => prev.slice(0, -1));
    setPastStates((prev) => [...prev, currentState]);
    setSavedPositions(nextState.savedPositions);
    setCustomFuncNodes(nextState.customFuncNodes);
    setCustomFuncEdges(nextState.customFuncEdges);
    setHiddenFuncIds(new Set(nextState.hiddenFuncIds));
    if (currentGraph) {
      if (viewMode === "function") {
        const { nodes: n, edges: e } = funcGraphToFlow(
          currentGraph, nextState.savedPositions, null, new Set(nextState.hiddenFuncIds), deleteFuncNode
        );
        const merged = mergeCustomIntoFlow(n, e, nextState.customFuncNodes, nextState.customFuncEdges, nextState.savedPositions);
        setNodes(merged.nodes);
        setEdges(merged.edges);
      } else {
        const { nodes: n, edges: e } = graphToFlow(currentGraph, nextState.savedPositions);
        setNodes(n);
        setEdges(e);
      }
    }
    setTimeout(() => { isUndoingRef.current = false; }, 0);
  }, [futureStates, captureState, currentGraph, viewMode, funcGraphToFlow, mergeCustomIntoFlow, setNodes, setEdges]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  // Stable refs so callbacks don't go stale
  const customFuncNodesRef = useRef<CustomFuncNode[]>([]);
  const customFuncEdgesRef = useRef<CustomFuncEdge[]>([]);
  const activeProjectIdRef = useRef<string | null>(null);
  useEffect(() => { customFuncNodesRef.current = customFuncNodes; }, [customFuncNodes]);
  useEffect(() => { customFuncEdgesRef.current = customFuncEdges; }, [customFuncEdges]);
  useEffect(() => { activeProjectIdRef.current = activeProjectId; }, [activeProjectId]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  );

  // ── Load projects on mount ───────────────────────────────────────────────

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data: Project[]) => setProjects(data ?? []))
      .catch(() => {});
  }, []);

  // ── Graph application ────────────────────────────────────────────

  const applyGraphWithPositions = useCallback(
    (graph: Graph, positions: SavedPositions, vm: ViewMode = "package") => {
      setCurrentGraph(graph);
      const { nodes: n, edges: e } =
        vm === "function"
          ? funcGraphToFlow(graph, positions, null, new Set(), deleteFuncNode)
          : graphToFlow(graph, positions);
      setNodes(n);
      setEdges(e);
    },
    [deleteFuncNode, setNodes, setEdges]
  );

  // ── Select project ───────────────────────────────────────────────────────

  const selectProject = useCallback(async (id: string) => {
    setActiveProjectId(id);
    // Reset UI
    setSelectedNode(null);
    setSelectedFuncNode(null);
    setSelectedStructNode(null);
    setActiveFuncId(null);
    setHiddenFuncIds(new Set());
    setViewMode("package");
    setError("");
    setCurrentGraph(null);
    setNodes([]);
    setEdges([]);

    try {
      const [graphRaw, positions, hiddenIds, customRaw] = await Promise.all([
        db.loadGraph(id),
        db.loadPositions(id),
        db.loadHidden(id),
        db.loadCustom(id),
      ]);
      setSavedPositions(positions);
      setHiddenFuncIds(new Set(hiddenIds));
      setCustomFuncNodes(customRaw.nodes);
      setCustomFuncEdges(customRaw.edges);
      if (graphRaw) {
        applyGraphWithPositions(graphRaw, positions, "package");
      }
    } catch {
      /* project might have no graph yet */
    }
  }, [applyGraphWithPositions, setNodes, setEdges]);

  // ── Create / delete project ──────────────────────────────────────────────

  const createProject = useCallback(async () => {
    const name = newProjectName.trim();
    if (!name) return;
    try {
      const p: Project = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }).then((r) => r.json());
      setProjects((prev) => [...prev, p]);
      setNewProjectName("");
      setCreatingProject(false);
      selectProject(p.id);
    } catch (e) {
      setError(String(e));
    }
  }, [newProjectName, selectProject]);

  const deleteProject = useCallback(async (id: string) => {
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (activeProjectId === id) {
      setActiveProjectId(null);
      setCurrentGraph(null);
      setNodes([]);
      setEdges([]);
    }
  }, [activeProjectId, setNodes, setEdges]);

  // ── File management ──────────────────────────────────────────────────────

  const addFilesToProject = useCallback(
    async (files: File[]) => {
      if (!activeProjectId) return;
      const supported = files.filter(
        (f) => f.name.endsWith(".go") || f.name.endsWith(".gd")
      );
      if (supported.length === 0) return;

      setLoading(true);
      setError("");
      const form = new FormData();
      supported.forEach((f) => form.append("file", f));

      try {
        const res: { fileNames: string[]; graph: Graph } = await fetch(
          `/api/projects/${activeProjectId}/files`,
          { method: "POST", body: form }
        ).then((r) => {
          if (!r.ok) return r.text().then((t) => Promise.reject(t));
          return r.json();
        });

        setProjects((prev) =>
          prev.map((p) =>
            p.id === activeProjectId ? { ...p, fileNames: res.fileNames } : p
          )
        );
        if (res.graph) {
          const positions = await db.loadPositions(activeProjectId);
          setSavedPositions(positions);
          setViewMode("package");
          setHiddenFuncIds(new Set());
          setCustomFuncNodes([]);
          setCustomFuncEdges([]);
          applyGraphWithPositions(res.graph, positions, "package");
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [activeProjectId, applyGraphWithPositions]
  );

  const removeFileFromProject = useCallback(
    async (fileName: string) => {
      if (!activeProjectId) return;
      setLoading(true);
      setError("");
      try {
        const res: { fileNames: string[]; graph: Graph | null } = await fetch(
          `/api/projects/${activeProjectId}/files/${encodeURIComponent(fileName)}`,
          { method: "DELETE" }
        ).then((r) => {
          if (!r.ok) return r.text().then((t) => Promise.reject(t));
          return r.json();
        });

        setProjects((prev) =>
          prev.map((p) =>
            p.id === activeProjectId ? { ...p, fileNames: res.fileNames } : p
          )
        );
        if (res.graph) {
          const positions = await db.loadPositions(activeProjectId);
          setSavedPositions(positions);
          setViewMode("package");
          setHiddenFuncIds(new Set());
          setCustomFuncNodes([]);
          setCustomFuncEdges([]);
          applyGraphWithPositions(res.graph, positions, "package");
        } else {
          setCurrentGraph(null);
          setNodes([]);
          setEdges([]);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [activeProjectId, applyGraphWithPositions, setNodes, setEdges]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      addFilesToProject(Array.from(e.dataTransfer.files));
    },
    [addFilesToProject]
  );

  // ── Position saving (debounced) ──────────────────────────────────────────

  const savePositionsToBackend = useCallback(
    async (id: string, pos: SavedPositions) => {
      await fetch(`/api/projects/${id}/positions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pos),
      });
    },
    []
  );

  const debouncedSavePositions = useDebounce(savePositionsToBackend, 800);
  const debouncedSaveHidden = useDebounce(db.saveHidden, 800);
  const debouncedSaveCustom = useDebounce(db.saveCustom, 800);

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const pos = node.position;
      // Save to history if position changed
      if (dragStartState.current && dragStartState.current.savedPositions[node.id] &&
          (dragStartState.current.savedPositions[node.id].x !== pos.x ||
           dragStartState.current.savedPositions[node.id].y !== pos.y)) {
        setPastStates((prev) => [...prev, dragStartState.current!]);
        setFutureStates([]);
      }
      dragStartState.current = null;
      setSavedPositions((prev) => {
        const next = { ...prev, [node.id]: pos };
        if (activeProjectId) debouncedSavePositions(activeProjectId, next);
        return next;
      });
      // Keep custom node x/y in sync so they survive re-renders
      if (node.id.startsWith("custom_")) {
        setCustomFuncNodes((prev) =>
          prev.map((n) => (n.id === node.id ? { ...n, x: pos.x, y: pos.y } : n))
        );
      }
    },
    [activeProjectId, debouncedSavePositions]
  );

  // onNodeDragStart — capture state before drag for undo
  const onNodeDragStart = useCallback(
    (_: React.MouseEvent) => {
      dragStartState.current = captureState();
    },
    [captureState]
  );

  // onConnect — persists manually drawn edges
  const onConnect = useCallback(
    (p: Connection) => {
      if (!p.source || !p.target) return;
      pushHistory();
      const newEdge: CustomFuncEdge = {
        id: `custom_edge_${Date.now()}`,
        source: p.source,
        target: p.target,
      };
      setCustomFuncEdges((prev) => [...prev, newEdge]);
      setEdges((eds) =>
        addEdge({
          ...p,
          id: newEdge.id,
          markerEnd: { type: MarkerType.ArrowClosed, color: "#4ade80" },
          style: { stroke: "#4ade80" },
        }, eds)
      );
    },
    [setEdges, pushHistory]
  );

  // addCustomNode — places a blank node at viewport center
  const addCustomNode = useCallback(() => {
    pushHistory();
    const id = `custom_${Date.now()}`;
    const vp = rfRef.current?.getViewport() ?? { x: 0, y: 0, zoom: 1 };
    const x = (window.innerWidth / 2 - vp.x) / vp.zoom;
    const y = (window.innerHeight / 2 - vp.y) / vp.zoom;
    const newCN: CustomFuncNode = { id, label: "newFunc", x, y };
    setCustomFuncNodes((prev) => [...prev, newCN]);
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: "functionNode" as const,
        position: { x, y },
        data: {
          id, label: "newFunc", package: "", params: [], returns: [], body: "",
          isCustom: true,
          onDelete: deleteFuncNode,
          onRename: renameCustomNode,
        },
      },
    ]);
  }, [deleteFuncNode, renameCustomNode, setNodes, pushHistory]);

  // ── Sync hidden/active func + custom ────────────────────────────────────

  useEffect(() => {
    if (!currentGraph || viewMode !== "function") return;
    const { nodes: n, edges: e } = funcGraphToFlow(
      currentGraph, savedPositions, activeFuncId, hiddenFuncIds, deleteFuncNode
    );
    const merged = mergeCustomIntoFlow(n, e, customFuncNodes, customFuncEdges, savedPositions);
    setNodes(merged.nodes);
    setEdges(merged.edges);
    if (activeProjectId) {
      debouncedSaveHidden(activeProjectId, [...hiddenFuncIds]);
    }
  }, [hiddenFuncIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist custom whenever it changes
  useEffect(() => {
    const pid = activeProjectIdRef.current;
    if (!pid) return;
    debouncedSaveCustom(pid, { nodes: customFuncNodesRef.current, edges: customFuncEdgesRef.current });
  }, [customFuncNodes, customFuncEdges]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (viewMode !== "function") return;
    setNodes((nds) =>
      nds.map((n) => ({ ...n, data: { ...n.data, isActive: n.id === activeFuncId } }))
    );
  }, [activeFuncId, viewMode, setNodes]);

  // ── Interaction ──────────────────────────────────────────────────────────

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === "functionNode") {
      setSelectedFuncNode(node.data as unknown as FuncNode);
      setActiveFuncId(node.id);
      setSelectedNode(null);

      const inst = rfRef.current;
      if (inst) {
        const vp = inst.getViewport();
        const screenX = node.position.x * vp.zoom + vp.x;
        if (screenX > window.innerWidth - 470) {
          inst.setViewport(
            { x: window.innerWidth * 0.35 - node.position.x * vp.zoom, y: vp.y, zoom: vp.zoom },
            { duration: 300 }
          );
        }
      }
    } else if (node.type === "structNode") {
      setSelectedStructNode(node.data as unknown as StructNode);
      setSelectedNode(null);
      setSelectedFuncNode(null);
      setActiveFuncId(null);
    } else {
      setSelectedNode(node.data as unknown as PackageNode);
      setSelectedFuncNode(null);
      setActiveFuncId(null);
      setSelectedStructNode(null);
    }
  }, []);

  const handleStructClick = useCallback((s: StructNode) => setSelectedStructNode(s), []);

  const switchViewMode = useCallback(
    (vm: ViewMode) => {
      if (!currentGraph) return;
      setViewMode(vm);
      setSelectedNode(null);
      setSelectedFuncNode(null);
      setActiveFuncId(null);
      setSelectedStructNode(null);
      if (vm === "function") {
        const { nodes: n, edges: e } = funcGraphToFlow(currentGraph, savedPositions, null, hiddenFuncIds, deleteFuncNode);
        const merged = mergeCustomIntoFlow(n, e, customFuncNodes, customFuncEdges, savedPositions);
        setNodes(merged.nodes);
        setEdges(merged.edges);
      } else {
        const { nodes: n, edges: e } = graphToFlow(currentGraph, savedPositions);
        setNodes(n);
        setEdges(e);
      }
    },
    [currentGraph, savedPositions, hiddenFuncIds, deleteFuncNode, customFuncNodes, customFuncEdges, mergeCustomIntoFlow, setNodes, setEdges]
  );

  const stats = useMemo(() => ({
    entrypoints: nodes.filter((n) => (n.data as any).type === "entrypoint").length,
    packages: nodes.filter((n) => (n.data as any).type === "package").length,
    structs: nodes.filter((n) => n.type === "structNode").length,
    hidden: hiddenFuncIds.size,
    edges: edges.length,
  }), [nodes, edges, hiddenFuncIds]);

  const isGDScript = currentGraph?.language === "gdscript";

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#020617", display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <div style={{
        height: 48, padding: "0 20px", background: "#0f172a",
        borderBottom: "1px solid #1e293b", display: "flex", alignItems: "center",
        gap: 14, flexShrink: 0,
      }}>
        <span style={{ fontWeight: 800, fontSize: 17, color: "#7dd3fc", letterSpacing: -0.5 }}>GoFlow</span>

        {currentGraph && (
          <span style={{
            fontSize: 11, fontWeight: 600,
            background: isGDScript ? "#1a1040" : "#0c1a2e",
            color: isGDScript ? "#c084fc" : "#38bdf8",
            border: `1px solid ${isGDScript ? "#7c3aed" : "#0ea5e9"}`,
            borderRadius: 4, padding: "2px 8px",
          }}>
            {isGDScript ? "GDScript" : "Go"}
          </span>
        )}

        {/* Undo/Redo buttons */}
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={undo}
            disabled={pastStates.length === 0}
            title="Undo (Ctrl+Z)"
            style={{
              background: pastStates.length > 0 ? "#1e293b" : "#0f172a",
              color: pastStates.length > 0 ? "#7dd3fc" : "#334155",
              border: `1px solid ${pastStates.length > 0 ? "#334155" : "#1e293b"}`,
              borderRadius: 4, padding: "4px 8px", fontSize: 12, fontWeight: 600,
              cursor: pastStates.length > 0 ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", gap: 3,
            }}
            onMouseEnter={(e) => { if (pastStates.length > 0) e.currentTarget.style.background = "#334155"; }}
            onMouseLeave={(e) => { if (pastStates.length > 0) e.currentTarget.style.background = "#1e293b"; }}
          >
            ↩ Undo
          </button>
          <button
            onClick={redo}
            disabled={futureStates.length === 0}
            title="Redo (Ctrl+Shift+Z or Ctrl+Y)"
            style={{
              background: futureStates.length > 0 ? "#1e293b" : "#0f172a",
              color: futureStates.length > 0 ? "#7dd3fc" : "#334155",
              border: `1px solid ${futureStates.length > 0 ? "#334155" : "#1e293b"}`,
              borderRadius: 4, padding: "4px 8px", fontSize: 12, fontWeight: 600,
              cursor: futureStates.length > 0 ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", gap: 3,
            }}
            onMouseEnter={(e) => { if (futureStates.length > 0) e.currentTarget.style.background = "#334155"; }}
            onMouseLeave={(e) => { if (futureStates.length > 0) e.currentTarget.style.background = "#1e293b"; }}
          >
            ↪ Redo
          </button>
        </div>

        <div style={{ flex: 1 }} />

        {/* Stats */}
        {nodes.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12, color: "#64748b" }}>
            <StatBadge label="entrypoints" value={stats.entrypoints} color="#6366f1" />
            <StatBadge label={isGDScript ? "scripts" : "packages"} value={stats.packages} color="#0ea5e9" />
            {stats.structs > 0 && (
              <StatBadge label={isGDScript ? "classes" : "structs"} value={stats.structs} color="#a78bfa" />
            )}
            {stats.hidden > 0 && (
              <button onClick={() => setHiddenFuncIds(new Set())}
                style={{ background: "#dc2626", color: "#fff", border: "none", borderRadius: 5, padding: "2px 8px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                restore {stats.hidden} hidden
              </button>
            )}
            <StatBadge label="edges" value={stats.edges} color="#475569" />
          </div>
        )}

        {/* Add node button (function view only) */}
        {viewMode === "function" && (
          <button
            onClick={addCustomNode}
            title="Add empty node"
            style={{
              background: "#0d2318", border: "1px solid #22c55e", borderRadius: 6,
              color: "#4ade80", fontSize: 12, fontWeight: 600,
              padding: "4px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#14532d"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#0d2318"; }}
          >
            + Node
          </button>
        )}

        {/* View mode */}
        {currentGraph && (currentGraph.functionNodes ?? []).length > 0 && (
          <div style={{ display: "flex", background: "#1e293b", borderRadius: 7, padding: 2, gap: 2 }}>
            <ViewTab label="Package" active={viewMode === "package"} onClick={() => switchViewMode("package")} />
            <ViewTab label="Function" active={viewMode === "function"} onClick={() => switchViewMode("function")} />
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <div style={{
          width: 220, background: "#0a1120", borderRight: "1px solid #1e293b",
          display: "flex", flexDirection: "column", flexShrink: 0,
        }}>
          <div style={{ padding: "14px 14px 6px", fontSize: 11, fontWeight: 700, color: "#475569", letterSpacing: 1, textTransform: "uppercase" }}>
            Projects
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {projects.map((p) => (
              <ProjectItem
                key={p.id}
                project={p}
                active={p.id === activeProjectId}
                onSelect={() => selectProject(p.id)}
                onDelete={() => deleteProject(p.id)}
              />
            ))}
            {projects.length === 0 && !creatingProject && (
              <div style={{ padding: "20px 16px", color: "#334155", fontSize: 12, textAlign: "center" }}>
                No projects yet
              </div>
            )}
          </div>

          {/* New project */}
          <div style={{ padding: "10px 10px 14px", borderTop: "1px solid #1e293b" }}>
            {creatingProject ? (
              <form onSubmit={(e) => { e.preventDefault(); createProject(); }}
                style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <input
                  autoFocus
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="Project name…"
                  style={{
                    background: "#1e293b", border: "1px solid #334155", borderRadius: 6,
                    padding: "6px 10px", color: "#f1f5f9", fontSize: 12,
                    outline: "none", width: "100%", boxSizing: "border-box",
                  }}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="submit" disabled={!newProjectName.trim()}
                    style={{
                      flex: 1, background: newProjectName.trim() ? "#6366f1" : "#1e293b",
                      color: newProjectName.trim() ? "#fff" : "#475569",
                      border: "none", borderRadius: 6, padding: "6px 0",
                      fontSize: 12, fontWeight: 600,
                      cursor: newProjectName.trim() ? "pointer" : "not-allowed",
                    }}>
                    Create
                  </button>
                  <button type="button"
                    onClick={() => { setCreatingProject(false); setNewProjectName(""); }}
                    style={{
                      background: "none", border: "1px solid #334155", borderRadius: 6,
                      padding: "6px 10px", fontSize: 12, color: "#64748b", cursor: "pointer",
                    }}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setCreatingProject(true)}
                style={{
                  width: "100%", background: "none", border: "1px dashed #334155",
                  borderRadius: 6, padding: "7px 0", fontSize: 12, color: "#64748b",
                  cursor: "pointer", display: "flex", alignItems: "center",
                  justifyContent: "center", gap: 6, transition: "all 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#6366f1"; e.currentTarget.style.color = "#818cf8"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.color = "#64748b"; }}
              >
                + New Project
              </button>
            )}
          </div>
        </div>

        {/* ── Main area ───────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {activeProject ? (
            <>
              {/* File bar */}
              <div
                style={{
                  padding: "7px 14px", background: "#0f172a", borderBottom: "1px solid #1e293b",
                  display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
                  flexWrap: "wrap", minHeight: 44,
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <UploadButton label="📁 Folder" loading={loading} onFiles={addFilesToProject} folder />
                <UploadButton label="📄 Files" loading={loading} onFiles={addFilesToProject} />

                {activeProject.fileNames.map((name) => (
                  <FileChip key={name} name={name} disabled={loading}
                    onRemove={() => removeFileFromProject(name)} />
                ))}

                {activeProject.fileNames.length === 0 && (
                  <span style={{ fontSize: 12, color: "#334155", marginLeft: 4 }}>
                    Add .go or .gd files · drag & drop supported
                  </span>
                )}
              </div>

              {/* Error */}
              {error && (
                <div style={{
                  background: "#450a0a", border: "1px solid #7f1d1d",
                  color: "#fca5a5", padding: "8px 16px", fontSize: 13, flexShrink: 0,
                }}>
                  {error}
                </div>
              )}

              {/* Graph canvas */}
              <div style={{ flex: 1, position: "relative" }}>
                {nodes.length === 0 && !loading && !error && (
                  <div style={{
                    position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center", color: "#334155",
                    gap: 12, pointerEvents: "none",
                  }}>
                    <div style={{ fontSize: 48 }}>📄</div>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>
                      Add files to "{activeProject.name}"
                    </div>
                    <div style={{ fontSize: 13 }}>Supports .go and .gd · drop anywhere in the file bar</div>
                  </div>
                )}

                {loading && (
                  <div style={{
                    position: "absolute", inset: 0, display: "flex", alignItems: "center",
                    justifyContent: "center", background: "rgba(2,6,23,0.6)", zIndex: 10,
                    color: "#7dd3fc", fontSize: 15, fontWeight: 600, gap: 10,
                  }}>
                    <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
                    Analyzing…
                  </div>
                )}

                <ReactFlow
                  nodes={nodes} edges={edges}
                  onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
                  onConnect={onConnect} onNodeClick={onNodeClick}
                  onNodeDragStart={onNodeDragStart}
                  onNodeDragStop={onNodeDragStop}
                  nodeTypes={NODE_TYPES}
                  fitView fitViewOptions={{ padding: 0.2 }}
                  colorMode="dark"
                  onInit={(i) => { rfRef.current = i; }}
                >
                  <Background color="#1e293b" gap={24} />
                  <Controls />
                  <MiniMap
                    nodeColor={(n) => {
                      if (n.type === "structNode") return "#a78bfa";
                      const t = (n.data as any)?.type;
                      if (t === "entrypoint") return "#6366f1";
                      if (t === "external") return "#475569";
                      return "#0ea5e9";
                    }}
                    style={{ background: "#0f172a", border: "1px solid #1e293b" }}
                  />
                </ReactFlow>

                <DetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
                <FunctionDetailPanel
                  node={selectedFuncNode}
                  structNodes={currentGraph?.structNodes ?? []}
                  language={currentGraph?.language ?? "go"}
                  onStructClick={handleStructClick}
                  onClose={() => { setSelectedFuncNode(null); setActiveFuncId(null); }}
                />
                <StructDetailPanel
                  node={selectedStructNode}
                  isFromFunction={!!selectedFuncNode}
                  onClose={() => setSelectedStructNode(null)}
                />
              </div>
            </>
          ) : (
            <div style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", color: "#334155", gap: 16,
            }}>
              <div style={{ fontSize: 56 }}>⬡</div>
              <div style={{ fontSize: 17, fontWeight: 600, color: "#475569" }}>
                {projects.length === 0 ? "Create a project to get started" : "Select a project from the sidebar"}
              </div>
              <div style={{ fontSize: 13 }}>
                {projects.length === 0
                  ? "Projects group your files together for analysis"
                  : `${projects.length} project${projects.length > 1 ? "s" : ""} available`}
              </div>
              {projects.length === 0 && (
                <button onClick={() => setCreatingProject(true)}
                  style={{
                    marginTop: 8, background: "#6366f1", color: "#fff",
                    border: "none", borderRadius: 8, padding: "10px 24px",
                    fontSize: 14, fontWeight: 600, cursor: "pointer",
                  }}>
                  + New Project
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Backend API client ───────────────────────────────────────────────────────

const db = {
  async loadGraph(id: string): Promise<Graph | null> {
    const r = await fetch(`/api/projects/${id}/graph`);
    if (!r.ok || r.status === 204) return null;
    return r.json();
  },
  async loadPositions(id: string): Promise<SavedPositions> {
    const r = await fetch(`/api/projects/${id}/positions`);
    if (!r.ok) return {};
    return r.json();
  },
  async loadHidden(id: string): Promise<string[]> {
    const r = await fetch(`/api/projects/${id}/hidden`);
    if (!r.ok) return [];
    return r.json();
  },
  async saveHidden(id: string, ids: string[]): Promise<void> {
    await fetch(`/api/projects/${id}/hidden`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids),
    });
  },
  async loadCustom(id: string): Promise<{ nodes: CustomFuncNode[]; edges: CustomFuncEdge[] }> {
    const r = await fetch(`/api/projects/${id}/custom`);
    if (!r.ok) return { nodes: [], edges: [] };
    return r.json();
  },
  async saveCustom(id: string, data: { nodes: CustomFuncNode[]; edges: CustomFuncEdge[] }): Promise<void> {
    await fetch(`/api/projects/${id}/custom`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProjectItem({
  project, active, onSelect, onDelete,
}: {
  project: Project; active: boolean;
  onSelect: () => void; onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "8px 14px", display: "flex", alignItems: "center", gap: 8,
        cursor: "pointer",
        background: active ? "#1e293b" : hovered ? "#111827" : "transparent",
        borderLeft: `2px solid ${active ? "#6366f1" : "transparent"}`,
        transition: "all 0.1s",
      }}
    >
      <span style={{ fontSize: 13 }}>📁</span>
      <span style={{
        flex: 1, fontSize: 13, fontWeight: active ? 600 : 400,
        color: active ? "#e2e8f0" : "#94a3b8",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {project.name}
      </span>
      {project.fileNames.length > 0 && (
        <span style={{
          fontSize: 10, background: "#1e293b", color: "#475569",
          borderRadius: 10, padding: "1px 6px", flexShrink: 0,
        }}>
          {project.fileNames.length}
        </span>
      )}
      {(hovered || active) && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 2, flexShrink: 0 }}
          title="Delete project"
        >✕</button>
      )}
    </div>
  );
}

function UploadButton({ label, loading, onFiles, folder }: {
  label: string; loading: boolean;
  onFiles: (files: File[]) => void; folder?: boolean;
}) {
  return (
    <label style={{
      background: loading ? "#1e293b" : "#0ea5e9",
      color: loading ? "#475569" : "#fff",
      borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600,
      cursor: loading ? "not-allowed" : "pointer",
      display: "flex", alignItems: "center", gap: 5,
      flexShrink: 0, userSelect: "none", transition: "background 0.15s",
    }}>
      <input
        type="file" multiple={!folder} accept=".go,.gd"
        disabled={loading} style={{ display: "none" }}
        // @ts-ignore
        {...(folder ? { webkitdirectory: "" } : {})}
        onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
      />
      {label}
    </label>
  );
}

function FileChip({ name, disabled, onRemove }: {
  name: string; disabled: boolean; onRemove: () => void;
}) {
  const gd = name.endsWith(".gd");
  return (
    <span style={{
      display: "flex", alignItems: "center", gap: 4,
      color: gd ? "#c084fc" : "#7dd3fc", fontSize: 12,
      background: gd ? "#1a1040" : "#0c2540",
      border: `1px solid ${gd ? "#7c3aed" : "#1e4a7a"}`,
      borderRadius: 5, padding: "3px 6px 3px 8px", maxWidth: 180,
    }} title={name}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      <button onClick={onRemove} disabled={disabled}
        style={{ background: "none", border: "none", color: "#475569", cursor: disabled ? "not-allowed" : "pointer", padding: 0, fontSize: 12, lineHeight: 1, flexShrink: 0 }}
        title={`Remove ${name}`}>✕</button>
    </span>
  );
}

function ViewTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{
        background: active ? "#334155" : "transparent",
        color: active ? "#7dd3fc" : "#64748b",
        border: "none", borderRadius: 5, padding: "4px 10px",
        fontSize: 11, fontWeight: active ? 600 : 400,
        cursor: "pointer", transition: "all 0.15s",
      }}>
      {label}
    </button>
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
