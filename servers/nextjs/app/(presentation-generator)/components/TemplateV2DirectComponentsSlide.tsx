"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
  type CSSProperties,
} from "react";
import type Konva from "konva";
import { useDispatch } from "react-redux";
import { useHotkey } from "@tanstack/react-hotkeys";
import { Loader2 } from "lucide-react";
import {
  Ellipse,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
  Transformer,
} from "react-konva";
import { notify } from "@/components/ui/sonner";
import type { TemplateV2Layout } from "@/components/slide-editor/lib/template-v2-import";
import {
  loadKonvaImage,
  svgToDataUri,
} from "@/components/slide-editor/slide-surface/konva/exportAssets";
import { updateSlideUi } from "@/store/slices/presentationGeneration";
import { resolveBackendAssetSource } from "@/utils/api";
import { ImagesApi } from "../services/api/images";
import {
  TEMPLATE_V2_CHART_EDITOR_EVENT,
  TEMPLATE_V2_CHART_UPDATE_EVENT,
  TEMPLATE_V2_INSERT_ELEMENTS_EVENT,
  TEMPLATE_V2_SURFACE_SELECTED_EVENT,
  type TemplateV2ChartEditorDetail,
  type TemplateV2ChartUpdateDetail,
  type TemplateV2InsertElementsDetail,
  type TemplateV2SurfaceSelectedDetail,
} from "./templateV2Events";

const STAGE_WIDTH = 1280;
const STAGE_HEIGHT = 720;

type UnknownRecord = Record<string, any>;
type RawUi = TemplateV2Layout & UnknownRecord;
type RawComponent = UnknownRecord;
type RawElement = UnknownRecord;
type Size = { width: number; height: number };
type Point = { x: number; y: number };
type Box = Point & Size;
type ChildArrayInfo = {
  key: "children" | "elements" | "child" | "item";
  items: unknown[];
};

type ComponentSelection = {
  kind: "component";
  componentIndex: number;
};

type ElementSelection = {
  kind: "element";
  componentIndex: number;
  elementPath: number[];
};

type Selection = ComponentSelection | ElementSelection | null;

type InlineEdit =
  | {
      kind: "text" | "text-list" | "table" | "svg";
      selection: ElementSelection;
      draft: string;
    }
  | null;

type TemplateV2DirectComponentsSlideProps = {
  layout: TemplateV2Layout;
  isEditMode: boolean;
  slideId?: string | number | null;
  slideIndex: number;
  renderIndex?: number;
};

