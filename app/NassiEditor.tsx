"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sun, Moon, Upload, Download, ImageDown, Trash2, Copy, X, PanelRight, Square, ArrowRightLeft, GitBranch, Repeat2, GripVertical, Plus, Code2, MousePointer2 } from "lucide-react";

type BlockKind = "action" | "io" | "decision" | "loop";
type ContainerKey = "root" | `${string}:then` | `${string}:else` | `${string}:body`;
type Theme = "dark" | "light";

type DiagramBlock = {
  id: string;
  kind: BlockKind;
  label: string;
  note: string;
  thenBranch?: DiagramBlock[];
  elseBranch?: DiagramBlock[];
  body?: DiagramBlock[];
};

type DragPayload =
  | { source: "palette"; kind: BlockKind }
  | { source: "diagram"; id: string };

type ImportedDiagram = {
  title: string;
  blocks: DiagramBlock[];
};

const dragMime = "application/x-betternassi-block";
const diagramFileFormat = "betternassi.diagram";
const diagramFileVersion = 1;
const inspectorDrawerMediaQuery = "(max-width: 1180px)";
const rootContainer: ContainerKey = "root";
const diagramStorageKey = "betternassi-diagram";
const themeStorageKey = "betternassi-theme";
const autoScrollEdge = 86;
const autoScrollMaxSpeed = 22;

const palette: Array<{
  kind: BlockKind;
  name: string;
  shortcut: string;
  description: string;
}> = [
  {
    kind: "action",
    name: "Process",
    shortcut: "P",
    description: "One operation",
  },
  {
    kind: "io",
    name: "Input / Output",
    shortcut: "I/O",
    description: "Read or show data",
  },
  {
    kind: "decision",
    name: "Decision",
    shortcut: "IF",
    description: "Two branches",
  },
  {
    kind: "loop",
    name: "Loop",
    shortcut: "LOOP",
    description: "Repeated steps",
  },
];

const blockNames: Record<BlockKind, string> = {
  action: "Process",
  io: "Input / Output",
  decision: "Decision",
  loop: "Loop",
};

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBlockKind(value: unknown): value is BlockKind {
  return (
    value === "action" ||
    value === "io" ||
    value === "decision" ||
    value === "loop"
  );
}

