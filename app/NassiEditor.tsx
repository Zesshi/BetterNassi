"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";

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

const dragMime = "application/x-betternassi-block";
const rootContainer: ContainerKey = "root";
const themeStorageKey = "betternassi-theme";

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

function createBlock(kind: BlockKind): DiagramBlock {
  const id = makeId();

  if (kind === "decision") {
    return {
      id,
      kind,
      label: "Condition?",
      note: "true / false",
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
      note: "loop body",
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
    note: kind === "io" ? "data" : "",
  };
}

function createSampleDiagram(): DiagramBlock[] {
  return [
    {
      id: "sample-start",
      kind: "action",
      label: "Start request",
      note: "initialize context",
    },
    {
      id: "sample-valid",
      kind: "decision",
      label: "Input valid?",
      note: "validation gate",
      thenBranch: [
        {
          id: "sample-read",
          kind: "io",
          label: "Read customer data",
          note: "payload",
        },
        {
          id: "sample-loop",
          kind: "loop",
          label: "For each item",
          note: "order lines",
          body: [
            {
              id: "sample-calc",
              kind: "action",
              label: "Calculate subtotal",
              note: "price * quantity",
            },
          ],
        },
      ],
      elseBranch: [
        {
          id: "sample-error",
          kind: "action",
          label: "Show validation message",
          note: "stop flow",
        },
      ],
    },
    {
      id: "sample-save",
      kind: "action",
      label: "Save result",
      note: "finish",
    },
  ];
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

export function NassiEditor() {
  const [blocks, setBlocks] = useState<DiagramBlock[]>(() => createSampleDiagram());
  const [selectedId, setSelectedId] = useState<string | null>("sample-valid");
  const [diagramName, setDiagramName] = useState("Order validation flow");
  const [zoom, setZoom] = useState(92);
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isDraggingBlock, setIsDraggingBlock] = useState(false);
  const [inspectorMode, setInspectorMode] = useState<"edit" | "code">("edit");
  const [copyState, setCopyState] = useState("Copy code");
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") {
      return "dark";
    }

    return window.localStorage.getItem(themeStorageKey) === "light"
      ? "light"
      : "dark";
  });
  const paperRef = useRef<HTMLElement | null>(null);

  const selectedBlock = useMemo(
    () => findBlock(blocks, selectedId),
    [blocks, selectedId],
  );
  const generatedCode = useMemo(
    () => generateCode(diagramName, blocks),
    [blocks, diagramName],
  );
  const blockStats = useMemo(() => countBlocks(blocks), [blocks]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  function addBlock(kind: BlockKind) {
    const block = createBlock(kind);
    setBlocks((current) => insertBlock(current, rootContainer, current.length, block));
    setSelectedId(block.id);
  }

  function addStepToContainer(container: ContainerKey) {
    const block = createBlock("action");
    setBlocks((current) =>
      insertBlock(current, container, Number.MAX_SAFE_INTEGER, block),
    );
    setSelectedId(block.id);
    setInspectorMode("edit");
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
      setSelectedId(block.id);
      return;
    }

    setBlocks((current) => {
      const result = removeBlock(current, payload.id);
      if (!result.removed || !containerExists(result.blocks, container)) {
        return current;
      }

      return insertBlock(result.blocks, container, index, result.removed);
    });
    setSelectedId(payload.id);
  }

  function deleteSelected() {
    if (!selectedId) {
      return;
    }

    setBlocks((current) => removeBlock(current, selectedId).blocks);
    setSelectedId(null);
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
  }

  function clearDiagram() {
    setBlocks([]);
    setSelectedId(null);
  }

  async function exportPng() {
    setIsExporting(true);
    try {
      let blob: Blob;

      try {
        blob = paperRef.current
          ? await renderDiagramElementToPng(paperRef.current)
          : await renderDiagramToPng(diagramName, blocks);
      } catch {
        blob = await renderDiagramToPng(diagramName, blocks);
      }

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${slugify(diagramName || "nassi-diagram")}.png`;
      anchor.click();
      URL.revokeObjectURL(url);
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
          <span className="brand-glyph" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <div>
            <h1>BetterNassi</h1>
            <p className="topbar-subtitle">Nassi-Shneiderman editor</p>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="topbar-stat" aria-label={`${blockStats} blocks`}>
            <span>{blockStats}</span>
            <small>blocks</small>
          </div>
          <div className="theme-switcher" aria-label="Theme" role="group">
            <button
              aria-pressed={theme === "dark"}
              type="button"
              onClick={() => setTheme("dark")}
            >
              Dark
            </button>
            <button
              aria-pressed={theme === "light"}
              type="button"
              onClick={() => setTheme("light")}
            >
              Light
            </button>
          </div>
          <button className="ghost-button" type="button" onClick={clearDiagram}>
            Clear
          </button>
          <button className="primary-button" type="button" onClick={exportPng}>
            {isExporting ? "Exporting" : "Export PNG"}
          </button>
        </div>
      </header>

      <section className="app-grid" aria-label="Diagram editor">
        <aside className="side-panel palette-panel" aria-label="Block palette">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Palette</p>
              <h2>Structure</h2>
            </div>
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
                <span className="palette-shortcut">{item.shortcut}</span>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="workspace-panel" aria-label="Diagram workspace">
          <div className="workspace-toolbar">
            <label className="title-field">
              <span>Diagram</span>
              <input
                aria-label="Diagram name"
                value={diagramName}
                onChange={(event) => setDiagramName(event.target.value)}
              />
            </label>
            <label className="zoom-control">
              <span>Zoom</span>
              <input
                aria-label="Canvas zoom"
                max="120"
                min="70"
                onChange={(event) => setZoom(Number(event.target.value))}
                type="range"
                value={zoom}
              />
              <output>{zoom}%</output>
            </label>
            <div className="workspace-readout" aria-hidden="true">
              <span>draft</span>
              <strong>{blockStats}</strong>
            </div>
          </div>

          <div className="canvas-viewport">
            <section
              aria-label={diagramName}
              className="diagram-paper"
              ref={paperRef}
              style={{ transform: `scale(${zoom / 100})` }}
            >
              <div className="paper-title">
                <span>Nassi-Shneiderman</span>
                <strong>{diagramName}</strong>
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
                  }
                }}
                onDrop={handleDrop}
                onSelect={setSelectedId}
                selectedId={selectedId}
                setActiveSlot={setActiveSlot}
                setIsDragging={setIsDraggingBlock}
              />
            </section>
          </div>
        </section>

        <aside className="side-panel inspector-panel" aria-label="Block inspector">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Inspector</p>
              <h2>
                {inspectorMode === "code"
                  ? "Generated code"
                  : selectedBlock
                    ? blockNames[selectedBlock.kind]
                    : "Selection"}
              </h2>
            </div>
          </div>

          <div className="panel-tabs" role="tablist" aria-label="Inspector views">
            <button
              aria-selected={inspectorMode === "edit"}
              role="tab"
              type="button"
              onClick={() => setInspectorMode("edit")}
            >
              Block
            </button>
            <button
              aria-selected={inspectorMode === "code"}
              role="tab"
              type="button"
              onClick={() => setInspectorMode("code")}
            >
              Code
            </button>
          </div>

          {inspectorMode === "code" ? (
            <div className="code-view">
              <div className="code-actions">
                <span>Pseudocode</span>
                <button type="button" onClick={copyGeneratedCode}>
                  {copyState}
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
                  Duplicate
                </button>
                <button className="danger-button" type="button" onClick={deleteSelected}>
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-inspector">
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

function countBlocks(blocks: DiagramBlock[]): number {
  return blocks.reduce((total, block) => {
    if (block.kind === "decision") {
      return (
        total +
        1 +
        countBlocks(block.thenBranch ?? []) +
        countBlocks(block.elseBranch ?? [])
      );
    }

    if (block.kind === "loop") {
      return total + 1 + countBlocks(block.body ?? []);
    }

    return total + 1;
  }, 0);
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

function BlockList({
  activeSlot,
  blocks,
  container,
  isDragging,
  onDelete,
  onDrop,
  onSelect,
  selectedId,
  setActiveSlot,
  setIsDragging,
}: {
  activeSlot: string | null;
  blocks: DiagramBlock[];
  container: ContainerKey;
  isDragging: boolean;
  onDelete: (id: string) => void;
  onDrop: (event: React.DragEvent, container: ContainerKey, index: number) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  setActiveSlot: (slot: string | null) => void;
  setIsDragging: (isDragging: boolean) => void;
}) {
  return (
    <div className={`block-list ${blocks.length === 0 ? "empty" : ""}`}>
      <DropSlot
        activeSlot={activeSlot}
        container={container}
        index={0}
        isDragging={isDragging}
        isEmpty={blocks.length === 0}
        onDrop={onDrop}
        setActiveSlot={setActiveSlot}
      />
      {blocks.map((block, index) => (
        <Fragment key={block.id}>
          <DiagramBlockView
            activeSlot={activeSlot}
            block={block}
            isDragging={isDragging}
            onDelete={onDelete}
            onDrop={onDrop}
            onSelect={onSelect}
            selectedId={selectedId}
            setActiveSlot={setActiveSlot}
            setIsDragging={setIsDragging}
          />
          <DropSlot
            activeSlot={activeSlot}
            container={container}
            index={index + 1}
            isDragging={isDragging}
            onDrop={onDrop}
            setActiveSlot={setActiveSlot}
          />
        </Fragment>
      ))}
    </div>
  );
}

function DropSlot({
  activeSlot,
  container,
  index,
  isDragging,
  isEmpty = false,
  onDrop,
  setActiveSlot,
}: {
  activeSlot: string | null;
  container: ContainerKey;
  index: number;
  isDragging: boolean;
  isEmpty?: boolean;
  onDrop: (event: React.DragEvent, container: ContainerKey, index: number) => void;
  setActiveSlot: (slot: string | null) => void;
}) {
  const id = `${container}-${index}`;

  return (
    <div
      className={`drop-slot ${isDragging ? "is-dragging" : ""} ${
        isEmpty ? "empty-slot" : ""
      } ${
        activeSlot === id ? "is-active" : ""
      }`}
      onDragLeave={() => setActiveSlot(null)}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setActiveSlot(id);
      }}
      onDrop={(event) => onDrop(event, container, index)}
    >
      {isEmpty || isDragging ? (
        <span>{isDragging ? "Drop here" : "Drop block"}</span>
      ) : null}
    </div>
  );
}

function DiagramBlockView({
  activeSlot,
  block,
  isDragging,
  onDelete,
  onDrop,
  onSelect,
  selectedId,
  setActiveSlot,
  setIsDragging,
}: {
  activeSlot: string | null;
  block: DiagramBlock;
  isDragging: boolean;
  onDelete: (id: string) => void;
  onDrop: (event: React.DragEvent, container: ContainerKey, index: number) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  setActiveSlot: (slot: string | null) => void;
  setIsDragging: (isDragging: boolean) => void;
}) {
  const isSelected = selectedId === block.id;

  return (
    <article
      className={`nassi-block ${block.kind} ${isSelected ? "selected" : ""}`}
      draggable
      onClick={(event) => {
        event.stopPropagation();
        onSelect(block.id);
      }}
      onDragEnd={() => {
        setActiveSlot(null);
        setIsDragging(false);
      }}
      onDragStart={(event) => {
        event.stopPropagation();
        setIsDragging(true);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(
          dragMime,
          JSON.stringify({ source: "diagram", id: block.id }),
        );
      }}
    >
      <div className="block-tools">
        <button
          aria-label={`Delete ${block.label}`}
          onClick={(event) => {
            event.stopPropagation();
            onDelete(block.id);
          }}
          type="button"
        >
          ×
        </button>
      </div>

      {block.kind === "decision" ? (
        <>
          <div className="decision-head">
            <span className="block-label">{block.label}</span>
            {block.note ? <small>{block.note}</small> : null}
          </div>
          <div className="decision-branches">
            <div className="branch-column">
              <BlockList
                activeSlot={activeSlot}
                blocks={block.thenBranch ?? []}
                container={`${block.id}:then`}
                isDragging={isDragging}
                onDelete={onDelete}
                onDrop={onDrop}
                onSelect={onSelect}
                selectedId={selectedId}
                setActiveSlot={setActiveSlot}
                setIsDragging={setIsDragging}
              />
            </div>
            <div className="branch-column">
              <BlockList
                activeSlot={activeSlot}
                blocks={block.elseBranch ?? []}
                container={`${block.id}:else`}
                isDragging={isDragging}
                onDelete={onDelete}
                onDrop={onDrop}
                onSelect={onSelect}
                selectedId={selectedId}
                setActiveSlot={setActiveSlot}
                setIsDragging={setIsDragging}
              />
            </div>
          </div>
        </>
      ) : null}

      {block.kind === "loop" ? (
        <>
          <div className="loop-head">
            <span className="block-label">{block.label}</span>
            {block.note ? <small>{block.note}</small> : null}
          </div>
          <div className="loop-body">
            <span className="loop-rail">Loop</span>
            <BlockList
              activeSlot={activeSlot}
              blocks={block.body ?? []}
              container={`${block.id}:body`}
              isDragging={isDragging}
              onDelete={onDelete}
              onDrop={onDrop}
              onSelect={onSelect}
              selectedId={selectedId}
              setActiveSlot={setActiveSlot}
              setIsDragging={setIsDragging}
            />
          </div>
        </>
      ) : null}

      {block.kind === "action" || block.kind === "io" ? (
        <div className="simple-block-content">
          <span className="block-label">{block.label}</span>
          {block.note ? <small>{block.note}</small> : null}
        </div>
      ) : null}
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

async function renderDiagramToPng(title: string, blocks: DiagramBlock[]) {
  const margin = 64;
  const width = 1180;
  const diagramWidth = width - margin * 2;
  const titleHeight = 104;
  const height = titleHeight + measureList(blocks, diagramWidth) + margin * 2;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas is not available");
  }

  context.scale(scale, scale);
  context.fillStyle = "#f8faf7";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.strokeStyle = "#111827";
  context.lineWidth = 2;
  context.fillRect(margin, margin, diagramWidth, height - margin * 2);
  context.strokeRect(margin, margin, diagramWidth, height - margin * 2);

  context.fillStyle = "#111827";
  context.font = "700 30px Arial, sans-serif";
  drawWrappedText(context, title || "Nassi-Shneiderman diagram", margin + 28, margin + 44, diagramWidth - 56, 34, 2);
  context.font = "600 14px Arial, sans-serif";
  context.fillStyle = "#64706a";
  context.fillText("BetterNassi", margin + 28, margin + 86);

  drawList(context, blocks, margin, margin + titleHeight, diagramWidth);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("PNG export failed"));
      }
    }, "image/png");
  });
}

async function renderDiagramElementToPng(source: HTMLElement) {
  const width = Math.ceil(source.scrollWidth);
  const height = Math.ceil(source.scrollHeight);
  const clone = source.cloneNode(true) as HTMLElement;
  clone.classList.add("export-copy");
  clone.style.transform = "none";
  clone.style.width = `${width}px`;
  clone.style.minHeight = `${height}px`;
  clone.querySelectorAll(".selected").forEach((item) => {
    item.classList.remove("selected");
  });

  const styles = collectDocumentStyles();
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml">
          <style>
            ${styles}
            .export-copy {
              box-shadow: none !important;
              margin: 0 !important;
              max-width: none !important;
            }
            .export-copy .block-tools,
            .export-copy .drop-slot {
              display: none !important;
            }
          </style>
          ${clone.outerHTML}
        </div>
      </foreignObject>
    </svg>
  `;

  const image = await loadSvgImage(svg);
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas is not available");
  }

  context.scale(scale, scale);
  context.fillStyle = "#fdfdfb";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("PNG export failed"));
      }
    }, "image/png");
  });
}