export function TemplateV2DirectComponentsSlide({
  layout,
  isEditMode,
  slideId = null,
  slideIndex,
  renderIndex,
}: TemplateV2DirectComponentsSlideProps) {
  const dispatch = useDispatch();
  const surfaceId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const nodeRefs = useRef(new Map<string, Konva.Node>());
  const imageUploadInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImageUploadRef = useRef<ElementSelection | null>(null);
  const currentUiRef = useRef<RawUi>(cloneJson(layout as RawUi));
  const undoStackRef = useRef<RawUi[]>([]);
  const redoStackRef = useRef<RawUi[]>([]);
  const [uiDraft, setUiDraft] = useState<RawUi>(() =>
    cloneJson(layout as RawUi),
  );
  const [selection, setSelection] = useState<Selection>(null);
  const [inlineEdit, setInlineEdit] = useState<InlineEdit>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [, setHistoryVersion] = useState(0);

  const components = useMemo(
    () => readArray(uiDraft.components).filter(isRecord) as RawComponent[],
    [uiDraft],
  );
  const selectedKey = selection ? keyForSelection(selection) : null;
  const selectedElement =
    selection?.kind === "element"
      ? getElementAtSelection(uiDraft, selection)
      : null;
  const selectedBox = selection ? absoluteBoxForSelection(uiDraft, selection) : null;
  const surfaceSlideIndex = useMemo(() => {
    const index = typeof renderIndex === "number" ? renderIndex : slideIndex;
    return Number.isFinite(index) ? index : null;
  }, [renderIndex, slideIndex]);
  const canUndo = undoStackRef.current.length > 0;
  const canRedo = redoStackRef.current.length > 0;

  useEffect(() => {
    if (layout === currentUiRef.current) return;
    const next = cloneJson(layout as RawUi);
    currentUiRef.current = next;
    setUiDraft(next);
    setSelection(null);
    setInlineEdit(null);
  }, [layout]);

  useEffect(() => {
    if (!isEditMode) return;
    const transformer = transformerRef.current;
    if (!transformer) return;
    const node = selectedKey ? nodeRefs.current.get(selectedKey) : null;
    transformer.nodes(node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [isEditMode, selectedKey, uiDraft]);

  const isSurfaceActive = useCallback(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.dataset.templateV2KonvaActiveSurface === surfaceId,
    [surfaceId],
  );

  const activateSurface = useCallback(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    document.documentElement.dataset.templateV2KonvaActiveSurface = surfaceId;
    if (surfaceSlideIndex != null) {
      document.documentElement.dataset.templateV2KonvaActiveSlideIndex =
        String(surfaceSlideIndex);
    }
    window.dispatchEvent(
      new CustomEvent<TemplateV2SurfaceSelectedDetail>(
        TEMPLATE_V2_SURFACE_SELECTED_EVENT,
        {
          detail: {
            slideId,
            slideIndex: surfaceSlideIndex,
          },
        },
      ),
    );
  }, [slideId, surfaceId, surfaceSlideIndex]);

  const clearSurface = useCallback(() => {
    if (typeof document === "undefined") return;
    if (
      document.documentElement.dataset.templateV2KonvaActiveSurface === surfaceId
    ) {
      delete document.documentElement.dataset.templateV2KonvaActiveSurface;
      delete document.documentElement.dataset.templateV2KonvaActiveSlideIndex;
    }
  }, [surfaceId]);

  const commitUi = useCallback(
    (nextUi: RawUi, pushHistory = true) => {
      if (pushHistory) {
        undoStackRef.current.push(cloneJson(currentUiRef.current));
        redoStackRef.current = [];
      }
      currentUiRef.current = nextUi;
      setUiDraft(nextUi);
      dispatch(
        updateSlideUi({
          index: slideIndex,
          ui: nextUi as Record<string, unknown>,
        }),
      );
      setHistoryVersion((value) => value + 1);
    },
    [dispatch, slideIndex],
  );

  const undo = useCallback(() => {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current.push(cloneJson(currentUiRef.current));
    commitUi(previous, false);
  }, [commitUi]);

  const redo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(cloneJson(currentUiRef.current));
    commitUi(next, false);
  }, [commitUi]);

  const select = useCallback(
    (nextSelection: Selection) => {
      activateSurface();
      setSelection(nextSelection);
    },
    [activateSurface],
  );

  const updateComponent = useCallback(
    (
      componentIndex: number,
      updater: (component: RawComponent) => RawComponent,
      pushHistory = true,
    ) => {
      commitUi(updateComponentInUi(currentUiRef.current, componentIndex, updater), pushHistory);
    },
    [commitUi],
  );

  const updateElement = useCallback(
    (
      elementSelection: ElementSelection,
      updater: (element: RawElement) => RawElement,
      pushHistory = true,
    ) => {
      commitUi(updateElementInUi(currentUiRef.current, elementSelection, updater), pushHistory);
    },
    [commitUi],
  );

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    commitUi(deleteSelectionFromUi(currentUiRef.current, selection));
    setSelection(null);
    setInlineEdit(null);
  }, [commitUi, selection]);

  const openInlineEditor = useCallback(
    (elementSelection: ElementSelection) => {
      const element = getElementAtSelection(currentUiRef.current, elementSelection);
      if (!element) return;
      const type = readString(element.type);
      if (type === "text") {
        setInlineEdit({
          kind: "text",
          selection: elementSelection,
          draft: rawTextContent(element),
        });
      } else if (type === "text-list") {
        setInlineEdit({
          kind: "text-list",
          selection: elementSelection,
          draft: rawTextListContent(element),
        });
      } else if (type === "table") {
        setInlineEdit({
          kind: "table",
          selection: elementSelection,
          draft: rawTableContent(element),
        });
      } else if (type === "svg") {
        setInlineEdit({
          kind: "svg",
          selection: elementSelection,
          draft: rawSvgContent(element),
        });
      }
    },
    [],
  );

  const closeInlineEditor = useCallback(
    (commit = true) => {
      const current = inlineEdit;
      if (!current) return;
      if (commit) {
        updateElement(current.selection, (element) =>
          elementWithInlineDraft(element, current.kind, current.draft),
        );
      }
      setInlineEdit(null);
    },
    [inlineEdit, updateElement],
  );

  const openImageUpload = useCallback(
    (elementSelection: ElementSelection) => {
      const element = getElementAtSelection(currentUiRef.current, elementSelection);
      if (readString(element?.type) !== "image") return;
      activateSurface();
      pendingImageUploadRef.current = elementSelection;
      if (imageUploadInputRef.current) {
        imageUploadInputRef.current.value = "";
        imageUploadInputRef.current.click();
      }
    },
    [activateSurface],
  );

  const openChartEditor = useCallback(
    (elementSelection: ElementSelection) => {
      const element = getElementAtSelection(currentUiRef.current, elementSelection);
      if (readString(element?.type) !== "chart") return;
      activateSurface();
      setSelection(elementSelection);
      if (typeof window === "undefined") return;
      window.dispatchEvent(
        new CustomEvent<TemplateV2ChartEditorDetail>(
          TEMPLATE_V2_CHART_EDITOR_EVENT,
          {
            detail: {
              chart:
                rawChartToEditorChart(element) as TemplateV2ChartEditorDetail["chart"],
              open: true,
              path: keyForSelection(elementSelection),
              rootIndex: elementSelection.componentIndex,
              slideId,
              slideIndex: surfaceSlideIndex,
            },
          },
        ),
      );
    },
    [activateSurface, slideId, surfaceSlideIndex],
  );

  const handleImageUploadChange = useCallback(
    async (event: ReactChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      const target = pendingImageUploadRef.current;
      if (!file || !target) return;

      if (!file.type.startsWith("image/")) {
        notify.warning("Invalid file", "Please upload an image file.");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        notify.warning("File too large", "Image files must be smaller than 5MB.");
        return;
      }

      try {
        setIsUploadingImage(true);
        const uploaded = await ImagesApi.uploadImage(file);
        const imageUrl = resolveBackendAssetSource(uploaded);
        if (!imageUrl) throw new Error("Upload did not return an image URL.");
        updateElement(target, (element) => ({
          ...element,
          data: imageUrl,
          name: element.name ?? file.name,
        }));
        notify.success("Image updated", "The selected image was replaced.");
      } catch (error) {
        notify.error(
          "Upload failed",
          error instanceof Error
            ? error.message
            : "Failed to upload image. Please try again.",
        );
      } finally {
        pendingImageUploadRef.current = null;
        setIsUploadingImage(false);
      }
    },
    [updateElement],
  );

  const handleElementDoubleClick = useCallback(
    (elementSelection: ElementSelection) => {
      const element = getElementAtSelection(currentUiRef.current, elementSelection);
      const type = readString(element?.type);
      if (type === "image") {
        openImageUpload(elementSelection);
        return;
      }
      if (type === "chart") {
        openChartEditor(elementSelection);
        return;
      }
      openInlineEditor(elementSelection);
    },
    [openChartEditor, openImageUpload, openInlineEditor],
  );

  useEffect(() => {
    if (!isEditMode || typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        (event.key !== "Delete" && event.key !== "Backspace") ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      if (!selection) return;
      event.preventDefault();
      deleteSelection();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteSelection, isEditMode, selection]);

  useEffect(() => {
    if (!isEditMode || typeof window === "undefined") return;

    const handleInsertElements = (event: Event) => {
      const detail = (event as CustomEvent<TemplateV2InsertElementsDetail>).detail;
      if (!detail?.elements?.length) return;
      if (!eventTargetsThisSlide(detail, slideId, surfaceSlideIndex, isSurfaceActive)) {
        return;
      }

      const nextUi = appendInsertedElements(
        currentUiRef.current,
        detail.elements as unknown as UnknownRecord[],
        detail.label,
      );
      const nextIndex = readArray(nextUi.components).length - detail.elements.length;
      commitUi(nextUi);
      setSelection({
        kind: "component",
        componentIndex: Math.max(0, nextIndex),
      });
      detail.handled = true;
    };

    window.addEventListener(TEMPLATE_V2_INSERT_ELEMENTS_EVENT, handleInsertElements);
    return () =>
      window.removeEventListener(
        TEMPLATE_V2_INSERT_ELEMENTS_EVENT,
        handleInsertElements,
      );
  }, [commitUi, isEditMode, isSurfaceActive, slideId, surfaceSlideIndex]);

  useEffect(() => {
    if (!isEditMode || typeof window === "undefined") return;

    const handleChartUpdate = (event: Event) => {
      const detail = (event as CustomEvent<TemplateV2ChartUpdateDetail>).detail;
      if (!detail || !eventTargetsThisSlide(detail, slideId, surfaceSlideIndex, isSurfaceActive)) {
        return;
      }

      if (detail.action === "close") {
        detail.handled = true;
        return;
      }

      if (!detail.chart || !detail.path) return;
      const parsedSelection = selectionFromKey(detail.path);
      if (!parsedSelection || parsedSelection.kind !== "element") return;
      const currentChart = getElementAtSelection(currentUiRef.current, parsedSelection);
      if (readString(currentChart?.type) !== "chart") return;
      updateElement(parsedSelection, (element) =>
        editorChartToRawChart(element, (detail.chart ?? {}) as UnknownRecord),
      );
      detail.handled = true;
    };

    window.addEventListener(TEMPLATE_V2_CHART_UPDATE_EVENT, handleChartUpdate);
    return () =>
      window.removeEventListener(TEMPLATE_V2_CHART_UPDATE_EVENT, handleChartUpdate);
  }, [isEditMode, isSurfaceActive, slideId, surfaceSlideIndex, updateElement]);

  useEffect(() => {
    if (!isEditMode || typeof document === "undefined") return;
    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root?.contains(event.target as Node)) activateSurface();
      else clearSurface();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      clearSurface();
    };
  }, [activateSurface, clearSurface, isEditMode]);

  useHotkey(
    "Mod+Z",
    (event) => {
      if (!isSurfaceActive() || !canUndo) return;
      event.preventDefault();
      event.stopPropagation();
      undo();
    },
    { conflictBehavior: "allow" },
  );
  useHotkey(
    "Mod+Shift+Z",
    (event) => {
      if (!isSurfaceActive() || !canRedo) return;
      event.preventDefault();
      event.stopPropagation();
      redo();
    },
    { conflictBehavior: "allow" },
  );
  useHotkey(
    "Mod+Y",
    (event) => {
      if (!isSurfaceActive() || !canRedo) return;
      event.preventDefault();
      event.stopPropagation();
      redo();
    },
    { conflictBehavior: "allow" },
  );

  if (!uiDraft) {
    return (
      <div className="flex h-full aspect-video flex-col items-center justify-center rounded-lg bg-gray-100">
        <Loader2 className="mb-2 h-4 w-4 animate-spin" />
        <p className="text-center text-sm text-gray-600">Loading slide layout...</p>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="relative h-full w-full overflow-hidden bg-white"
      style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT }}
      onPointerDown={activateSurface}
    >
      {isEditMode ? (
        <input
          ref={imageUploadInputRef}
          accept="image/*"
          className="hidden"
          type="file"
          onChange={handleImageUploadChange}
        />
      ) : null}
      <Stage
        width={STAGE_WIDTH}
        height={STAGE_HEIGHT}
        onMouseDown={(event) => {
          activateSurface();
          if (event.target === event.target.getStage()) {
            setSelection(null);
            setInlineEdit(null);
          }
        }}
        onTouchStart={(event) => {
          activateSurface();
          if (event.target === event.target.getStage()) {
            setSelection(null);
            setInlineEdit(null);
          }
        }}
      >
        <Layer>
          <Rect width={STAGE_WIDTH} height={STAGE_HEIGHT} fill={backgroundColor(uiDraft)} />
          {components.map((component, componentIndex) => (
            <RawComponentNode
              key={componentKey(component, componentIndex)}
              component={component}
              componentIndex={componentIndex}
              isEditMode={isEditMode}
              selectedKey={selectedKey}
              setNodeRef={setNodeRef(nodeRefs.current)}
              onSelect={select}
              onOpenElementEditor={handleElementDoubleClick}
              onComponentChange={updateComponent}
              onElementChange={updateElement}
            />
          ))}
          {isEditMode ? <Transformer ref={transformerRef} rotateEnabled /> : null}
        </Layer>
      </Stage>
      {inlineEdit && selectedElement && selectedBox ? (
        <RawInlineEditor
          draft={inlineEdit.draft}
          element={selectedElement}
          kind={inlineEdit.kind}
          box={selectedBox}
          onChange={(draft) =>
            setInlineEdit((current) => (current ? { ...current, draft } : current))
          }
          onClose={(commit) => closeInlineEditor(commit)}
        />
      ) : null}
      {isEditMode && selection ? (
        <RawSelectionToolbar
          box={selectedBox}
          element={selectedElement}
          onDelete={deleteSelection}
          onEdit={() => {
            if (selection.kind === "element") handleElementDoubleClick(selection);
          }}
        />
      ) : null}
      {isUploadingImage ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-white/35">
          <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-medium text-[#191919] shadow-md">
            <Loader2 className="h-4 w-4 animate-spin" />
            Uploading image...
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RawComponentNode({
  component,
  componentIndex,
  isEditMode,
  selectedKey,
  setNodeRef,
  onSelect,
  onOpenElementEditor,
  onComponentChange,
  onElementChange,
}: {
  component: RawComponent;
  componentIndex: number;
  isEditMode: boolean;
  selectedKey: string | null;
  setNodeRef: (key: string, node: Konva.Node | null) => void;
  onSelect: (selection: Selection) => void;
  onOpenElementEditor: (selection: ElementSelection) => void;
  onComponentChange: (
    componentIndex: number,
    updater: (component: RawComponent) => RawComponent,
  ) => void;
  onElementChange: (
    selection: ElementSelection,
    updater: (element: RawElement) => RawElement,
  ) => void;
}) {
  const groupRef = useRef<Konva.Group | null>(null);
  const box = componentBox(component);
  const stageBox = { x: 0, y: 0, width: STAGE_WIDTH, height: STAGE_HEIGHT };
  const selection: ComponentSelection = { kind: "component", componentIndex };
  const key = keyForSelection(selection);
  const selected = selectedKey === key;
  const elements = readArray(component.elements).filter(isRecord) as RawElement[];

  return (
    <Group
      ref={(node) => {
        groupRef.current = node;
        setNodeRef(key, node);
      }}
      x={box.x}
      y={box.y}
      width={box.width}
      height={box.height}
      clipX={0}
      clipY={0}
      clipWidth={box.width}
      clipHeight={box.height}
      draggable={isEditMode}
      dragBoundFunc={(pos) => clampAbsoluteBox(pos, box, stageBox)}
      onMouseDown={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        onSelect(selection);
      }}
      onTouchStart={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        onSelect(selection);
      }}
      onDragStart={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        onSelect(selection);
      }}
      onDragMove={(event) => {
        event.cancelBubble = true;
      }}
      onDragEnd={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        const node = groupRef.current;
        if (!node) return;
        onComponentChange(componentIndex, (current) => ({
          ...current,
          position: positionFromNodeInParent(node, stageBox, box),
        }));
      }}
      onTransformEnd={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        const node = groupRef.current;
        if (!node) return;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        const nextBox = {
          ...box,
          width: Math.max(1, box.width * scaleX),
          height: Math.max(1, box.height * scaleY),
        };
        onComponentChange(componentIndex, (current) =>
          resizeComponent(current, {
            ...positionFromNodeInParent(node, stageBox, nextBox),
            width: nextBox.width,
            height: nextBox.height,
            scaleX,
            scaleY,
          }),
        );
      }}
    >
      <Rect
        width={box.width}
        height={box.height}
        fill="rgba(255,255,255,0.01)"
      />
      {elements.map((element, elementIndex) => (
        <RawElementNode
          key={rawElementKey(element, elementIndex)}
          element={element}
          componentIndex={componentIndex}
          elementPath={[elementIndex]}
          isEditMode={isEditMode}
          selectedKey={selectedKey}
          setNodeRef={setNodeRef}
          onSelect={onSelect}
          onOpenEditor={onOpenElementEditor}
          onElementChange={onElementChange}
          parentBox={box}
        />
      ))}
      {selected ? (
        <Rect
          width={box.width}
          height={box.height}
          stroke="#7C51F8"
          strokeWidth={1.5}
          dash={[6, 4]}
          listening={false}
        />
      ) : null}
    </Group>
  );
}