function readText(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function readBlockNote(kind: BlockKind, label: string, value: unknown) {
  const note = readText(value, "");

  if (kind === "io" && label === "Read input" && note === "data") {
    return "";
  }

  return note;
}

function createBlock(kind: BlockKind): DiagramBlock {
  const id = makeId();

  if (kind === "decision") {
    return {
      id,
      kind,
      label: "Condition?",
      note: "",
      thenBranch: [
        {
          id: makeId(),
          kind: "action",
          label: "Handle true case",
          note: "",
        },
      ],
      elseBranch: [
        {
          id: makeId(),
          kind: "action",
          label: "Handle false case",
          note: "",
        },
      ],
    };
  }

  if (kind === "loop") {
    return {
      id,
      kind,
      label: "Repeat while condition is true",
      note: "",
      body: [
        {
          id: makeId(),
          kind: "action",
          label: "Loop step",
          note: "",
        },
      ],
    };
  }

  return {
    id,
    kind,
    label: kind === "io" ? "Read input" : "New process step",
    note: "",
  };
}

function updateContainer(
  blocks: DiagramBlock[],
  key: ContainerKey,
  updater: (items: DiagramBlock[]) => DiagramBlock[],
): DiagramBlock[] {
  if (key === rootContainer) {
    return updater(blocks);
  }

  return blocks.map((block) => {
    if (block.kind === "decision") {
      if (key === `${block.id}:then`) {
        return { ...block, thenBranch: updater(block.thenBranch ?? []) };
      }

      if (key === `${block.id}:else`) {
        return { ...block, elseBranch: updater(block.elseBranch ?? []) };
      }

      return {
        ...block,
        thenBranch: updateContainer(block.thenBranch ?? [], key, updater),
        elseBranch: updateContainer(block.elseBranch ?? [], key, updater),
      };
    }

    if (block.kind === "loop") {
      if (key === `${block.id}:body`) {
        return { ...block, body: updater(block.body ?? []) };
      }

      return {
        ...block,
        body: updateContainer(block.body ?? [], key, updater),
      };
    }

    return block;
  });
}

function containerExists(blocks: DiagramBlock[], key: ContainerKey): boolean {
  if (key === rootContainer) {
    return true;
  }

  return blocks.some((block) => {
    if (block.kind === "decision") {
      return (
        key === `${block.id}:then` ||
        key === `${block.id}:else` ||
        containerExists(block.thenBranch ?? [], key) ||
        containerExists(block.elseBranch ?? [], key)
      );
    }

    if (block.kind === "loop") {
      return key === `${block.id}:body` || containerExists(block.body ?? [], key);
    }

    return false;
  });
}

function insertBlock(
  blocks: DiagramBlock[],
  key: ContainerKey,
  index: number,
  block: DiagramBlock,
) {
  return updateContainer(blocks, key, (items) => {
    const next = [...items];
    next.splice(Math.max(0, Math.min(index, next.length)), 0, block);
    return next;
  });
}

function removeBlock(
  blocks: DiagramBlock[],
  id: string,
): { blocks: DiagramBlock[]; removed: DiagramBlock | null } {
  let removed: DiagramBlock | null = null;
  const next: DiagramBlock[] = [];

  for (const block of blocks) {
    if (block.id === id) {
      removed = block;
      continue;
    }

    let current = block;

    if (block.kind === "decision") {
      const thenResult = removeBlock(block.thenBranch ?? [], id);
      const elseResult = removeBlock(block.elseBranch ?? [], id);
      removed = removed ?? thenResult.removed ?? elseResult.removed;
      current = {
        ...block,
        thenBranch: thenResult.blocks,
        elseBranch: elseResult.blocks,
      };
    }

    if (block.kind === "loop") {
      const bodyResult = removeBlock(block.body ?? [], id);
      removed = removed ?? bodyResult.removed;
      current = { ...block, body: bodyResult.blocks };
    }

    next.push(current);
  }

  return { blocks: next, removed };
}

function findBlock(blocks: DiagramBlock[], id: string | null): DiagramBlock | null {
  if (!id) {
    return null;
  }

  for (const block of blocks) {
    if (block.id === id) {
      return block;
    }

    if (block.kind === "decision") {
      const found =
        findBlock(block.thenBranch ?? [], id) ??
        findBlock(block.elseBranch ?? [], id);
      if (found) {
        return found;
      }
    }

    if (block.kind === "loop") {
      const found = findBlock(block.body ?? [], id);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

function findBlockPosition(
  blocks: DiagramBlock[],
  id: string,
  container: ContainerKey = rootContainer,
): { container: ContainerKey; index: number } | null {
  for (const [index, block] of blocks.entries()) {
    if (block.id === id) {
      return { container, index };
    }

    if (block.kind === "decision") {
      const thenPosition = findBlockPosition(
        block.thenBranch ?? [],
        id,
        `${block.id}:then`,
      );
      if (thenPosition) {
        return thenPosition;
      }

      const elsePosition = findBlockPosition(
        block.elseBranch ?? [],
        id,
        `${block.id}:else`,
      );
      if (elsePosition) {
        return elsePosition;
      }
    }

    if (block.kind === "loop") {
      const bodyPosition = findBlockPosition(
        block.body ?? [],
        id,
        `${block.id}:body`,
      );
      if (bodyPosition) {
        return bodyPosition;
      }
    }
  }

  return null;
}

function updateBlock(
  blocks: DiagramBlock[],
  id: string,
  patch: Partial<Pick<DiagramBlock, "label" | "note">>,
): DiagramBlock[] {
  return blocks.map((block) => {
    if (block.id === id) {
      return { ...block, ...patch };
    }

    if (block.kind === "decision") {
      return {
        ...block,
        thenBranch: updateBlock(block.thenBranch ?? [], id, patch),
        elseBranch: updateBlock(block.elseBranch ?? [], id, patch),
      };
    }

    if (block.kind === "loop") {
      return {
        ...block,
        body: updateBlock(block.body ?? [], id, patch),
      };
    }

    return block;
  });
}

function cloneBlock(block: DiagramBlock): DiagramBlock {
  return {
    ...block,
    id: makeId(),
    label: `${block.label} copy`,
    thenBranch: block.thenBranch?.map(cloneBlock),
    elseBranch: block.elseBranch?.map(cloneBlock),
    body: block.body?.map(cloneBlock),
  };
}

function insertAfter(
  blocks: DiagramBlock[],
  id: string,
  copy: DiagramBlock,
): { blocks: DiagramBlock[]; inserted: boolean } {
  const index = blocks.findIndex((block) => block.id === id);

  if (index >= 0) {
    const next = [...blocks];
    next.splice(index + 1, 0, copy);
    return { blocks: next, inserted: true };
  }

  let inserted = false;
  const next = blocks.map((block) => {
    if (block.kind === "decision") {
      const thenResult = insertAfter(block.thenBranch ?? [], id, copy);
      if (thenResult.inserted) {
        inserted = true;
        return { ...block, thenBranch: thenResult.blocks };
      }

      const elseResult = insertAfter(block.elseBranch ?? [], id, copy);
      if (elseResult.inserted) {
        inserted = true;
        return { ...block, elseBranch: elseResult.blocks };
      }
    }

    if (block.kind === "loop") {
      const bodyResult = insertAfter(block.body ?? [], id, copy);
      if (bodyResult.inserted) {
        inserted = true;
        return { ...block, body: bodyResult.blocks };
      }
    }

    return block;
  });

  return { blocks: next, inserted };
}

function normalizeImportedBlocks(value: unknown): DiagramBlock[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const blocks: DiagramBlock[] = [];

  for (const item of value) {
    const block = normalizeImportedBlock(item);
    if (!block) {
      return null;
    }

    blocks.push(block);
  }

  return blocks;
}

function normalizeImportedBlock(value: unknown): DiagramBlock | null {
  if (!isRecord(value) || !isBlockKind(value.kind)) {
    return null;
  }

  const block: DiagramBlock = {
    id: makeId(),
    kind: value.kind,
    label: readText(value.label, blockNames[value.kind]),
    note: "",
  };
  block.note = readBlockNote(value.kind, block.label, value.note);

  if (value.kind === "decision") {
    const thenBranch = normalizeImportedBlocks(value.thenBranch ?? []);
    const elseBranch = normalizeImportedBlocks(value.elseBranch ?? []);

    if (!thenBranch || !elseBranch) {
      return null;
    }

    block.thenBranch = thenBranch;
    block.elseBranch = elseBranch;
  }

  if (value.kind === "loop") {
    const body = normalizeImportedBlocks(value.body ?? []);

    if (!body) {
      return null;
    }

    block.body = body;
  }

  return block;
}

function parseDiagramFile(raw: string): ImportedDiagram | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const blocks = normalizeImportedBlocks(parsed.blocks);
  if (!blocks) {
    return null;
  }

  return {
    title: readText(parsed.title, readText(parsed.diagramName, "Imported diagram")),
    blocks,
  };
}

function createDiagramPayload(title: string, blocks: DiagramBlock[]) {
  return {
    format: diagramFileFormat,
    version: diagramFileVersion,
    title,
    blocks,
  };
}

function readSavedDiagram() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(diagramStorageKey);
    return raw ? parseDiagramFile(raw) : null;
  } catch {
    return null;
  }
}

function parseDragPayload(event: React.DragEvent): DragPayload | null {
  const raw = event.dataTransfer.getData(dragMime);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

function getAutoScrollDelta(distanceFromEdge: number) {
  if (distanceFromEdge > autoScrollEdge) {
    return 0;
  }

  const intensity = 1 - Math.max(distanceFromEdge, 0) / autoScrollEdge;
  return Math.ceil(intensity * autoScrollMaxSpeed);
}

function getDropEffect(event: React.DragEvent): "copy" | "move" {
  const { effectAllowed } = event.dataTransfer;

  if (
    effectAllowed === "move" ||
    effectAllowed === "copyMove" ||
    effectAllowed === "linkMove" ||
    effectAllowed === "all"
  ) {
    return "move";
  }

  return "copy";
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function NassiEditor() {
  const [blocks, setBlocks] = useState<DiagramBlock[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [diagramName, setDiagramName] = useState("Untitled diagram");
  const [zoom, setZoom] = useState(100);
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isDraggingBlock, setIsDraggingBlock] = useState(false);
  const [hasRestoredDiagram, setHasRestoredDiagram] = useState(false);
  const [isInspectorDrawerOpen, setInspectorDrawerOpen] = useState(false);
  const [usesInspectorDrawer, setUsesInspectorDrawer] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.matchMedia(inspectorDrawerMediaQuery).matches;
  });
  const [inspectorMode, setInspectorMode] = useState<"edit" | "code">("edit");
  const [copyState, setCopyState] = useState("Copy code");
  const [theme, setTheme] = useState<Theme>("light");
  const [hasRestoredTheme, setHasRestoredTheme] = useState(false);
  const paperRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragPointRef = useRef<{ x: number; y: number } | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const selectedBlock = useMemo(
    () => findBlock(blocks, selectedId),
    [blocks, selectedId],
  );
  const generatedCode = useMemo(
    () => generateCode(diagramName, blocks),
    [blocks, diagramName],
  );

  useEffect(() => {
    try {
      setTheme(window.localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light");
    } catch {
      // Keep the default when browser storage is unavailable.
    }
    setHasRestoredTheme(true);
  }, []);

  useEffect(() => {
    if (!hasRestoredTheme) return;
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(themeStorageKey, theme);
    } catch {
      // Theme switching still works without persistence.
    }
  }, [theme, hasRestoredTheme]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInspectorDrawerOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  useEffect(() => {
    const savedDiagram = readSavedDiagram();

    if (savedDiagram) {
      setDiagramName(savedDiagram.title || "Untitled diagram");
      setBlocks(savedDiagram.blocks);
    }

    setHasRestoredDiagram(true);
  }, []);

  useEffect(() => {
    if (!hasRestoredDiagram) {
      return;
    }

    try {
      window.localStorage.setItem(
        diagramStorageKey,
        JSON.stringify(createDiagramPayload(diagramName, blocks)),
      );
    } catch {
      // Autosave is best-effort; file export remains available if storage is blocked.
    }
  }, [blocks, diagramName, hasRestoredDiagram]);

  useEffect(() => {
    const query = window.matchMedia(inspectorDrawerMediaQuery);
    const updateLayoutMode = () => setUsesInspectorDrawer(query.matches);

    updateLayoutMode();
    query.addEventListener("change", updateLayoutMode);

    return () => query.removeEventListener("change", updateLayoutMode);
  }, []);

  useEffect(() => {
    if (!isDraggingBlock) {
      dragPointRef.current = null;
      return;
    }

    let frameId = 0;

    function handleDragOver(event: DragEvent) {
      dragPointRef.current = { x: event.clientX, y: event.clientY };
      if (event.target instanceof Node && !viewportRef.current?.contains(event.target)) {
        setActiveSlot(null);
      }
    }

    function tick() {
      const viewport = viewportRef.current;
      const point = dragPointRef.current;

      if (viewport && point) {
        const bounds = viewport.getBoundingClientRect();
        const isInside =
          point.x >= bounds.left &&
          point.x <= bounds.right &&
          point.y >= bounds.top &&
          point.y <= bounds.bottom;

        if (isInside) {
          const left = getAutoScrollDelta(point.x - bounds.left);
          const right = getAutoScrollDelta(bounds.right - point.x);
          const top = getAutoScrollDelta(point.y - bounds.top);
          const bottom = getAutoScrollDelta(bounds.bottom - point.y);

          viewport.scrollBy({
            left: right - left,
            top: bottom - top,
          });
        }
      }

      frameId = window.requestAnimationFrame(tick);
    }

    window.addEventListener("dragover", handleDragOver, true);
    frameId = window.requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("dragover", handleDragOver, true);
      window.cancelAnimationFrame(frameId);
      dragPointRef.current = null;
    };
  }, [isDraggingBlock]);

  function addBlock(kind: BlockKind) {
    const block = createBlock(kind);
    setBlocks((current) => insertBlock(current, rootContainer, current.length, block));
    selectBlockAfterAutomaticPlacement(block.id);
  }

  function addStepToContainer(container: ContainerKey) {
    const block = createBlock("action");
    setBlocks((current) =>
      insertBlock(current, container, Number.MAX_SAFE_INTEGER, block),
    );
    setSelectedId(block.id);
    setInspectorDrawerOpen(true);
    setInspectorMode("edit");
  }

  function selectBlock(id: string) {
    setSelectedId(id);
    setInspectorMode("edit");
    setInspectorDrawerOpen(true);
  }

  function selectBlockAfterAutomaticPlacement(id: string) {
    if (usesInspectorDrawer) {
      setSelectedId(null);
      setInspectorDrawerOpen(false);
      return;
    }

    setSelectedId(id);
    setInspectorDrawerOpen(true);
  }

  function handleDrop(
    event: React.DragEvent,
    container: ContainerKey,
    index: number,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setActiveSlot(null);
    setIsDraggingBlock(false);

    const payload = parseDragPayload(event);
    if (!payload) {
      return;
    }

    if (payload.source === "palette") {
      const block = createBlock(payload.kind);
      setBlocks((current) => insertBlock(current, container, index, block));
      selectBlockAfterAutomaticPlacement(block.id);
      return;
    }

    setBlocks((current) => {
      const sourcePosition = findBlockPosition(current, payload.id);
      const result = removeBlock(current, payload.id);
      if (!result.removed || !containerExists(result.blocks, container)) {
        return current;
      }

      const targetIndex =
        sourcePosition?.container === container && sourcePosition.index < index
          ? index - 1
          : index;

      return insertBlock(result.blocks, container, targetIndex, result.removed);
    });
    selectBlockAfterAutomaticPlacement(payload.id);
  }

  function deleteSelected() {
    if (!selectedId) {
      return;
    }

    setBlocks((current) => removeBlock(current, selectedId).blocks);
    setSelectedId(null);
    setInspectorDrawerOpen(false);
  }

  function duplicateSelected() {
    if (!selectedBlock || !selectedId) {
      return;
    }

    const copy = cloneBlock(selectedBlock);
    setBlocks((current) => {
      const result = insertAfter(current, selectedId, copy);
      return result.inserted ? result.blocks : [...current, copy];
    });
    setSelectedId(copy.id);
    setInspectorDrawerOpen(true);
  }

  function clearDiagram() {
    if (!window.confirm("Clear the entire diagram? This cannot be undone.")) {
      return;
    }

    setBlocks([]);
    setSelectedId(null);
    setInspectorDrawerOpen(false);
  }

  function exportDiagramFile() {
    const payload = {
      ...createDiagramPayload(diagramName, blocks),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
      type: "application/json",
    });

    downloadBlob(blob, `${slugify(diagramName || "nassi-diagram")}.betternassi`);
  }

  async function importDiagramFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    try {
      const imported = parseDiagramFile(await file.text());
      if (!imported) {
        throw new Error("Invalid diagram file");
      }

      setDiagramName(imported.title || "Imported diagram");
      setBlocks(imported.blocks);
      setSelectedId(null);
      setInspectorDrawerOpen(false);
      setInspectorMode("edit");
      setActiveSlot(null);
      setIsDraggingBlock(false);
    } catch {
      window.alert("This file could not be imported as a BetterNassi diagram.");
    }
  }

  async function exportPng() {
    setIsExporting(true);
    try {
      if (!paperRef.current) return;
      const blob = await renderDiagramElementToPng(paperRef.current);
      downloadBlob(blob, `${slugify(diagramName || "nassi-diagram")}.png`);
    } catch {
      window.alert("The image could not be exported. Please try again.");
    } finally {
      setIsExporting(false);
    }
  }

  async function copyGeneratedCode() {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(generatedCode);
    }
    setCopyState("Copied");
    window.setTimeout(() => setCopyState("Copy code"), 1400);
  }

  return (
    <main className="editor-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <img
            alt=""
            aria-hidden="true"
            className="brand-mark"
            height="34"
            src="/favicon.svg"
            width="34"
          />
          <div>
            <h1>BetterNassi</h1>
            <p className="topbar-subtitle">Nassi-Shneiderman editor</p>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="theme-switcher" aria-label="Theme" role="group">
            <button
              aria-label="Light theme"
              aria-pressed={theme === "light"}
              title="Light theme"
              type="button"
              onClick={() => setTheme("light")}
            >
              <Sun size={16} aria-hidden="true" />
            </button>
            <button
              aria-label="Dark theme"
              aria-pressed={theme === "dark"}
              title="Dark theme"
              type="button"
              onClick={() => setTheme("dark")}
            >
              <Moon size={16} aria-hidden="true" />
            </button>
          </div>
          <button
            className="ghost-button"
            type="button"
            onClick={() => importInputRef.current?.click()}
          >
            <Upload size={16} aria-hidden="true" /> Import File
          </button>
          <button className="ghost-button" type="button" onClick={exportDiagramFile}>
            <Download size={16} aria-hidden="true" /> Export File
          </button>
          <button className="ghost-button" type="button" onClick={exportPng} disabled={isExporting}>
            <ImageDown size={16} aria-hidden="true" />
            {isExporting ? "Exporting" : "Export PNG"}
          </button>
          <input
            ref={importInputRef}
            className="file-input"
            type="file"
            accept=".betternassi,.json,application/json"
            onChange={importDiagramFile}
          />
        </div>
      </header>

      <section className={`app-grid ${isInspectorDrawerOpen ? "inspector-open" : ""}`} aria-label="Diagram editor">
        <aside className="side-panel palette-panel" aria-label="Block palette">
          <div className="panel-heading">
            <div>
              <h2>Blocks</h2>
            </div>
            <button className="inspector-toggle icon-button" type="button"
              title={isInspectorDrawerOpen ? "Close inspector" : "Open inspector"}
              aria-label={isInspectorDrawerOpen ? "Close inspector panel" : "Open inspector"}
              aria-expanded={isInspectorDrawerOpen}
              onClick={() => setInspectorDrawerOpen((open) => !open)}>
              <PanelRight size={18} />
            </button>
          </div>
          <div className="palette-list">
            {palette.map((item) => (
              <button
                className={`palette-item ${item.kind}`}
                draggable
                key={item.kind}
                onClick={() => addBlock(item.kind)}
                onDragEnd={() => {
                  setActiveSlot(null);
                  setIsDraggingBlock(false);
                }}
                onDragStart={(event) => {
                  setIsDraggingBlock(true);
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData(
                    dragMime,
                    JSON.stringify({ source: "palette", kind: item.kind }),
                  );
                }}
                type="button"
              >
                <span className="palette-shortcut" aria-hidden="true">
                  {item.kind === "action" ? <Square size={20} /> : item.kind === "io" ? <ArrowRightLeft size={20} /> : item.kind === "decision" ? <GitBranch size={20} /> : <Repeat2 size={20} />}
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                </span>
                <GripVertical className="palette-grip" size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
          <div className="palette-view-controls">
            <label className="zoom-control">
              <span>Zoom</span>
              <input aria-label="Canvas zoom" max="120" min="70" type="range" value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))} />
              <output>{zoom}%</output>
            </label>
          </div>
          <div className="palette-footer">
            <button
              className="clear-diagram-button"
              type="button"
              onClick={clearDiagram}
            >
              <Trash2 size={15} aria-hidden="true" /> Clear Diagram
            </button>
          </div>
        </aside>

        <section className="workspace-panel" aria-label="Diagram workspace">
          <div className="canvas-viewport" ref={viewportRef}
            onDragOver={(event) => {
              if (event.target !== event.currentTarget || !event.dataTransfer.types.includes(dragMime)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = getDropEffect(event);
              setActiveSlot(`${rootContainer}-${blocks.length}`);
            }}
            onDrop={(event) => {
              if (event.target === event.currentTarget) handleDrop(event, rootContainer, blocks.length);
            }}
          >
            <section
              aria-label={diagramName}
              className="diagram-paper"
              ref={paperRef}
              style={{ zoom: zoom / 100, minWidth: Math.max(440, listWidth(blocks)) }}
            >
              <div className="paper-title">
                <span>Nassi-Shneiderman</span>
                <div className="editable-title">
                  <strong className="title-mirror" aria-hidden="true">{diagramName || "Untitled diagram"}</strong>
                  <textarea aria-label="Diagram name" rows={1} value={diagramName}
                    placeholder="Untitled diagram"
                    onChange={(event) => setDiagramName(event.target.value.replace(/[\r\n]+/g, " "))}
                    onBlur={() => { if (!diagramName.trim()) setDiagramName("Untitled diagram"); }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
                    }}
                  />
                </div>
              </div>
              <BlockList
                activeSlot={activeSlot}
                blocks={blocks}
                container={rootContainer}
                isDragging={isDraggingBlock}
                onDelete={(id) => {
                  setBlocks((current) => removeBlock(current, id).blocks);
                  if (selectedId === id) {
                    setSelectedId(null);
                    setInspectorDrawerOpen(false);
                  }
                }}
                onDrop={handleDrop}
                onSelect={selectBlock}
                selectedId={selectedId}
                setActiveSlot={setActiveSlot}
                setIsDragging={setIsDraggingBlock}
              />
            </section>
          </div>
        </section>

        <aside
          className={`side-panel inspector-panel ${
            isInspectorDrawerOpen ? "drawer-open" : ""
          }`}
          aria-label="Block inspector"
        >
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Properties</p>
              <h2>
                {inspectorMode === "code"
                  ? "Generated code"
                : selectedBlock
                  ? blockNames[selectedBlock.kind]
                  : "Selection"}
              </h2>
            </div>
            <button
              aria-label="Close inspector"
              className="drawer-close"
              type="button"
              onClick={() => setInspectorDrawerOpen(false)}
            >
              <X size={18} />
            </button>
          </div>

          <div className="panel-tabs" role="tablist" aria-label="Inspector views">
            <button
              aria-selected={inspectorMode === "edit"}
              role="tab"
              type="button"
              onClick={() => setInspectorMode("edit")}
            >
              <MousePointer2 size={15} aria-hidden="true" /> Block
            </button>
            <button
              aria-selected={inspectorMode === "code"}
              role="tab"
              type="button"
              onClick={() => setInspectorMode("code")}
            >
              <Code2 size={16} aria-hidden="true" /> Code
            </button>
          </div>

          {inspectorMode === "code" ? (
            <div className="code-view">
              <div className="code-actions">
                <span>Pseudocode</span>
                <button type="button" onClick={copyGeneratedCode}>
                  <Copy size={14} aria-hidden="true" /> {copyState}
                </button>
              </div>
              <pre>{generatedCode}</pre>
            </div>
          ) : selectedBlock ? (
            <div className="inspector-form">
              <label>
                <span>Text</span>
                <input
                  value={selectedBlock.label}
                  onChange={(event) =>
                    setBlocks((current) =>
                      updateBlock(current, selectedBlock.id, {
                        label: event.target.value,
                      }),
                    )
                  }
                />
              </label>
              <label>
                <span>Detail</span>
                <textarea
                  rows={4}
                  value={selectedBlock.note}
                  onChange={(event) =>
                    setBlocks((current) =>
                      updateBlock(current, selectedBlock.id, {
                        note: event.target.value,
                      }),
                    )
                  }
                />
              </label>
              {selectedBlock.kind === "decision" ? (
                <div className="branch-inspector-actions">
                  <button
                    type="button"
                    onClick={() => addStepToContainer(`${selectedBlock.id}:then`)}
                  >
                    Add true step
                  </button>
                  <button
                    type="button"
                    onClick={() => addStepToContainer(`${selectedBlock.id}:else`)}
                  >
                    Add false step
                  </button>
                </div>
              ) : null}
              <div className="inspector-actions">
                <button type="button" onClick={duplicateSelected}>
                  <Copy size={15} aria-hidden="true" /> Duplicate
                </button>
                <button className="danger-button" type="button" onClick={deleteSelected}>
                  <Trash2 size={15} aria-hidden="true" /> Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-inspector">
              <MousePointer2 size={26} strokeWidth={1.3} aria-hidden="true" />
              <span>No block selected</span>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function generateCode(title: string, blocks: DiagramBlock[]) {
  const lines = [`procedure ${toProcedureName(title)}`, ...renderCodeBlocks(blocks, 1), "end procedure"];
  return lines.join("\n");
}

function renderCodeBlocks(blocks: DiagramBlock[], depth: number): string[] {
  if (blocks.length === 0) {
    return [`${indent(depth)}pass`];
  }

  return blocks.flatMap((block) => {
    const detail = block.note ? ` // ${block.note}` : "";

    if (block.kind === "io") {
      return [`${indent(depth)}io "${block.label}"${detail}`];
    }

    if (block.kind === "action") {
      return [`${indent(depth)}${block.label}${detail}`];
    }

    if (block.kind === "decision") {
      return [
        `${indent(depth)}if ${block.label} then${detail}`,
        ...renderCodeBlocks(block.thenBranch ?? [], depth + 1),
        `${indent(depth)}else`,
        ...renderCodeBlocks(block.elseBranch ?? [], depth + 1),
        `${indent(depth)}end if`,
      ];
    }

    return [
      `${indent(depth)}while ${block.label} do${detail}`,
      ...renderCodeBlocks(block.body ?? [], depth + 1),
      `${indent(depth)}end while`,
    ];
  });
}

function indent(depth: number) {
  return "  ".repeat(depth);
}

function toProcedureName(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "nassi_diagram";
}

function blockRows(block: DiagramBlock): number {
  if (block.kind === "decision") {
    return 1 + Math.max(listRows(block.thenBranch ?? []), listRows(block.elseBranch ?? []));
  }
  if (block.kind === "loop") return 1 + listRows(block.body ?? []);
  return 1;
}

function listRows(blocks: DiagramBlock[]): number {
  return Math.max(1, blocks.reduce((total, block) => total + blockRows(block), 0));
}

function listWidth(blocks: DiagramBlock[]): number {
  return Math.max(180, ...blocks.map((block): number => {
    if (block.kind === "decision") {
      return 2 * Math.max(listWidth(block.thenBranch ?? []), listWidth(block.elseBranch ?? []));
    }
    return block.kind === "loop" ? 28 + listWidth(block.body ?? []) : 180;
  }));
}

type BlockViewProps = {
  activeSlot: string | null;
  isDragging: boolean;
  onDelete: (id: string) => void;
  onDrop: (event: React.DragEvent, container: ContainerKey, index: number) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  setActiveSlot: (slot: string | null) => void;
  setIsDragging: (isDragging: boolean) => void;
};

function BlockList({
  blocks, container, rows = listRows(blocks), ...props
}: BlockViewProps & { blocks: DiagramBlock[]; container: ContainerKey; rows?: number }) {
  const isRoot = container === rootContainer;
  const active = props.isDragging && props.activeSlot?.startsWith(`${container}-`);
  return (
    <div
      className={`block-list ${isRoot ? "root-list" : ""} ${blocks.length ? "" : "empty"} ${active ? "drop-container" : ""}`}
      data-container={container}
      style={{ gridTemplateRows: isRoot ? `repeat(${rows}, minmax(80px, auto))` : undefined }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(dragMime)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = getDropEffect(event);
        props.setActiveSlot(`${container}-${blocks.length}`);
      }}
      onDrop={(event) => props.onDrop(event, container, blocks.length)}
    >
      {blocks.length === 0 ? (
        <div className={`empty-target ${active ? "is-active" : ""}`}>
          <Plus size={20} aria-hidden="true" />
          <span>{isRoot ? "Add your first block" : "Empty branch"}</span>
        </div>
      ) : blocks.map((block, index) => (
        <DiagramBlockView
          key={block.id}
          {...props}
          block={block}
          container={container}
          index={index}
          rows={blockRows(block) + (index === blocks.length - 1 ? rows - listRows(blocks) : 0)}
        />
      ))}
    </div>
  );
}

function DiagramBlockView({
  block, container, index, rows, ...props
}: BlockViewProps & { block: DiagramBlock; container: ContainerKey; index: number; rows: number }) {
  const isSelected = props.selectedId === block.id;
  const before = props.isDragging && props.activeSlot === `${container}-${index}`;
  const after = props.isDragging && props.activeSlot === `${container}-${index + 1}`;
  const composite = block.kind === "decision" || block.kind === "loop";

  function targetAt(event: React.DragEvent<HTMLElement>): { container: ContainerKey; index: number } {
    const bounds = event.currentTarget.getBoundingClientRect();
    const head = event.currentTarget.querySelector(":scope > .decision-head, :scope > .loop-head");
    const headBounds = head?.getBoundingClientRect();
    if (composite && headBounds && event.clientY > bounds.top + 16 && event.clientY < headBounds.bottom) {
      return {
        container: block.kind === "loop" ? `${block.id}:body` :
          event.clientX < bounds.left + bounds.width / 2 ? `${block.id}:then` : `${block.id}:else`,
        index: 0,
      };
    }
    if (block.kind === "loop" && (event.target as HTMLElement).closest(".loop-rail")) {
      return { container: `${block.id}:body`, index: block.body?.length ?? 0 };
    }
    return { container, index: event.clientY < bounds.top + bounds.height / 2 ? index : index + 1 };
  }

  function hover(event: React.DragEvent<HTMLElement>, edgeOnly = false) {
    if (!event.dataTransfer.types.includes(dragMime)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (edgeOnly && (!composite || (event.clientY > bounds.top + 8 && event.clientY < bounds.bottom - 8))) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = getDropEffect(event);
    const target = edgeOnly ? { container, index: event.clientY < bounds.top + 8 ? index : index + 1 } : targetAt(event);
    props.setActiveSlot(`${target.container}-${target.index}`);
  }

  return (
    <article
      className={`nassi-block ${block.kind} ${isSelected ? "selected" : ""} ${before ? "insert-before" : ""} ${after ? "insert-after" : ""}`}
      data-block-id={block.id}
      data-index={index}
      style={{ gridRow: `span ${rows}` }}
      draggable
      tabIndex={0}
      aria-label={`${blockNames[block.kind]}: ${block.label}`}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelect(block.id);
        }
      }}
      onClick={(event) => {
        event.stopPropagation();
        props.onSelect(block.id);
      }}
      onDragStart={(event) => {
        event.stopPropagation();
        props.setIsDragging(true);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(dragMime, JSON.stringify({ source: "diagram", id: block.id }));
      }}
      onDragEnd={() => {
        props.setActiveSlot(null);
        props.setIsDragging(false);
      }}
      onDragOverCapture={(event) => hover(event, true)}
      onDropCapture={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (composite && (event.clientY <= bounds.top + 8 || event.clientY >= bounds.bottom - 8)) {
          props.onDrop(event, container, event.clientY <= bounds.top + 8 ? index : index + 1);
        }
      }}
      onDragOver={(event) => hover(event)}
      onDrop={(event) => {
        const target = targetAt(event);
        props.onDrop(event, target.container, target.index);
      }}
    >
      <div className="block-tools">
        <button aria-label={`Delete ${block.label}`} title="Delete block" type="button"
          onClick={(event) => { event.stopPropagation(); props.onDelete(block.id); }}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      {block.kind === "decision" ? (
        <>
          <div className="decision-head">
            <svg className="decision-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <path d="M0 0 L50 100 L100 0" vectorEffect="non-scaling-stroke" />
            </svg>
            <span className="block-label">{block.label}</span>
            {block.note ? <small>{block.note}</small> : null}
            <span className="branch-label true-label">True</span>
            <span className="branch-label false-label">False</span>
          </div>
          <div className="decision-branches" style={{ gridRow: `span ${rows - 1}` }}>
            <div className="branch-column">
              <BlockList {...props} blocks={block.thenBranch ?? []} container={`${block.id}:then`} rows={rows - 1} />
            </div>
            <div className="branch-column">
              <BlockList {...props} blocks={block.elseBranch ?? []} container={`${block.id}:else`} rows={rows - 1} />
            </div>
          </div>
        </>
      ) : block.kind === "loop" ? (
        <>
          <div className="loop-head">
            <span className="block-label">{block.label}</span>
            {block.note ? <small>{block.note}</small> : null}
          </div>
          <div className="loop-body" style={{ gridRow: `span ${rows - 1}` }}>
            <span className="loop-rail"><Repeat2 size={15} aria-hidden="true" /></span>
            <BlockList {...props} blocks={block.body ?? []} container={`${block.id}:body`} rows={rows - 1} />
          </div>
        </>
      ) : (
        <div className="simple-block-content" style={{ gridRow: `span ${rows}` }}>
          <span className="block-label">{block.label}</span>
          {block.note ? <small>{block.note}</small> : null}
        </div>
      )}
    </article>
  );
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function renderDiagramElementToPng(source: HTMLElement) {
  await document.fonts.ready;
  const bounds = source.getBoundingClientRect();
  const zoom = bounds.width / source.offsetWidth;
  const width = bounds.width / zoom;
  const height = bounds.height / zoom;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * 2);
  canvas.height = Math.ceil(height * 2);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available");
  context.scale(2, 2);
  const icons: Promise<void>[] = [];

  // Paint the measured layout directly: no second layout engine or export-only sizing.
  function paint(element: Element) {
    if (!context || element.matches(".block-tools")) return;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const x = (rect.left - bounds.left) / zoom;
    const y = (rect.top - bounds.top) / zoom;
    const w = rect.width / zoom;
    const h = rect.height / zoom;
    if (style.display === "none" || (style.visibility === "hidden" && !element.matches(".title-mirror"))) return;

    if (element instanceof SVGElement) {
      if (element.classList.contains("decision-lines")) {
        context.strokeStyle = getComputedStyle(element.querySelector("path")!).stroke;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + w / 2, y + h);
        context.lineTo(x + w, y);
        context.stroke();
      } else if (element.tagName.toLowerCase() === "svg") {
        const svg = element.cloneNode(true) as SVGElement;
        svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        svg.setAttribute("style", `color:${style.color}`);
        icons.push(new Promise<void>((resolve, reject) => {
          const image = new Image();
          image.onload = () => { context.drawImage(image, x, y, w, h); resolve(); };
          image.onerror = () => reject(new Error("Could not render diagram icon"));
          image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
        }));
      }
      return;
    }

    context.fillStyle = style.backgroundColor;
    context.fillRect(x, y, w, h);
    const borders = [
      [style.borderTopWidth, style.borderTopColor, x, y, w, parseFloat(style.borderTopWidth)],
      [style.borderBottomWidth, style.borderBottomColor, x, y + h - parseFloat(style.borderBottomWidth), w, parseFloat(style.borderBottomWidth)],
      [style.borderLeftWidth, style.borderLeftColor, x, y, parseFloat(style.borderLeftWidth), h],
      [style.borderRightWidth, style.borderRightColor, x + w - parseFloat(style.borderRightWidth), y, parseFloat(style.borderRightWidth), h],
    ] as const;
    for (const [size, color, bx, by, bw, bh] of borders) {
      if (parseFloat(size) > 0) {
        context.fillStyle = color;
        context.fillRect(bx, by, bw, bh);
      }
    }

    if (element.matches(".block-label, .paper-title span, .paper-title strong, small, .branch-label")) {
      const fontSize = parseFloat(style.fontSize);
      const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.4;
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      context.fillStyle = style.color;
      context.textAlign = style.textAlign === "center" ? "center" : "left";
      context.textBaseline = "alphabetic";
      const text = style.textTransform === "uppercase" ? element.textContent?.toUpperCase() : element.textContent;
      const lines = style.whiteSpace === "nowrap"
        ? [text ?? ""]
        : wrapCanvasText(context, text ?? "", w);
      lines.forEach((line, index) => {
        context.fillText(line, context.textAlign === "center" ? x + w / 2 : x, y + (lineHeight - fontSize) / 2 + fontSize * .8 + index * lineHeight);
      });
      return;
    }
    for (const child of element.children) paint(child);
  }

  paint(source);
  await Promise.all(icons);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG export failed")), "image/png");
  });
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      for (const character of word) {
        if (line && context.measureText(line + character).width > width) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}