function collectDocumentStyles() {
  return Array.from(document.styleSheets)
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join("\n");
      } catch {
        return "";
      }
    })
    .join("\n");
}

function loadSvgImage(svg: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Diagram export image failed to load"));
    };
    image.src = url;
  });
}

function measureList(blocks: DiagramBlock[], width: number): number {
  if (blocks.length === 0) {
    return 62;
  }

  return blocks.reduce((sum, block) => sum + measureBlock(block, width), 0);
}

function measureBlock(block: DiagramBlock, width: number): number {
  if (block.kind === "decision") {
    const branchWidth = width / 2;
    return (
      92 +
      Math.max(
        measureList(block.thenBranch ?? [], branchWidth),
        measureList(block.elseBranch ?? [], branchWidth),
      )
    );
  }

  if (block.kind === "loop") {
    return 82 + measureList(block.body ?? [], Math.max(260, width - 72));
  }

  return 78;
}

function drawList(
  context: CanvasRenderingContext2D,
  blocks: DiagramBlock[],
  x: number,
  y: number,
  width: number,
) {
  if (blocks.length === 0) {
    context.save();
    context.setLineDash([8, 8]);
    context.strokeStyle = "#a8b4ad";
    context.strokeRect(x, y, width, 62);
    context.setLineDash([]);
    context.fillStyle = "#87918b";
    context.font = "600 16px Arial, sans-serif";
    context.textAlign = "center";
    context.fillText("Empty", x + width / 2, y + 38);
    context.restore();
    return;
  }

  let cursor = y;
  for (const block of blocks) {
    const height = measureBlock(block, width);
    drawBlock(context, block, x, cursor, width, height);
    cursor += height;
  }
}