function RawElementNode({
  element,
  componentIndex,
  elementPath,
  isEditMode,
  selectedKey,
  setNodeRef,
  onSelect,
  onOpenEditor,
  onElementChange,
  parentBox,
  renderBox,
}: {
  element: RawElement;
  componentIndex: number;
  elementPath: number[];
  isEditMode: boolean;
  selectedKey: string | null;
  setNodeRef: (key: string, node: Konva.Node | null) => void;
  onSelect: (selection: Selection) => void;
  onOpenEditor: (selection: ElementSelection) => void;
  onElementChange: (
    selection: ElementSelection,
    updater: (element: RawElement) => RawElement,
  ) => void;
  parentBox: Box;
  renderBox?: Box | null;
}) {
  const groupRef = useRef<Konva.Group | null>(null);
  const box = renderBox ?? elementBox(element);
  const selection: ElementSelection = {
    kind: "element",
    componentIndex,
    elementPath,
  };
  const key = keyForSelection(selection);
  const selected = selectedKey === key;
  const childInfo = childArrayInfo(element);
  const children = childInfo?.items ?? [];
  const laidOutChildren = layoutChildren(element, children, box);
  const clipChildren = shouldClipElementChildren(element, childInfo);

  return (
    <Group
      ref={(node) => {
        groupRef.current = node;
        setNodeRef(key, node);
      }}
      x={box.x}
      y={box.y}
      width={box.width}
      height={box.height}
      clipX={clipChildren ? 0 : undefined}
      clipY={clipChildren ? 0 : undefined}
      clipWidth={clipChildren ? box.width : undefined}
      clipHeight={clipChildren ? box.height : undefined}
      rotation={readNumber(element.rotation) ?? 0}
      opacity={readNumber(element.opacity) ?? 1}
      draggable={isEditMode}
      dragBoundFunc={(pos) => clampAbsoluteBox(pos, box, parentBox)}
      onMouseDown={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        onSelect(selection);
      }}
      onTouchStart={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        onSelect(selection);
      }}
      onDblClick={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        onSelect(selection);
        onOpenEditor(selection);
      }}
      onDblTap={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        onSelect(selection);
        onOpenEditor(selection);
      }}
      onDragStart={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        onSelect(selection);
      }}
      onDragMove={(event) => {
        event.cancelBubble = true;
      }}
      onDragEnd={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        const node = groupRef.current;
        if (!node) return;
        onElementChange(selection, (current) => ({
          ...current,
          position: positionFromNodeInParent(node, parentBox, box),
        }));
      }}
      onTransformEnd={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        const node = groupRef.current;
        if (!node) return;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        const nextSize = {
          width: Math.max(1, box.width * scaleX),
          height: Math.max(1, box.height * scaleY),
        };
        node.scaleX(1);
        node.scaleY(1);
        onElementChange(selection, (current) => ({
          ...current,
          position: positionFromNodeInParent(
            node,
            parentBox,
            { ...box, ...nextSize },
          ),
          size: nextSize,
        }));
      }}
    >
      <Rect width={box.width} height={box.height} fill="rgba(255,255,255,0.01)" />
      <RawElementVisual element={element} width={box.width} height={box.height} />
      {laidOutChildren.map(({ child, index, box: childBox }) => (
        <RawElementNode
          key={rawElementKey(child, index)}
          element={child}
          componentIndex={componentIndex}
          elementPath={[...elementPath, index]}
          isEditMode={isEditMode}
          selectedKey={selectedKey}
          setNodeRef={setNodeRef}
          onSelect={onSelect}
          onOpenEditor={onOpenEditor}
          onElementChange={onElementChange}
          parentBox={{
            x: parentBox.x + box.x,
            y: parentBox.y + box.y,
            width: box.width,
            height: box.height,
          }}
          renderBox={childBox}
        />
      ))}
      {selected ? (
        <Rect
          width={box.width}
          height={box.height}
          stroke="#7C51F8"
          strokeWidth={1.5}
          listening={false}
        />
      ) : null}
    </Group>
  );
}

function RawElementVisual({
  element,
  width,
  height,
}: {
  element: RawElement;
  width: number;
  height: number;
}) {
  const type = readString(element.type);
  if (isBoxVisualType(type)) {
    return (
      <Rect
        width={width}
        height={height}
        fill={fillColor(element.fill) ?? "transparent"}
        opacity={fillOpacity(element.fill)}
        stroke={strokeColor(element.stroke)}
        strokeWidth={strokeWidth(element.stroke)}
        cornerRadius={borderRadius(element)}
        listening={false}
      />
    );
  }
  if (type === "ellipse") {
    return (
      <Ellipse
        x={width / 2}
        y={height / 2}
        radiusX={width / 2}
        radiusY={height / 2}
        fill={fillColor(element.fill) ?? "transparent"}
        opacity={fillOpacity(element.fill)}
        stroke={strokeColor(element.stroke)}
        strokeWidth={strokeWidth(element.stroke)}
        listening={false}
      />
    );
  }
  if (type === "line") {
    return (
      <Line
        points={[0, 0, width, height]}
        stroke={strokeColor(element.stroke) ?? "#111827"}
        strokeWidth={strokeWidth(element.stroke) || 2}
        listening={false}
      />
    );
  }
  if (type === "text") {
    const font = rawFont(element);
    return (
      <Text
        width={width}
        height={height}
        text={displayText(rawTextContent(element))}
        fill={withHash(font.color)}
        fontFamily={`${font.family}, Helvetica, sans-serif`}
        fontSize={font.size}
        fontStyle={`${font.bold ? "bold" : "normal"} ${font.italic ? "italic" : ""}`}
        align={readString(element.alignment?.horizontal) ?? "left"}
        verticalAlign={readString(element.alignment?.vertical) ?? "top"}
        lineHeight={font.lineHeight}
        letterSpacing={font.letterSpacing}
        wrap={font.wrap === "none" ? "none" : "word"}
        listening={false}
      />
    );
  }
  if (type === "text-list") {
    const font = rawFont(element);
    return (
      <Text
        width={width}
        height={height}
        text={displayText(rawTextListContent(element))}
        fill={withHash(font.color)}
        fontFamily={`${font.family}, Helvetica, sans-serif`}
        fontSize={font.size}
        fontStyle={`${font.bold ? "bold" : "normal"} ${font.italic ? "italic" : ""}`}
        lineHeight={font.lineHeight}
        listening={false}
      />
    );
  }
  if (type === "image") {
    return <RawImageElement element={element} width={width} height={height} />;
  }
  if (type === "svg") {
    return <RawSvgElement element={element} width={width} height={height} />;
  }
  if (type === "table") {
    return <RawTableElement element={element} width={width} height={height} />;
  }
  if (type === "chart") {
    return <RawChartElement element={element} width={width} height={height} />;
  }
  return (
    <Rect
      width={width}
      height={height}
      fill="rgba(124,81,248,0.08)"
      stroke="#7C51F8"
      strokeWidth={1}
      dash={[6, 4]}
      listening={false}
    />
  );
}

function RawImageElement({
  element,
  width,
  height,
}: {
  element: RawElement;
  width: number;
  height: number;
}) {
  const src = readString(element.data);
  const [loaded, setLoaded] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!src) {
      setLoaded(null);
      return;
    }
    let cancelled = false;
    void loadKonvaImage(src).then((image) => {
      if (!cancelled) setLoaded(image);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!loaded) {
    return (
      <Rect
        width={width}
        height={height}
        fill="#EEF1F5"
        stroke="#CBD2D9"
        strokeWidth={1}
        listening={false}
      />
    );
  }

  const fit = readString(element.fit) ?? "contain";
  const naturalRatio = loaded.width / loaded.height || 1;
  const boxRatio = width / height || 1;
  let drawW = width;
  let drawH = height;
  let offsetX = 0;
  let offsetY = 0;

  if (fit === "cover") {
    if (naturalRatio > boxRatio) {
      drawW = height * naturalRatio;
      offsetX = (width - drawW) / 2;
    } else {
      drawH = width / naturalRatio;
      offsetY = (height - drawH) / 2;
    }
  } else if (fit === "contain") {
    if (naturalRatio > boxRatio) {
      drawH = width / naturalRatio;
      offsetY = (height - drawH) / 2;
    } else {
      drawW = height * naturalRatio;
      offsetX = (width - drawW) / 2;
    }
  }

  return (
    <Group clipX={0} clipY={0} clipWidth={width} clipHeight={height} listening={false}>
      <KonvaImage
        image={loaded}
        x={offsetX}
        y={offsetY}
        width={drawW}
        height={drawH}
        listening={false}
      />
    </Group>
  );
}

function RawSvgElement({
  element,
  width,
  height,
}: {
  element: RawElement;
  width: number;
  height: number;
}) {
  const svg = readString(element.svg);
  const data = readString(element.data);
  return (
    <RawImageElement
      element={{
        ...element,
        data: svg ? svgToDataUri(svg) : data,
        fit: element.fit ?? "contain",
      }}
      width={width}
      height={height}
    />
  );
}

function RawTableElement({
  element,
  width,
  height,
}: {
  element: RawElement;
  width: number;
  height: number;
}) {
  const rows = rawTableRows(element);
  const rowCount = Math.max(1, rows.length);
  const colCount = Math.max(1, ...rows.map((row) => row.length));
  const cellW = width / colCount;
  const cellH = height / rowCount;
  const font = rawFont(element);

  return (
    <Group listening={false}>
      {rows.map((row, rowIndex) =>
        Array.from({ length: colCount }, (_, colIndex) => {
          const cell = asRecord(row[colIndex]) ?? {};
          const fill = fillColor(cell.fill) ?? (rowIndex === 0 ? "#F2F4F7" : "#FFFFFF");
          return (
            <Group key={`${rowIndex}-${colIndex}`} x={colIndex * cellW} y={rowIndex * cellH}>
              <Rect
                width={cellW}
                height={cellH}
                fill={fill}
                stroke={strokeColor(cell.stroke) ?? "#D0D5DD"}
                strokeWidth={strokeWidth(cell.stroke) || 1}
              />
              <Text
                x={6}
                y={4}
                width={Math.max(1, cellW - 12)}
                height={Math.max(1, cellH - 8)}
                text={readString(cell.text) ?? ""}
                fill={withHash(readString(cell.font?.color) ?? font.color)}
                fontFamily={`${readString(cell.font?.family) ?? font.family}, Helvetica, sans-serif`}
                fontSize={readNumber(cell.font?.size) ?? font.size}
                fontStyle={rowIndex === 0 || cell.font?.bold ? "bold" : "normal"}
                verticalAlign="middle"
              />
            </Group>
          );
        }),
      )}
    </Group>
  );
}