function drawBlock(
  context: CanvasRenderingContext2D,
  block: DiagramBlock,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  context.save();
  context.strokeStyle = "#111827";
  context.lineWidth = 2;
  context.fillStyle =
    block.kind === "io"
      ? "#ecfeff"
      : block.kind === "decision"
        ? "#fff7ed"
        : block.kind === "loop"
          ? "#f0fdf4"
          : "#ffffff";
  context.fillRect(x, y, width, height);
  context.strokeRect(x, y, width, height);

  if (block.kind === "decision") {
    const headHeight = 92;
    const branchHeight = height - headHeight;
    context.fillStyle = "#fff7ed";
    context.fillRect(x, y, width, headHeight);
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + width / 2, y + headHeight);
    context.lineTo(x + width, y);
    context.stroke();
    context.beginPath();
    context.moveTo(x + width / 2, y + headHeight);
    context.lineTo(x + width / 2, y + height);
    context.stroke();

    context.fillStyle = "#111827";
    context.font = "700 20px Arial, sans-serif";
    drawWrappedText(context, block.label, x + width * 0.25, y + 33, width * 0.5, 24, 2, "center");
    drawList(context, block.thenBranch ?? [], x, y + headHeight, width / 2);
    drawList(context, block.elseBranch ?? [], x + width / 2, y + headHeight, width / 2);

    if (branchHeight > 0) {
      context.strokeRect(x, y + headHeight, width / 2, branchHeight);
      context.strokeRect(x + width / 2, y + headHeight, width / 2, branchHeight);
    }
    context.restore();
    return;
  }

  if (block.kind === "loop") {
    const headHeight = 82;
    const railWidth = 72;
    context.fillStyle = "#dcfce7";
    context.fillRect(x, y, width, headHeight);
    context.strokeRect(x, y, width, headHeight);
    context.fillStyle = "#111827";
    context.font = "700 20px Arial, sans-serif";
    drawWrappedText(context, block.label, x + 24, y + 32, width - 48, 24, 2);
    context.fillStyle = "#dcfce7";
    context.fillRect(x, y + headHeight, railWidth, height - headHeight);
    context.strokeRect(x, y + headHeight, railWidth, height - headHeight);
    context.fillStyle = "#166534";
    context.font = "700 13px Arial, sans-serif";
    context.save();
    context.translate(x + 26, y + headHeight + (height - headHeight) / 2);
    context.rotate(-Math.PI / 2);
    context.textAlign = "center";
    context.fillText("LOOP", 0, 0);
    context.restore();
    drawList(context, block.body ?? [], x + railWidth, y + headHeight, width - railWidth);
    context.restore();
    return;
  }

  context.fillStyle = block.kind === "io" ? "#155e75" : "#111827";
  context.font = "700 20px Arial, sans-serif";
  drawWrappedText(context, block.label, x + 26, y + 33, width - 52, 24, 2);

  if (block.note) {
    context.fillStyle = "#64706a";
    context.font = "600 13px Arial, sans-serif";
    drawWrappedText(context, block.note, x + 26, y + 62, width - 52, 16, 1);
  }

  context.restore();
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
  align: CanvasTextAlign = "left",
) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words.length ? words : ["Untitled"]) {
    const testLine = line ? `${line} ${word}` : word;
    if (context.measureText(testLine).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) {
        break;
      }
    } else {
      line = testLine;
    }
  }

  if (line && lines.length < maxLines) {
    lines.push(line);
  }

  context.textAlign = align;
  const drawX = align === "center" ? x + maxWidth / 2 : x;
  lines.slice(0, maxLines).forEach((item, index) => {
    context.fillText(item, drawX, y + index * lineHeight);
  });
  context.textAlign = "left";
}