function RawChartElement({
  element,
  width,
  height,
}: {
  element: RawElement;
  width: number;
  height: number;
}) {
  const categories = readArray(element.categories).map(String);
  const series = readArray(element.series).filter(isRecord);
  const firstSeries = asRecord(series[0]) ?? {};
  const values = readArray(firstSeries.data).map((value) => readNumber(value) ?? 0);
  const chartType = readString(element.chart_type) ?? readString(element.chartType) ?? "bar";
  const max = Math.max(1, ...values.map((value) => Math.abs(value)));
  const colors = readArray(element.series_colors ?? element.seriesColors).map(String);
  const color = colors[0] ?? "#7C51F8";
  const pad = 24;
  const plotW = Math.max(1, width - pad * 2);
  const plotH = Math.max(1, height - pad * 2);

  if (chartType === "line" || chartType === "area") {
    const points = values.flatMap((value, index) => {
      const x = pad + (values.length <= 1 ? 0 : (index / (values.length - 1)) * plotW);
      const y = pad + plotH - (value / max) * plotH;
      return [x, y];
    });
    return (
      <Group listening={false}>
        <Rect width={width} height={height} fill="rgba(255,255,255,0.01)" />
        <Line points={[pad, pad, pad, pad + plotH, pad + plotW, pad + plotH]} stroke="#98A2B3" strokeWidth={1} />
        <Line points={points} stroke={color} strokeWidth={3} tension={0.25} />
        <Text x={pad} y={4} width={plotW} text={readString(element.title) ?? ""} fill="#344054" fontSize={14} />
      </Group>
    );
  }

  const barGap = 8;
  const barW = values.length > 0 ? Math.max(4, (plotW - barGap * (values.length - 1)) / values.length) : 0;
  return (
    <Group listening={false}>
      <Rect width={width} height={height} fill="rgba(255,255,255,0.01)" />
      <Line points={[pad, pad, pad, pad + plotH, pad + plotW, pad + plotH]} stroke="#98A2B3" strokeWidth={1} />
      {values.map((value, index) => {
        const barH = (value / max) * plotH;
        return (
          <Group key={index} x={pad + index * (barW + barGap)}>
            <Rect y={pad + plotH - barH} width={barW} height={barH} fill={colors[index] ?? color} />
            <Text
              y={pad + plotH + 4}
              width={barW}
              text={categories[index] ?? ""}
              fill="#667085"
              fontSize={10}
              align="center"
            />
          </Group>
        );
      })}
      <Text x={pad} y={4} width={plotW} text={readString(element.title) ?? ""} fill="#344054" fontSize={14} />
    </Group>
  );
}

function RawInlineEditor({
  draft,
  element,
  kind,
  box,
  onChange,
  onClose,
}: {
  draft: string;
  element: RawElement;
  kind: NonNullable<InlineEdit>["kind"];
  box: Box;
  onChange: (draft: string) => void;
  onClose: (commit: boolean) => void;
}) {
  const font = rawFont(element);
  const isCode = kind === "svg";
  return (
    <textarea
      autoFocus
      data-inline-edit-ignore="true"
      value={draft}
      onChange={(event) => onChange(event.target.value)}
      onBlur={() => onClose(true)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose(false);
        }
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          onClose(true);
        }
      }}
      style={{
        position: "absolute",
        zIndex: 30,
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        border: "1px solid #7C51F8",
        outline: "none",
        resize: "none",
        padding: kind === "table" ? 8 : 0,
        background: isCode ? "rgba(7,20,37,0.96)" : "rgba(255,255,255,0.08)",
        color: isCode ? "#E7EDF8" : withHash(font.color),
        caretColor: isCode ? "#E7EDF8" : withHash(font.color),
        fontFamily: isCode
          ? "Menlo, Consolas, monospace"
          : `${font.family}, Helvetica, sans-serif`,
        fontSize: isCode ? 12 : font.size,
        fontWeight: font.bold ? 700 : 400,
        fontStyle: font.italic ? "italic" : "normal",
        lineHeight: font.lineHeight,
        textAlign: readString(element.alignment?.horizontal) as CSSProperties["textAlign"],
      }}
    />
  );
}

function RawSelectionToolbar({
  box,
  element,
  onDelete,
  onEdit,
}: {
  box: Box | null;
  element: RawElement | null;
  onDelete: () => void;
  onEdit: () => void;
}) {
  if (!box) return null;
  const type = readString(element?.type);
  const canEdit =
    type === "text" ||
    type === "text-list" ||
    type === "table" ||
    type === "svg" ||
    type === "image" ||
    type === "chart";
  return (
    <div
      data-inline-edit-ignore="true"
      className="absolute z-40 flex items-center gap-1 rounded-md border border-[#E6E8EF] bg-white p-1 shadow-md"
      style={{
        left: Math.max(4, Math.min(STAGE_WIDTH - 120, box.x)),
        top: Math.max(4, box.y - 38),
      }}
    >
      {canEdit ? (
        <button
          type="button"
          className="h-7 rounded px-2 text-xs font-medium text-[#191919] hover:bg-[#F4F4F6]"
          onClick={onEdit}
        >
          Edit
        </button>
      ) : null}
      <button
        type="button"
        className="h-7 rounded px-2 text-xs font-medium text-[#B42318] hover:bg-[#FEF3F2]"
        onClick={onDelete}
      >
        Delete
      </button>
    </div>
  );
}

function setNodeRef(map: Map<string, Konva.Node>) {
  return (key: string, node: Konva.Node | null) => {
    if (node) map.set(key, node);
    else map.delete(key);
  };
}

function updateComponentInUi(
  sourceUi: RawUi,
  componentIndex: number,
  updater: (component: RawComponent) => RawComponent,
) {
  const nextUi = cloneJson(sourceUi);
  const components = readArray(nextUi.components);
  const current = asRecord(components[componentIndex]);
  if (!current) return nextUi;
  components[componentIndex] = updater(current);
  nextUi.components = components;
  return nextUi;
}

function updateElementInUi(
  sourceUi: RawUi,
  selection: ElementSelection,
  updater: (element: RawElement) => RawElement,
) {
  const nextUi = cloneJson(sourceUi);
  const components = readArray(nextUi.components);
  const component = asRecord(components[selection.componentIndex]);
  if (!component) return nextUi;
  component.elements = updateElementArray(
    readArray(component.elements),
    selection.elementPath,
    updater,
  );
  components[selection.componentIndex] = component;
  nextUi.components = components;
  return nextUi;
}

function updateElementArray(
  elements: unknown[],
  path: number[],
  updater: (element: RawElement) => RawElement,
): unknown[] {
  if (path.length === 0) return elements;
  const [index, ...rest] = path;
  const next = [...elements];
  const current = asRecord(next[index]);
  if (!current) return next;
  if (rest.length === 0) {
    next[index] = updater(current);
    return next;
  }
  const childInfo = childArrayInfo(current);
  if (!childInfo) return next;
  const updatedChildren = updateElementArray(childInfo.items, rest, updater);
  next[index] = withUpdatedChildItems(current, childInfo, updatedChildren, rest[0]);
  return next;
}

function deleteSelectionFromUi(sourceUi: RawUi, selection: Selection) {
  const nextUi = cloneJson(sourceUi);
  const components = readArray(nextUi.components);
  if (selection?.kind === "component") {
    components.splice(selection.componentIndex, 1);
    nextUi.components = components;
    return nextUi;
  }
  if (selection?.kind === "element") {
    const component = asRecord(components[selection.componentIndex]);
    if (!component) return nextUi;
    component.elements = deleteElementFromArray(
      readArray(component.elements),
      selection.elementPath,
    );
    components[selection.componentIndex] = component;
    nextUi.components = components;
  }
  return nextUi;
}

function deleteElementFromArray(elements: unknown[], path: number[]) {
  const [index, ...rest] = path;
  const next = [...elements];
  if (rest.length === 0) {
    next.splice(index, 1);
    return next;
  }
  const current = asRecord(next[index]);
  const childInfo = current ? childArrayInfo(current) : null;
  if (!current || !childInfo) return next;
  if (childInfo.key === "item" && rest.length === 1) {
    next[index] = {
      ...current,
      count: Math.max(0, (readNumber(current.count) ?? childInfo.items.length) - 1),
    };
    return next;
  }
  const updatedChildren = deleteElementFromArray(childInfo.items, rest);
  next[index] = withUpdatedChildItems(current, childInfo, updatedChildren, rest[0]);
  return next;
}

function resizeComponent(
  component: RawComponent,
  next: Box & { scaleX: number; scaleY: number },
) {
  return {
    ...component,
    position: { x: next.x, y: next.y },
    size: { width: next.width, height: next.height },
    elements: scaleRawElements(
      readArray(component.elements),
      next.scaleX,
      next.scaleY,
    ),
  };
}

function scaleRawElements(elements: unknown[], scaleX: number, scaleY: number) {
  return elements.map((value) => {
    const element = asRecord(value);
    if (!element) return value;
    const box = elementBox(element);
    const childInfo = childArrayInfo(element);
    const scaledChildren = childInfo
      ? scaleRawElements(childInfo.items, scaleX, scaleY)
      : null;
    return {
      ...element,
      position: { x: box.x * scaleX, y: box.y * scaleY },
      size: { width: box.width * scaleX, height: box.height * scaleY },
      ...(childInfo && scaledChildren
        ? withUpdatedChildItems({}, childInfo, scaledChildren, 0)
        : {}),
    };
  });
}

function positionFromNodeInParent(
  node: Konva.Node,
  parentBox: Box,
  renderedBox: Box,
): Point {
  const absolute = node.absolutePosition();
  return clampRelativePosition(
    {
      x: absolute.x - parentBox.x,
      y: absolute.y - parentBox.y,
    },
    renderedBox,
    parentBox,
  );
}

function clampAbsoluteBox(pos: Point, box: Box, parentBox: Box): Point {
  return {
    x: clamp(
      pos.x,
      parentBox.x,
      parentBox.x + Math.max(0, parentBox.width - box.width),
    ),
    y: clamp(
      pos.y,
      parentBox.y,
      parentBox.y + Math.max(0, parentBox.height - box.height),
    ),
  };
}

function clampRelativePosition(pos: Point, box: Box, parentSize: Size): Point {
  return {
    x: clamp(pos.x, 0, Math.max(0, parentSize.width - box.width)),
    y: clamp(pos.y, 0, Math.max(0, parentSize.height - box.height)),
  };
}

function layoutChildren(parent: RawElement, children: unknown[], parentBox: Box) {
  const rawChildren = children.filter(isRecord) as RawElement[];
  const type = readString(parent.type);
  if (
    type !== "flex" &&
    type !== "grid" &&
    type !== "list-view" &&
    type !== "grid-view"
  ) {
    return rawChildren.map((child, index) => ({
      child,
      index,
      box: null as Box | null,
    }));
  }

  if (rawChildren.length === 0) return [];
  if (type === "grid" || type === "grid-view") {
    return layoutGridChildren(parent, rawChildren, parentBox);
  }
  return layoutFlexChildren(parent, rawChildren, parentBox);
}

function layoutFlexChildren(
  parent: RawElement,
  children: RawElement[],
  parentBox: Box,
) {
  const padding = readPadding(parent.padding);
  const direction = readString(parent.direction) ?? "row";
  const isColumn = direction === "column";
  const gap =
    readNumber(parent.gap) ??
    (isColumn
      ? readNumber(parent.row_gap) ?? readNumber(parent.rowGap)
      : readNumber(parent.column_gap) ?? readNumber(parent.columnGap)) ??
    0;
  const align =
    readString(parent.align_items) ?? readString(parent.alignItems) ?? "flex-start";
  const justify =
    readString(parent.justify_content) ??
    readString(parent.justifyContent) ??
    "flex-start";
  const availableW = Math.max(1, parentBox.width - padding.left - padding.right);
  const availableH = Math.max(1, parentBox.height - padding.top - padding.bottom);
  const childBoxes = children.map(elementBox);
  const mainSizes = childBoxes.map((box) => (isColumn ? box.height : box.width));
  const totalMain =
    mainSizes.reduce((sum, value) => sum + value, 0) +
    Math.max(0, children.length - 1) * gap;
  const availableMain = isColumn ? availableH : availableW;
  const startOffset =
    justify === "center"
      ? Math.max(0, (availableMain - totalMain) / 2)
      : justify === "flex-end" || justify === "end"
        ? Math.max(0, availableMain - totalMain)
        : 0;
  let cursor = startOffset;

  return children.map((child, index) => {
    const raw = childBoxes[index];
    const crossSize = isColumn ? raw.width : raw.height;
    const availableCross = isColumn ? availableW : availableH;
    const cross =
      align === "center"
        ? Math.max(0, (availableCross - crossSize) / 2)
        : align === "flex-end" || align === "end"
          ? Math.max(0, availableCross - crossSize)
          : 0;
    const box = {
      x: padding.left + (isColumn ? cross : cursor),
      y: padding.top + (isColumn ? cursor : cross),
      width: align === "stretch" && isColumn ? availableW : raw.width,
      height: align === "stretch" && !isColumn ? availableH : raw.height,
    };
    cursor += (isColumn ? box.height : box.width) + gap;
    return { child, index, box };
  });
}

function layoutGridChildren(
  parent: RawElement,
  children: RawElement[],
  parentBox: Box,
) {
  const padding = readPadding(parent.padding);
  const gap = readNumber(parent.gap) ?? 0;
  const columnGap =
    readNumber(parent.column_gap) ?? readNumber(parent.columnGap) ?? gap;
  const rowGap = readNumber(parent.row_gap) ?? readNumber(parent.rowGap) ?? gap;
  const explicitColumns = readArray(parent.columns);
  const explicitRows = readArray(parent.rows);
  const colCount =
    readNumber(parent.columns) ??
    (explicitColumns.length > 0
      ? explicitColumns.length
      : Math.ceil(Math.sqrt(children.length)));
  const rowCount =
    readNumber(parent.rows) ??
    (explicitRows.length > 0
      ? explicitRows.length
      : Math.ceil(children.length / Math.max(1, colCount)));
  const safeCols = Math.max(1, Math.floor(colCount));
  const safeRows = Math.max(1, Math.floor(rowCount));
  const availableW = Math.max(1, parentBox.width - padding.left - padding.right);
  const availableH = Math.max(1, parentBox.height - padding.top - padding.bottom);
  const cellW = Math.max(1, (availableW - columnGap * (safeCols - 1)) / safeCols);
  const cellH = Math.max(1, (availableH - rowGap * (safeRows - 1)) / safeRows);

  return children.map((child, index) => {
    const col = index % safeCols;
    const row = Math.floor(index / safeCols);
    const raw = elementBox(child);
    return {
      child,
      index,
      box: {
        x: padding.left + col * (cellW + columnGap),
        y: padding.top + row * (cellH + rowGap),
        width: raw.width > 1 ? Math.min(raw.width, cellW) : cellW,
        height: raw.height > 1 ? Math.min(raw.height, cellH) : cellH,
      },
    };
  });
}

function getElementAtSelection(ui: RawUi, selection: ElementSelection) {
  const component = asRecord(readArray(ui.components)[selection.componentIndex]);
  if (!component) return null;
  return getElementFromArray(readArray(component.elements), selection.elementPath);
}

function getElementFromArray(elements: unknown[], path: number[]): RawElement | null {
  const [index, ...rest] = path;
  const current = asRecord(elements[index]);
  if (!current) return null;
  if (rest.length === 0) return current;
  const childInfo = childArrayInfo(current);
  return childInfo ? getElementFromArray(childInfo.items, rest) : null;
}

function absoluteBoxForSelection(ui: RawUi, selection: Selection): Box | null {
  const component = asRecord(readArray(ui.components)[selection.componentIndex]);
  if (!component) return null;
  const componentOrigin = readPoint(component.position);
  if (selection.kind === "component") return componentBox(component);
  const elementBoxValue = absoluteElementBox(component, selection.elementPath);
  if (!elementBoxValue) return null;
  return {
    x: componentOrigin.x + elementBoxValue.x,
    y: componentOrigin.y + elementBoxValue.y,
    width: elementBoxValue.width,
    height: elementBoxValue.height,
  };
}

function absoluteElementBox(component: RawComponent, path: number[]) {
  let items = readArray(component.elements).filter(isRecord) as RawElement[];
  let parentElement: RawElement | null = null;
  let parentRenderBox: Box = {
    x: 0,
    y: 0,
    ...readSize(component.size, { width: STAGE_WIDTH, height: STAGE_HEIGHT }),
  };
  let x = 0;
  let y = 0;
  let width = 0;
  let height = 0;
  for (const index of path) {
    const element = asRecord(items[index]);
    if (!element) return null;
    const laidOut =
      parentElement != null
        ? layoutChildren(parentElement, items, parentRenderBox).find(
            (item) => item.index === index,
          )
        : null;
    const box = laidOut?.box ?? elementBox(element);
    x += box.x;
    y += box.y;
    width = box.width;
    height = box.height;
    const childInfo = childArrayInfo(element);
    parentElement = element;
    parentRenderBox = { x: 0, y: 0, width, height };
    items = (childInfo?.items ?? []).filter(isRecord) as RawElement[];
  }
  return { x, y, width, height };
}

function appendInsertedElements(
  sourceUi: RawUi,
  elements: UnknownRecord[],
  label?: string,
) {
  const nextUi = cloneJson(sourceUi);
  const components = readArray(nextUi.components);
  const start = components.length;
  elements.forEach((element, offset) => {
    components.push(insertedElementToComponent(element, label, start + offset));
  });
  nextUi.components = components;
  return nextUi;
}

function insertedElementToComponent(
  element: UnknownRecord,
  label: string | undefined,
  index: number,
) {
  const box = sourceElementBox(element);
  return {
    id: `${normalizeId(label ?? readString(element.type) ?? "inserted")}_${index + 1}`,
    description: label ?? "Inserted element",
    position: { x: box.x, y: box.y },
    size: { width: box.width, height: box.height },
    elements: [
      {
        ...rawElementFromInsertedElement(element),
        position: { x: 0, y: 0 },
        size: { width: box.width, height: box.height },
      },
    ],
  };
}

function rawElementFromInsertedElement(element: UnknownRecord): RawElement {
  const type = readString(element.type) ?? "rectangle";
  if (type === "chart") return editorChartToRawChart(element, element);
  return {
    ...element,
    font: rawFontToSource(element.font),
    border_radius: element.border_radius ?? element.borderRadius,
    line_height: element.line_height ?? element.lineHeight,
  };
}

function sourceElementBox(element: UnknownRecord): Box {
  const position = readPoint(element.position);
  const size = readSize(element.size);
  const looksLikeEditorUnits = size.width <= 20 && size.height <= 12;
  const scaleX = looksLikeEditorUnits ? STAGE_WIDTH / 10 : 1;
  const scaleY = looksLikeEditorUnits ? STAGE_HEIGHT / 5.625 : 1;
  return {
    x: position.x * scaleX,
    y: position.y * scaleY,
    width: Math.max(1, size.width * scaleX),
    height: Math.max(1, size.height * scaleY),
  };
}

function eventTargetsThisSlide(
  detail: {
    slideId?: string | number | null;
    slideIndex?: number | null;
  },
  slideId: string | number | null | undefined,
  slideIndex: number | null,
  isSurfaceActive: () => boolean,
) {
  const currentSlideId = slideId != null ? String(slideId) : null;
  const eventSlideId =
    detail.slideId !== undefined && detail.slideId !== null
      ? String(detail.slideId)
      : null;
  if (eventSlideId && currentSlideId && eventSlideId !== currentSlideId) {
    return false;
  }
  if (
    !eventSlideId &&
    typeof detail.slideIndex === "number" &&
    (slideIndex == null || detail.slideIndex !== slideIndex)
  ) {
    return false;
  }
  const hasTarget = Boolean(eventSlideId) || typeof detail.slideIndex === "number";
  return hasTarget || isSurfaceActive();
}

function keyForSelection(selection: Selection) {
  if (!selection) return "";
  if (selection.kind === "component") return `component:${selection.componentIndex}`;
  return `element:${selection.componentIndex}:${selection.elementPath.join(".")}`;
}

function selectionFromKey(key: string): Selection {
  if (key.startsWith("component:")) {
    const componentIndex = Number(key.split(":")[1]);
    return Number.isFinite(componentIndex)
      ? { kind: "component", componentIndex }
      : null;
  }
  const [, component, path] = key.split(":");
  const componentIndex = Number(component);
  const elementPath = path
    ?.split(".")
    .map(Number)
    .filter((value) => Number.isFinite(value));
  if (!Number.isFinite(componentIndex) || !elementPath?.length) return null;
  return { kind: "element", componentIndex, elementPath };
}

function componentKey(component: RawComponent, index: number) {
  return `${readString(component.id) ?? "component"}:${index}`;
}

function rawElementKey(element: RawElement, index: number) {
  return `${readString(element.id) ?? readString(element.name) ?? readString(element.type) ?? "element"}:${index}`;
}

function componentBox(component: RawComponent): Box {
  return {
    ...readPoint(component.position),
    ...readSize(component.size, { width: STAGE_WIDTH, height: STAGE_HEIGHT }),
  };
}

function elementBox(element: RawElement): Box {
  return {
    ...readPoint(element.position),
    ...readSize(element.size, { width: 1, height: 1 }),
  };
}

function childArrayInfo(element: RawElement): ChildArrayInfo | null {
  if (Array.isArray(element.children)) return { key: "children", items: element.children };
  if (Array.isArray(element.elements)) return { key: "elements", items: element.elements };
  if (isRecord(element.child)) return { key: "child", items: [element.child] };
  if (isRecord(element.item)) {
    const count = Math.max(0, Math.floor(readNumber(element.count) ?? 1));
    return {
      key: "item",
      items: Array.from({ length: count }, () => cloneJson(element.item)),
    };
  }
  return null;
}

function withUpdatedChildItems(
  element: RawElement,
  childInfo: ChildArrayInfo,
  updatedChildren: unknown[],
  selectedChildIndex = 0,
) {
  if (childInfo.key === "child") {
    return { ...element, child: updatedChildren[0] ?? null };
  }
  if (childInfo.key === "item") {
    const selected = Math.max(0, selectedChildIndex);
    return {
      ...element,
      item:
        updatedChildren[selected] ??
        updatedChildren[0] ??
        element.item ??
        null,
    };
  }
  return { ...element, [childInfo.key]: updatedChildren };
}

function shouldClipElementChildren(
  element: RawElement,
  childInfo: ChildArrayInfo | null,
) {
  if (!childInfo) return false;
  const type = readString(element.type);
  return (
    type === "container" ||
    type === "flex" ||
    type === "grid" ||
    type === "list-view" ||
    type === "grid-view"
  );
}

function isBoxVisualType(type: string | null) {
  return (
    type === "rectangle" ||
    type === "container" ||
    type === "flex" ||
    type === "grid" ||
    type === "group" ||
    type === "list-view" ||
    type === "grid-view"
  );
}

function elementWithInlineDraft(
  element: RawElement,
  kind: NonNullable<InlineEdit>["kind"],
  draft: string,
) {
  if (kind === "text") return setRawTextContent(element, draft);
  if (kind === "text-list") return setRawTextListContent(element, draft);
  if (kind === "table") return setRawTableContent(element, draft);
  if (kind === "svg") return setRawSvgContent(element, draft);
  return element;
}

function rawTextContent(element: RawElement) {
  const runs = readArray(element.runs);
  if (runs.length > 0) {
    return runs.map((run) => readString(asRecord(run)?.text) ?? "").join("");
  }
  return readString(element.text) ?? "";
}

function setRawTextContent(element: RawElement, text: string): RawElement {
  const runs = readArray(element.runs);
  const firstRun = asRecord(runs[0]) ?? {};
  return {
    ...element,
    text,
    runs: [
      {
        ...firstRun,
        text,
        font: firstRun.font ?? element.font,
      },
    ],
  };
}

function rawTextListContent(element: RawElement) {
  const items = readArray(element.items);
  if (items.length === 0) return "";
  return items
    .map((item) => {
      if (typeof item === "string") return item;
      const record = asRecord(item);
      return readString(record?.text) ?? "";
    })
    .join("\n");
}

function setRawTextListContent(element: RawElement, draft: string): RawElement {
  const items = draft
    .split(/\r?\n/)
    .map((item) => item.replace(/^\s*[•*-]\s?/, "").trimEnd())
    .filter((item) => item.trim().length > 0)
    .map((text) => ({ type: "text", text }));
  return { ...element, items: items.length > 0 ? items : [{ type: "text", text: " " }] };
}

function rawTableRows(element: RawElement) {
  const columns = readArray(element.columns);
  const rows = readArray(element.rows);
  return [columns, ...rows].filter((row) => Array.isArray(row)) as unknown[][];
}

function rawTableContent(element: RawElement) {
  return rawTableRows(element)
    .map((row) =>
      row
        .map((cell) => {
          const record = asRecord(cell);
          return readString(record?.text) ?? "";
        })
        .join("\t"),
    )
    .join("\n");
}

function setRawTableContent(element: RawElement, draft: string): RawElement {
  const rows = draft
    .split(/\r?\n/)
    .map((row) => row.split("\t").map((text) => ({ text })))
    .filter((row) => row.some((cell) => cell.text.trim().length > 0));
  return {
    ...element,
    columns: rows[0] ?? [],
    rows: rows.slice(1),
  };
}

function rawSvgContent(element: RawElement) {
  return readString(element.svg) ?? readString(element.data) ?? "";
}

function setRawSvgContent(element: RawElement, draft: string): RawElement {
  return { ...element, svg: draft };
}

function rawChartToEditorChart(element: RawElement) {
  return {
    ...element,
    type: "chart",
    chartType: readString(element.chartType) ?? readString(element.chart_type) ?? "bar",
    seriesColors: element.seriesColors ?? element.series_colors,
    axisColor: element.axisColor ?? element.axis_color,
    labelColor: element.labelColor ?? element.data_labels_color,
    xAxis: element.xAxis ?? element.x_axis,
    yAxis: element.yAxis ?? element.y_axis,
    xAxisTitle: element.xAxisTitle ?? element.x_axis_title,
    yAxisTitle: element.yAxisTitle ?? element.y_axis_title,
    dataLabels: element.dataLabels ?? element.data_labels,
  };
}

function editorChartToRawChart(source: RawElement, chart: UnknownRecord) {
  return {
    ...source,
    ...chart,
    type: "chart",
    chart_type: chart.chartType ?? chart.chart_type ?? source.chart_type,
    series_colors: chart.seriesColors ?? chart.series_colors ?? source.series_colors,
    axis_color: chart.axisColor ?? chart.axis_color ?? source.axis_color,
    data_labels_color:
      chart.labelColor ?? chart.data_labels_color ?? source.data_labels_color,
    x_axis: chart.xAxis ?? chart.x_axis ?? source.x_axis,
    y_axis: chart.yAxis ?? chart.y_axis ?? source.y_axis,
    x_axis_title: chart.xAxisTitle ?? chart.x_axis_title ?? source.x_axis_title,
    y_axis_title: chart.yAxisTitle ?? chart.y_axis_title ?? source.y_axis_title,
    data_labels: chart.dataLabels ?? chart.data_labels ?? source.data_labels,
  };
}

function displayText(text: string) {
  return text.replace(/\*\*(.*?)\*\*/g, "$1");
}

function backgroundColor(ui: RawUi) {
  return withHash(readString(ui.background) ?? "#FFFFFF");
}

function rawFont(element: RawElement) {
  const font = asRecord(element.font) ?? {};
  return {
    family: readString(font.family) ?? "Arial",
    size: readNumber(font.size) ?? 18,
    color: readString(font.color) ?? "#111827",
    bold: Boolean(font.bold),
    italic: Boolean(font.italic),
    lineHeight: readNumber(font.line_height) ?? readNumber(font.lineHeight) ?? 1.15,
    letterSpacing:
      readNumber(font.letter_spacing) ?? readNumber(font.letterSpacing) ?? 0,
    wrap: readString(font.wrap) ?? "word",
  };
}

function rawFontToSource(value: unknown) {
  const font = asRecord(value) ?? {};
  return {
    ...font,
    line_height: font.line_height ?? font.lineHeight,
    letter_spacing: font.letter_spacing ?? font.letterSpacing,
  };
}

function fillColor(fill: unknown) {
  const value = asRecord(fill);
  return withHash(readString(value?.color));
}

function fillOpacity(fill: unknown) {
  const value = asRecord(fill);
  return readNumber(value?.opacity) ?? 1;
}

function strokeColor(stroke: unknown) {
  const value = asRecord(stroke);
  return withHash(readString(value?.color));
}

function strokeWidth(stroke: unknown) {
  const value = asRecord(stroke);
  return readNumber(value?.width) ?? 0;
}

function borderRadius(element: RawElement) {
  const value = element.border_radius ?? element.borderRadius;
  if (typeof value === "number") return value;
  const record = asRecord(value);
  return readNumber(record?.radius) ?? readNumber(record?.topLeft) ?? 0;
}

function readPadding(value: unknown) {
  if (typeof value === "number") {
    return { top: value, right: value, bottom: value, left: value };
  }
  const record = asRecord(value);
  const x = readNumber(record?.x) ?? readNumber(record?.horizontal);
  const y = readNumber(record?.y) ?? readNumber(record?.vertical);
  return {
    top: readNumber(record?.top) ?? y ?? 0,
    right: readNumber(record?.right) ?? x ?? 0,
    bottom: readNumber(record?.bottom) ?? y ?? 0,
    left: readNumber(record?.left) ?? x ?? 0,
  };
}

function readPoint(value: unknown): Point {
  const record = asRecord(value);
  return {
    x: readNumber(record?.x) ?? 0,
    y: readNumber(record?.y) ?? 0,
  };
}

function readSize(
  value: unknown,
  fallback: Size = { width: 1, height: 1 },
): Size {
  const record = asRecord(value);
  return {
    width: Math.max(1, readNumber(record?.width) ?? fallback.width),
    height: Math.max(1, readNumber(record?.height) ?? fallback.height),
  };
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(asRecord(value));
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function withHash(value: string | null | undefined) {
  if (!value) return undefined;
  return value.startsWith("#") || value.startsWith("rgb") ? value : `#${value}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeId(value: string) {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "component";
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button,input,textarea,select,[contenteditable='true'],[role='dialog'],[data-inline-edit-ignore='true']",
    ),
  );
}
