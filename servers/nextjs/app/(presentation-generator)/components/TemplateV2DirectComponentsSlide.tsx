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
  type ReactNode,
} from "react";
import type Konva from "konva";
import { useDispatch } from "react-redux";
import { useHotkey } from "@tanstack/react-hotkeys";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Link,
  Loader2,
  Underline,
} from "lucide-react";
import {
  Arc,
  Circle,
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
const TEXT_AVERAGE_CHAR_EM = 0.5;
const DECORATIVE_LINE_LENGTH = 80;
const DECORATIVE_LINE_THICKNESS = 4;

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
type LaidOutChild = {
  child: RawElement;
  index: number;
  box: Box | null;
  layoutManaged: boolean;
};
type TextEditStyle = {
  family: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  lineHeight: number;
  letterSpacing: number;
  wrap: string;
  horizontal: "left" | "center" | "right";
  vertical: "top" | "middle" | "bottom";
};
type RenderTextFont = Omit<TextEditStyle, "horizontal" | "vertical">;
type RenderTextRun = {
  text: string;
  font: RenderTextFont;
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
      frame?: Box | null;
      style?: TextEditStyle;
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
  const setSelectionNodeRef = useMemo(() => setNodeRef(nodeRefs.current), []);
  const selectedKey = selection ? keyForSelection(selection) : null;
  const editingKey = inlineEdit ? keyForSelection(inlineEdit.selection) : null;
  const selectedElement =
    selection?.kind === "element"
      ? getElementAtSelection(uiDraft, selection)
      : null;
  const selectedBox = selection ? absoluteBoxForSelection(uiDraft, selection) : null;
  const inlineEditElement = inlineEdit
    ? getElementAtSelection(uiDraft, inlineEdit.selection)
    : null;
  const inlineEditBox = inlineEdit
    ? absoluteBoxForSelection(uiDraft, inlineEdit.selection)
    : null;
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
    const transformKey =
      selection?.kind === "component" && selectedKey ? selectedKey : null;
    const node = transformKey ? nodeRefs.current.get(transformKey) : null;
    transformer.nodes(node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [isEditMode, selectedKey, selection?.kind, uiDraft]);

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
      const frame = renderedLocalBoxForElementSelection(
        currentUiRef.current,
        elementSelection,
      );
      if (type === "text") {
        setInlineEdit({
          kind: "text",
          selection: elementSelection,
          draft: rawTextContent(element),
          frame,
          style: rawTextStyle(element),
        });
      } else if (type === "text-list") {
        setInlineEdit({
          kind: "text-list",
          selection: elementSelection,
          draft: rawTextListContent(element),
          frame,
          style: rawTextStyle(element),
        });
      } else if (type === "table") {
        setInlineEdit({
          kind: "table",
          selection: elementSelection,
          draft: rawTableContent(element),
          frame,
        });
      } else if (type === "svg") {
        setInlineEdit({
          kind: "svg",
          selection: elementSelection,
          draft: rawSvgContent(element),
          frame,
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
          elementWithInlineDraft(
            element,
            current.kind,
            current.draft,
            current.style,
            current.frame,
          ),
        );
      }
      setSelection(current.selection);
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
              editingKey={editingKey}
              setNodeRef={setSelectionNodeRef}
              onSelect={select}
              onOpenElementEditor={handleElementDoubleClick}
              onComponentChange={updateComponent}
              onElementChange={updateElement}
            />
          ))}
          {isEditMode ? <Transformer ref={transformerRef} rotateEnabled /> : null}
        </Layer>
      </Stage>
      {inlineEdit && inlineEditElement && inlineEditBox ? (
        <RawInlineEditor
          key={keyForSelection(inlineEdit.selection)}
          draft={inlineEdit.draft}
          element={inlineEditElement}
          kind={inlineEdit.kind}
          box={inlineEditBox}
          style={inlineEdit.style}
          onChange={(draft) =>
            setInlineEdit((current) => (current ? { ...current, draft } : current))
          }
          onStyleChange={(style) =>
            setInlineEdit((current) =>
              current?.style ? { ...current, style } : current,
            )
          }
          onClose={(commit) => closeInlineEditor(commit)}
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
  editingKey,
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
  editingKey: string | null;
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
          editingKey={editingKey}
          setNodeRef={setNodeRef}
          onSelect={onSelect}
          onOpenEditor={onOpenElementEditor}
          onElementChange={onElementChange}
          parentBox={box}
          layoutManaged={false}
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
  editingKey,
  setNodeRef,
  onSelect,
  onOpenEditor,
  onElementChange,
  parentBox,
  renderBox,
  layoutManaged = false,
}: {
  element: RawElement;
  componentIndex: number;
  elementPath: number[];
  isEditMode: boolean;
  selectedKey: string | null;
  editingKey: string | null;
  setNodeRef: (key: string, node: Konva.Node | null) => void;
  onSelect: (selection: Selection) => void;
  onOpenEditor: (selection: ElementSelection) => void;
  onElementChange: (
    selection: ElementSelection,
    updater: (element: RawElement) => RawElement,
  ) => void;
  parentBox: Box;
  renderBox?: Box | null;
  layoutManaged?: boolean;
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
  const editing = editingKey === key;
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
      draggable={false}
      onMouseDown={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = false;
      }}
      onTouchStart={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = false;
      }}
      onClick={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        onSelect(selection);
      }}
      onTap={(event) => {
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
        event.cancelBubble = false;
      }}
      onDragMove={(event) => {
        event.cancelBubble = false;
      }}
      onDragEnd={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = false;
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
          ...(layoutManaged || isManualPositioned(current)
            ? { __presenton_manual_position: true }
            : {}),
        }));
      }}
    >
      <Rect width={box.width} height={box.height} fill="rgba(255,255,255,0.01)" />
      {editing ? null : (
        <RawElementVisual element={element} width={box.width} height={box.height} />
      )}
      {laidOutChildren.map(({ child, index, box: childBox, layoutManaged }) => (
        <RawElementNode
          key={rawElementKey(child, index)}
          element={child}
          componentIndex={componentIndex}
          elementPath={[...elementPath, index]}
          isEditMode={isEditMode}
          selectedKey={selectedKey}
          editingKey={editingKey}
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
          layoutManaged={layoutManaged}
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
        fill={
          colorWithOpacity(fillColor(element.fill), fillOpacity(element.fill)) ??
          "transparent"
        }
        stroke={colorWithOpacity(
          strokeColor(element.stroke),
          strokeOpacity(element.stroke),
        )}
        strokeWidth={strokeWidth(element.stroke)}
        cornerRadius={borderRadius(element)}
        {...shadowProps(element)}
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
        fill={
          colorWithOpacity(fillColor(element.fill), fillOpacity(element.fill)) ??
          "transparent"
        }
        stroke={colorWithOpacity(
          strokeColor(element.stroke),
          strokeOpacity(element.stroke),
        )}
        strokeWidth={strokeWidth(element.stroke)}
        {...shadowProps(element)}
        listening={false}
      />
    );
  }
  if (type === "line") {
    return (
      <Line
        points={linePoints(width, height, strokeWidth(element.stroke) || 2)}
        stroke={
          colorWithOpacity(
            strokeColor(element.stroke) ?? "#111827",
            strokeOpacity(element.stroke),
          ) ?? "#111827"
        }
        strokeWidth={strokeWidth(element.stroke) || 2}
        {...shadowProps(element)}
        listening={false}
      />
    );
  }
  if (type === "text") {
    return (
      <RawRichTextElement
        element={element}
        width={width}
        height={height}
      />
    );
  }
  if (type === "text-list") {
    return (
      <RawRichTextElement
        element={element}
        width={width}
        height={height}
        text={rawTextListContent(element)}
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
  if (type === "infographic") {
    return <RawInfographicElement element={element} width={width} height={height} />;
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

function RawRichTextElement({
  element,
  width,
  height,
  text,
}: {
  element: RawElement;
  width: number;
  height: number;
  text?: string;
}) {
  const font = rawFont(element);
  const content = text ?? rawTextContent(element);
  const align = readString(element.alignment?.horizontal) ?? "left";
  const verticalAlign = readString(element.alignment?.vertical) ?? "top";

  return (
    <Text
      width={width}
      height={height}
      text={displayText(content)}
      fill={withHash(font.color)}
      fontFamily={`${font.family}, Helvetica, sans-serif`}
      fontSize={font.size}
      fontStyle={`${font.bold ? "bold" : "normal"} ${font.italic ? "italic" : ""}`}
      textDecoration={font.underline ? "underline" : ""}
      align={align}
      verticalAlign={verticalAlign}
      lineHeight={font.lineHeight}
      letterSpacing={font.letterSpacing}
      wrap={font.wrap === "none" ? "none" : "word"}
      {...shadowProps(element)}
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

function RawInfographicElement({
  element,
  width,
  height,
}: {
  element: RawElement;
  width: number;
  height: number;
}) {
  const infographicType =
    readString(element.infographic_type) ??
    readString(element.infographicType) ??
    "gauge";
  const progress = valueProgress(element);
  const baseColor =
    withHash(readString(element.base_color) ?? readString(element.baseColor)) ??
    "#E5E7EB";
  const highlightColor =
    withHash(
      readString(element.highlight_color) ?? readString(element.highlightColor),
    ) ?? "#2563EB";

  if (infographicType === "progress_bar") {
    const radius = Math.min(height / 2, 8);
    return (
      <Group listening={false} {...shadowProps(element)}>
        <Rect width={width} height={height} cornerRadius={radius} fill={baseColor} />
        <Rect
          width={width * progress}
          height={height}
          cornerRadius={radius}
          fill={highlightColor}
        />
      </Group>
    );
  }

  const valueAngle = 180 * progress;
  const thickness = Math.max(6, Math.min(width, height) * 0.18);
  const outerRadius = Math.max(1, Math.min(width * 0.43, height * 0.86));
  const innerRadius = Math.max(1, outerRadius - thickness);
  const middleRadius = (outerRadius + innerRadius) / 2;
  const capRadius = thickness / 2;
  const centerX = width / 2;
  const centerY = Math.min(height - capRadius, height * 0.86);
  const start = pointOnCircle(centerX, centerY, middleRadius, 180);
  const end = pointOnCircle(centerX, centerY, middleRadius, 180 + valueAngle);
  return (
    <Group listening={false} {...shadowProps(element)}>
      <Arc
        x={centerX}
        y={centerY}
        innerRadius={innerRadius}
        outerRadius={outerRadius}
        angle={180}
        rotation={180}
        fill={baseColor}
      />
      <Circle x={start.x} y={start.y} radius={capRadius} fill={baseColor} />
      <Circle
        x={pointOnCircle(centerX, centerY, middleRadius, 360).x}
        y={pointOnCircle(centerX, centerY, middleRadius, 360).y}
        radius={capRadius}
        fill={baseColor}
      />
      {valueAngle > 0 ? (
        <>
          <Arc
            x={centerX}
            y={centerY}
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            angle={valueAngle}
            rotation={180}
            fill={highlightColor}
          />
          <Circle x={start.x} y={start.y} radius={capRadius} fill={highlightColor} />
          <Circle x={end.x} y={end.y} radius={capRadius} fill={highlightColor} />
        </>
      ) : null}
      <Text
        x={0}
        y={height * 0.5}
        width={width}
        height={height * 0.3}
        text={String(Math.round(readNumber(element.value) ?? 0))}
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize={Math.max(10, Math.min(width, height) * 0.22)}
        fontStyle="bold"
        align="center"
        verticalAlign="middle"
        fill="#172033"
      />
    </Group>
  );
}

function RawInlineEditor({
  draft,
  element,
  kind,
  box,
  style,
  onChange,
  onStyleChange,
  onClose,
}: {
  draft: string;
  element: RawElement;
  kind: NonNullable<InlineEdit>["kind"];
  box: Box;
  style?: TextEditStyle;
  onChange: (draft: string) => void;
  onStyleChange: (style: TextEditStyle) => void;
  onClose: (commit: boolean) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const font = style ?? rawTextStyle(element);
  const isCode = kind === "svg";
  const isTextEditor = (kind === "text" || kind === "text-list") && Boolean(style);
  const closeAfterBlur = useCallback(() => {
    window.setTimeout(() => {
      const active = document.activeElement;
      if (active && editorRef.current?.contains(active)) return;
      onClose(true);
    }, 0);
  }, [onClose]);

  return (
    <div
      ref={editorRef}
      data-inline-edit-ignore="true"
      onBlur={closeAfterBlur}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      style={{
        position: "absolute",
        zIndex: 30,
        inset: 0,
        pointerEvents: "none",
      }}
    >
      {isTextEditor && style ? (
        <RawTextEditorToolbar
          box={box}
          style={style}
          onChange={onStyleChange}
        />
      ) : null}
      <textarea
        autoFocus
        data-inline-edit-ignore="true"
        value={draft}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => onChange(event.target.value)}
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
          zIndex: 31,
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
          pointerEvents: "auto",
          border: "1px solid #7C51F8",
          outline: "none",
          resize: "none",
          padding: kind === "table" ? 8 : 0,
          background: isCode
            ? "rgba(7,20,37,0.96)"
            : "rgba(255,255,255,0.08)",
          color: isCode ? "#E7EDF8" : withHash(font.color),
          caretColor: isCode ? "#E7EDF8" : withHash(font.color),
          fontFamily: isCode
            ? "Menlo, Consolas, monospace"
            : `${font.family}, Helvetica, sans-serif`,
          fontSize: isCode ? 12 : font.size,
          fontWeight: font.bold ? 700 : 400,
          fontStyle: font.italic ? "italic" : "normal",
          lineHeight: font.lineHeight,
          letterSpacing: font.letterSpacing,
          textAlign: font.horizontal as CSSProperties["textAlign"],
        }}
      />
    </div>
  );
}

function RawTextEditorToolbar({
  box,
  style,
  onChange,
}: {
  box: Box;
  style: TextEditStyle;
  onChange: (style: TextEditStyle) => void;
}) {
  const update = (patch: Partial<TextEditStyle>) => onChange({ ...style, ...patch });
  const toolbarWidth = Math.min(1044, Math.max(720, box.width));
  const left = clamp(box.x, 4, Math.max(4, STAGE_WIDTH - toolbarWidth - 4));
  const top = Math.max(4, box.y - 58);
  return (
    <div
      data-inline-edit-ignore="true"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      className="absolute z-40 flex h-12 items-center gap-1 rounded-xl border border-[#D9DDE7] bg-white px-4 py-1 shadow-md"
      style={{
        left,
        top,
        width: toolbarWidth,
        pointerEvents: "auto",
      }}
    >
      <input
        aria-label="Font family"
        className="h-9 min-w-[180px] flex-1 border-0 bg-transparent px-1 text-[24px] leading-none text-[#191919] outline-none"
        value={style.family}
        onChange={(event) => update({ family: event.target.value })}
      />
      <ToolbarDivider />
      <input
        aria-label="Font size"
        className="h-9 w-16 border-0 bg-transparent px-1 text-right text-[18px] text-[#191919] outline-none"
        min={1}
        step={0.5}
        type="number"
        value={style.size}
        onChange={(event) =>
          update({ size: readNumberInput(event.target.value, style.size) })
        }
      />
      <ToolbarDivider />
      <label
        aria-label="Text color"
        title="Text color"
        className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-md hover:bg-[#F3F4F6]"
        onMouseDown={(event) => event.preventDefault()}
      >
        <span
          className="h-7 w-7 rounded-full"
          style={{ background: withHash(style.color) ?? "#111827" }}
        />
        <input
          className="absolute inset-0 cursor-pointer opacity-0"
          type="color"
          value={withHash(style.color) ?? "#111827"}
          onChange={(event) => update({ color: event.target.value })}
        />
      </label>
      <ToolbarDivider />
      <TextToolButton
        active={style.bold}
        label="Bold"
        onClick={() => update({ bold: !style.bold })}
      >
        <Bold className="h-4 w-4" />
      </TextToolButton>
      <TextToolButton
        active={style.italic}
        label="Italic"
        onClick={() => update({ italic: !style.italic })}
      >
        <Italic className="h-4 w-4" />
      </TextToolButton>
      <TextToolButton
        active={style.underline}
        label="Underline"
        onClick={() => update({ underline: !style.underline })}
      >
        <Underline className="h-4 w-4" />
      </TextToolButton>
      <ToolbarDivider />
      <TextToolButton
        active={style.horizontal === "left"}
        label="Align left"
        onClick={() => update({ horizontal: "left" })}
      >
        <AlignLeft className="h-4 w-4" />
      </TextToolButton>
      <TextToolButton
        active={style.horizontal === "center"}
        label="Align center"
        onClick={() => update({ horizontal: "center" })}
      >
        <AlignCenter className="h-4 w-4" />
      </TextToolButton>
      <TextToolButton
        active={style.horizontal === "right"}
        label="Align right"
        onClick={() => update({ horizontal: "right" })}
      >
        <AlignRight className="h-4 w-4" />
      </TextToolButton>
      <ToolbarDivider />
      <TextToolButton
        active={false}
        label="Letter spacing"
        onClick={() => update({ letterSpacing: style.letterSpacing === 0 ? 1 : 0 })}
      >
        <span className="text-sm leading-none">|A|</span>
      </TextToolButton>
      <TextToolButton
        active={false}
        label="Text color"
        onClick={() => undefined}
      >
        <span className="border-b-2 border-[#191919] text-sm leading-none">A</span>
      </TextToolButton>
      <TextToolButton
        active={false}
        label="Clear background"
        onClick={() => undefined}
      >
        <span
          className="h-5 w-5"
          style={{
            backgroundImage:
              "linear-gradient(45deg,#111 25%,transparent 25%),linear-gradient(-45deg,#111 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#111 75%),linear-gradient(-45deg,transparent 75%,#111 75%)",
            backgroundPosition: "0 0,0 10px,10px -10px,-10px 0",
            backgroundSize: "10px 10px",
          }}
        />
      </TextToolButton>
      <ToolbarDivider />
      <TextToolButton active={false} label="Link" onClick={() => undefined}>
        <Link className="h-4 w-4" />
      </TextToolButton>
    </div>
  );
}

function ToolbarDivider() {
  return <span className="mx-2 h-8 w-px bg-[#E6E8EF]" />;
}

function TextToolButton({
  active,
  children,
  label,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      type="button"
      className={`flex h-9 w-9 items-center justify-center rounded-md ${
        active ? "bg-[#F0EEFF] text-[#191919]" : "text-[#191919] hover:bg-[#F3F4F6]"
      }`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
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

function layoutChildren(
  parent: RawElement,
  children: unknown[],
  parentBox: Box,
): LaidOutChild[] {
  const rawChildren = children.filter(isRecord) as RawElement[];
  const type = readString(parent.type);
  if (type === "container") {
    return layoutContainerChildren(parent, rawChildren, parentBox);
  }
  if (type === "grid" || type === "grid-view") {
    return layoutGridChildren(parent, rawChildren, parentBox);
  }
  if (type === "flex" || type === "list-view") {
    return layoutFlexChildren(parent, rawChildren, parentBox);
  }
  return rawChildren.map((child, index) => ({
    child,
    index,
    box: null as Box | null,
    layoutManaged: false,
  }));
}

function layoutContainerChildren(
  parent: RawElement,
  children: RawElement[],
  parentBox: Box,
): LaidOutChild[] {
  if (children.length === 0) return [];
  const padding = readPadding(parent.padding);
  const content = {
    x: padding.left,
    y: padding.top,
    width: Math.max(1, parentBox.width - padding.left - padding.right),
    height: Math.max(1, parentBox.height - padding.top - padding.bottom),
  };
  const alignment = asRecord(parent.alignment) ?? {};

  return children.map((child, index) => {
    if (isManualPositioned(child)) {
      return { child, index, box: elementBox(child), layoutManaged: false };
    }

    const point = readPoint(child.position);
    const childType = readString(child.type);
    const explicitSize = readOptionalSize(child.size);
    const inferredSize =
      childType === "group" && explicitSize == null
        ? { width: content.width, height: content.height }
        : elementSize(child, content);
    const width = explicitSize?.width ?? inferredSize.width;
    const height = explicitSize?.height ?? inferredSize.height;

    if (childType === "group") {
      return {
        child,
        index,
        box: {
          x: content.x + point.x,
          y: content.y + point.y,
          width,
          height,
        },
        layoutManaged: true,
      };
    }

    const horizontal = readString(alignment.horizontal) ?? "left";
    const vertical = readString(alignment.vertical) ?? "top";
    return {
      child,
      index,
      box: {
        x:
          horizontal === "center"
            ? content.x + alignmentOffset("center", content.width, width)
            : horizontal === "right"
              ? content.x + alignmentOffset("right", content.width, width)
              : content.x + point.x,
        y:
          vertical === "middle"
            ? content.y + alignmentOffset("center", content.height, height)
            : vertical === "bottom"
              ? content.y + alignmentOffset("bottom", content.height, height)
              : content.y + point.y,
        width,
        height,
      },
      layoutManaged: true,
    };
  });
}

function layoutFlexChildren(
  parent: RawElement,
  children: RawElement[],
  parentBox: Box,
) {
  if (children.length === 0) return [];
  const padding = readPadding(parent.padding);
  const direction = readString(parent.direction) === "column" ? "column" : "row";
  const isColumn = direction === "column";
  const mainGap =
    (isColumn
      ? readNumber(parent.row_gap) ?? readNumber(parent.rowGap)
      : readNumber(parent.column_gap) ?? readNumber(parent.columnGap)) ??
    readNumber(parent.gap) ??
    0;
  const align =
    readString(parent.align_items) ?? readString(parent.alignItems) ?? "stretch";
  const justify =
    readString(parent.justify_content) ??
    readString(parent.justifyContent) ??
    "flex-start";
  const availableW = Math.max(1, parentBox.width - padding.left - padding.right);
  const availableH = Math.max(1, parentBox.height - padding.top - padding.bottom);
  const availableMain = isColumn ? availableH : availableW;
  const availableCross = isColumn ? availableW : availableH;
  const bases = children.map((child) =>
    isManualPositioned(child)
      ? isColumn
        ? elementBox(child).height
        : elementBox(child).width
      : flexBasis(child, direction, availableCross),
  );
  const gapTotal = mainGap * Math.max(0, children.length - 1);
  const freeBeforeFlex =
    Math.max(1, availableMain - gapTotal) -
    bases.reduce((sum, size) => sum + Math.max(0, size), 0);
  let mainSizes = bases.map((basis) => Math.max(0, basis));
  const grows = children.map((child, index) =>
    isManualPositioned(child)
      ? 0
      : layoutNumber(child, "grow") ?? (bases[index] > 0 ? 0 : 1),
  );
  const growTotal = grows.reduce((sum, grow) => sum + grow, 0);

  if (freeBeforeFlex > 0 && growTotal > 0) {
    mainSizes = mainSizes.map(
      (size, index) => size + (freeBeforeFlex * grows[index]) / growTotal,
    );
  } else if (freeBeforeFlex > 0 && justify === "stretch") {
    const flexibleCount = Math.max(
      1,
      children.filter((child) => !isManualPositioned(child)).length,
    );
    mainSizes = mainSizes.map((size, index) =>
      isManualPositioned(children[index])
        ? size
        : size + freeBeforeFlex / flexibleCount,
    );
  } else if (freeBeforeFlex < 0) {
    const shrinks = children.map((child) =>
      isManualPositioned(child) ? 0 : layoutNumber(child, "shrink") ?? 1,
    );
    const scaledShrinks = shrinks.map((shrink, index) => shrink * mainSizes[index]);
    const shrinkTotal = scaledShrinks.reduce((sum, shrink) => sum + shrink, 0);
    if (shrinkTotal > 0) {
      mainSizes = mainSizes.map((size, index) =>
        Math.max(1, size + (freeBeforeFlex * scaledShrinks[index]) / shrinkTotal),
      );
    }
  }

  const usedMain =
    mainSizes.reduce((sum, size) => sum + size, 0) +
    mainGap * Math.max(0, children.length - 1);
  let cursor = alignmentOffset(justify, availableMain, usedMain);

  return children.map((child, index) => {
    const raw = elementBox(child);
    if (isManualPositioned(child)) {
      cursor += (isColumn ? raw.height : raw.width) + mainGap;
      return { child, index, box: raw, layoutManaged: false };
    }
    const main = clampLayoutSize(mainSizes[index], child, isColumn ? "height" : "width");
    const cross = childCrossSize(child, direction, availableCross, align);
    const alignSelf =
      readString(child.layout?.align_self) ?? readString(child.layout?.alignSelf);
    const crossOffset = alignmentOffset(alignSelf ?? align, availableCross, cross);
    const box = isColumn
      ? {
          x: padding.left + crossOffset,
          y: padding.top + cursor,
          width: cross,
          height: main,
        }
      : {
          x: padding.left + cursor,
          y: padding.top + crossOffset,
          width: main,
          height: cross,
        };
    cursor += main + mainGap;
    return { child, index, box, layoutManaged: true };
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
  const columnCount =
    readNumber(parent.columns) ??
    (explicitColumns.length > 0
      ? explicitColumns.length
      : Math.ceil(Math.sqrt(children.length)));
  const safeColumns = Math.max(1, Math.floor(columnCount));
  const declaredRows =
    readNumber(parent.rows) ??
    (explicitRows.length > 0 ? explicitRows.length : null);
  const placements = placeGridChildren(children, safeColumns, declaredRows);
  const rowCount = Math.max(
    declaredRows ?? 1,
    ...placements.map((placement) => placement.row + placement.rowSpan),
  );
  const availableW = Math.max(1, parentBox.width - padding.left - padding.right);
  const availableH = Math.max(1, parentBox.height - padding.top - padding.bottom);
  const cellW = Math.max(1, (availableW - columnGap * (safeColumns - 1)) / safeColumns);
  const cellH = Math.max(1, (availableH - rowGap * Math.max(0, rowCount - 1)) / rowCount);

  return children.map((child, index) => {
    const raw = elementBox(child);
    if (isManualPositioned(child)) {
      return { child, index, box: raw, layoutManaged: false };
    }
    const placement = placements[index];
    const area = {
      x: padding.left + placement.col * (cellW + columnGap),
      y: padding.top + placement.row * (cellH + rowGap),
      width: cellW * placement.columnSpan + columnGap * (placement.columnSpan - 1),
      height: cellH * placement.rowSpan + rowGap * (placement.rowSpan - 1),
    };
    const justify =
      readString(child.layout?.align_self) ??
      readString(child.layout?.alignSelf) ??
      readString(parent.justify_items) ??
      readString(parent.justifyItems) ??
      "stretch";
    const align =
      readString(child.layout?.align_self) ??
      readString(child.layout?.alignSelf) ??
      readString(parent.align_items) ??
      readString(parent.alignItems) ??
      "stretch";
    const width =
      justify === "stretch"
        ? area.width
        : clampLayoutSize(raw.width, child, "width", area.width);
    const height =
      align === "stretch"
        ? area.height
        : clampLayoutSize(raw.height, child, "height", area.height);
    return {
      child,
      index,
      box: {
        x: area.x + alignmentOffset(justify, area.width, width),
        y: area.y + alignmentOffset(align, area.height, height),
        width,
        height,
      },
      layoutManaged: true,
    };
  });
}

function flexBasis(
  child: RawElement,
  direction: "row" | "column",
  crossSize: number,
) {
  const dimension = direction === "row" ? "width" : "height";
  const explicit = layoutNumber(child, "basis") ?? readOptionalSize(child.size)?.[dimension];
  if (explicit != null && explicit > 0) {
    return clampLayoutSize(explicit, child, dimension);
  }

  if (isFramelessDecorativeShape(child)) {
    return DECORATIVE_LINE_THICKNESS;
  }
  if (readString(child.type) === "text") {
    return clampLayoutSize(
      intrinsicTextMainSize(child, direction, crossSize),
      child,
      dimension,
    );
  }

  const inferred = elementSize(child);
  const size = direction === "row" ? inferred.width : inferred.height;
  return size > 1 ? clampLayoutSize(size, child, dimension) : 0;
}

function childCrossSize(
  child: RawElement,
  direction: "row" | "column",
  crossSize: number,
  alignItems: string,
) {
  const dimension = direction === "row" ? "height" : "width";
  const alignSelf =
    readString(child.layout?.align_self) ?? readString(child.layout?.alignSelf);
  if (isFramelessDecorativeShape(child)) {
    return clampLayoutSize(
      Math.min(crossSize, DECORATIVE_LINE_LENGTH),
      child,
      dimension,
    );
  }
  if (alignItems === "stretch" && alignSelf == null) {
    return crossSize;
  }
  const explicit = readOptionalSize(child.size)?.[dimension];
  const inferred = elementSize(child, {
    width: direction === "row" ? 1 : crossSize,
    height: direction === "row" ? crossSize : 1,
  })[dimension];
  return clampLayoutSize(explicit ?? inferred ?? crossSize, child, dimension, crossSize);
}

function intrinsicTextMainSize(
  child: RawElement,
  direction: "row" | "column",
  crossSize: number,
) {
  const font = rawFont(child);
  const text = displayText(rawTextContent(child));
  if (direction === "row") {
    return Math.max(1, estimateTextWidth(text, font));
  }

  const explicitWidth = readOptionalSize(child.size)?.width;
  const width = Math.max(1, explicitWidth ?? crossSize);
  return Math.max(1, estimateTextHeight(text, font, width));
}

function placeGridChildren(
  children: RawElement[],
  columns: number,
  declaredRows: number | null,
) {
  const occupied = new Set<string>();
  const placements: Array<{
    col: number;
    row: number;
    columnSpan: number;
    rowSpan: number;
  }> = [];
  let rowLimit = Math.max(1, declaredRows ?? Math.ceil(children.length / columns));

  children.forEach((child) => {
    const columnSpan = Math.min(
      columns,
      Math.max(1, Math.floor(layoutNumber(child, "columnSpan", "column_span") ?? 1)),
    );
    const rowSpan = Math.max(
      1,
      Math.floor(layoutNumber(child, "rowSpan", "row_span") ?? 1),
    );
    let placedRow = 0;
    let placedCol = 0;

    while (true) {
      let placed = false;
      for (let row = 0; row < rowLimit && !placed; row += 1) {
        for (let col = 0; col <= columns - columnSpan; col += 1) {
          if (gridAreaOpen(occupied, row, col, rowSpan, columnSpan)) {
            placed = true;
            placedRow = row;
            placedCol = col;
            break;
          }
        }
      }
      if (placed) break;
      rowLimit += 1;
    }

    markGridArea(occupied, placedRow, placedCol, rowSpan, columnSpan);
    placements.push({
      col: placedCol,
      row: placedRow,
      columnSpan,
      rowSpan,
    });
  });

  return placements;
}

function gridAreaOpen(
  occupied: Set<string>,
  row: number,
  col: number,
  rowSpan: number,
  columnSpan: number,
) {
  for (let r = row; r < row + rowSpan; r += 1) {
    for (let c = col; c < col + columnSpan; c += 1) {
      if (occupied.has(`${r}:${c}`)) return false;
    }
  }
  return true;
}

function markGridArea(
  occupied: Set<string>,
  row: number,
  col: number,
  rowSpan: number,
  columnSpan: number,
) {
  for (let r = row; r < row + rowSpan; r += 1) {
    for (let c = col; c < col + columnSpan; c += 1) {
      occupied.add(`${r}:${c}`);
    }
  }
}

function isFramelessDecorativeShape(child: RawElement) {
  if (readOptionalSize(child.size) || asRecord(child.position)) return false;
  const type = readString(child.type);
  return type === "rectangle" || type === "ellipse" || type === "line";
}

function clampLayoutSize(
  size: number,
  child: RawElement,
  dimension: "width" | "height",
  fallback = 1,
) {
  const value = Number.isFinite(size) && size > 0 ? size : fallback;
  const min =
    dimension === "width"
      ? layoutNumber(child, "minWidth", "min_width")
      : layoutNumber(child, "minHeight", "min_height");
  const max =
    dimension === "width"
      ? layoutNumber(child, "maxWidth", "max_width")
      : layoutNumber(child, "maxHeight", "max_height");
  return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? 1, value));
}

function layoutNumber(child: RawElement, ...keys: string[]) {
  const layout = asRecord(child.layout);
  for (const key of keys) {
    const value = readNumber(layout?.[key]);
    if (value != null) return value;
  }
  return null;
}

function estimateTextWidth(text: string, font: ReturnType<typeof rawFont>) {
  const longestLine = text
    .split(/\r?\n/)
    .reduce((longest, line) => Math.max(longest, line.length), 0);
  const weight = font.bold ? 0.56 : TEXT_AVERAGE_CHAR_EM;
  return Math.max(font.size, longestLine * font.size * weight);
}

function estimateTextHeight(
  text: string,
  font: ReturnType<typeof rawFont>,
  width: number,
) {
  const lineHeight = font.size * font.lineHeight;
  if (font.wrap === "none") {
    return Math.max(lineHeight, text.split(/\r?\n/).length * lineHeight);
  }
  const averageCharWidth = Math.max(1, font.size * TEXT_AVERAGE_CHAR_EM);
  const charsPerLine = Math.max(1, Math.floor(width / averageCharWidth));
  const lines = text.split(/\r?\n/).reduce((count, line) => {
    return count + Math.max(1, Math.ceil(line.length / charsPerLine));
  }, 0);
  return Math.max(lineHeight, lines * lineHeight);
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

function renderedLocalBoxForElementSelection(
  ui: RawUi,
  selection: ElementSelection,
): Box | null {
  const component = asRecord(readArray(ui.components)[selection.componentIndex]);
  if (!component) return null;
  return localElementBox(component, selection.elementPath);
}

function absoluteElementBox(component: RawComponent, path: number[]) {
  const local = localElementBox(component, path);
  if (!local) return null;
  let items = readArray(component.elements).filter(isRecord) as RawElement[];
  let parentElement: RawElement | null = null;
  let parentRenderBox: Box = {
    x: 0,
    y: 0,
    ...readSize(component.size, { width: STAGE_WIDTH, height: STAGE_HEIGHT }),
  };
  let x = 0;
  let y = 0;
  for (const index of path.slice(0, -1)) {
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
    const childInfo = childArrayInfo(element);
    parentElement = element;
    parentRenderBox = { x: 0, y: 0, width: box.width, height: box.height };
    items = (childInfo?.items ?? []).filter(isRecord) as RawElement[];
  }
  return {
    x: x + local.x,
    y: y + local.y,
    width: local.width,
    height: local.height,
  };
}

function localElementBox(component: RawComponent, path: number[]) {
  let items = readArray(component.elements).filter(isRecord) as RawElement[];
  let parentElement: RawElement | null = null;
  let parentRenderBox: Box = {
    x: 0,
    y: 0,
    ...readSize(component.size, { width: STAGE_WIDTH, height: STAGE_HEIGHT }),
  };
  for (let depth = 0; depth < path.length; depth += 1) {
    const index = path[depth];
    const element = asRecord(items[index]);
    if (!element) return null;
    const laidOut =
      parentElement != null
        ? layoutChildren(parentElement, items, parentRenderBox).find(
            (item) => item.index === index,
          )
        : null;
    const box = laidOut?.box ?? elementBox(element);
    if (depth === path.length - 1) return box;
    const childInfo = childArrayInfo(element);
    parentElement = element;
    parentRenderBox = { x: 0, y: 0, width: box.width, height: box.height };
    items = (childInfo?.items ?? []).filter(isRecord) as RawElement[];
  }
  return null;
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
    ...elementSize(element),
  };
}

function isManualPositioned(element: RawElement) {
  return element.__presenton_manual_position === true;
}

function elementSize(element: RawElement, fallback?: Size): Size {
  const explicit = readOptionalSize(element.size);
  if (explicit) return explicit;

  const type = readString(element.type);
  if (type === "group") {
    return childrenBounds(childArrayInfo(element)?.items ?? []);
  }
  if (type === "container") {
    const padding = readPadding(element.padding);
    const child = asRecord(element.child);
    const childSize = child ? elementSize(child, fallback) : fallback;
    if (childSize) {
      return {
        width: Math.max(1, childSize.width + padding.left + padding.right),
        height: Math.max(1, childSize.height + padding.top + padding.bottom),
      };
    }
  }
  if (type === "text") {
    const font = rawFont(element);
    const text = displayText(rawTextContent(element));
    const width = fallback?.width ?? estimateTextWidth(text, font);
    return {
      width: Math.max(1, width),
      height: Math.max(1, estimateTextHeight(text, font, width)),
    };
  }
  if (type === "text-list") {
    const font = rawFont(element);
    const text = displayText(rawTextListContent(element));
    const width = fallback?.width ?? estimateTextWidth(text, font);
    return {
      width: Math.max(1, width),
      height: Math.max(1, estimateTextHeight(text, font, width)),
    };
  }
  if (type === "line") {
    return {
      width: fallback?.width ?? DECORATIVE_LINE_LENGTH,
      height: fallback?.height ?? DECORATIVE_LINE_THICKNESS,
    };
  }
  if (type === "rectangle" || type === "ellipse") {
    return {
      width: fallback?.width ?? DECORATIVE_LINE_LENGTH,
      height: fallback?.height ?? DECORATIVE_LINE_LENGTH,
    };
  }
  if (type === "flex" || type === "grid" || type === "list-view" || type === "grid-view") {
    return fallback ?? childrenBounds(childArrayInfo(element)?.items ?? []);
  }
  return fallback ?? { width: 1, height: 1 };
}

function childrenBounds(children: unknown[]): Size {
  const records = children.filter(isRecord) as RawElement[];
  if (records.length === 0) return { width: 1, height: 1 };

  return records.reduce(
    (bounds, child) => {
      const box = elementBox(child);
      return {
        width: Math.max(bounds.width, box.x + box.width),
        height: Math.max(bounds.height, box.y + box.height),
      };
    },
    { width: 1, height: 1 },
  );
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
  style?: TextEditStyle,
  frame?: Box | null,
) {
  if (kind === "text") {
    return preserveInlineEditFrame(setRawTextContent(element, draft, style), frame);
  }
  if (kind === "text-list") {
    const next = setRawTextListContent(element, draft);
    return preserveInlineEditFrame(style ? applyTextStyle(next, style) : next, frame);
  }
  if (kind === "table") {
    return preserveInlineEditFrame(setRawTableContent(element, draft), frame);
  }
  if (kind === "svg") {
    return preserveInlineEditFrame(setRawSvgContent(element, draft), frame);
  }
  return element;
}

function preserveInlineEditFrame(element: RawElement, frame?: Box | null) {
  if (!frame) return element;
  return {
    ...element,
    position: {
      ...(asRecord(element.position) ?? {}),
      x: frame.x,
      y: frame.y,
    },
    size: {
      ...(asRecord(element.size) ?? {}),
      width: frame.width,
      height: frame.height,
    },
    __presenton_manual_position: true,
  };
}

function rawTextContent(element: RawElement) {
  const text = readString(element.text);
  if (text != null) return text;
  const runs = readArray(element.runs);
  if (runs.length > 0) {
    return runs.map((run) => readString(asRecord(run)?.text) ?? "").join("");
  }
  return "";
}

function setRawTextContent(
  element: RawElement,
  text: string,
  style?: TextEditStyle,
): RawElement {
  const styled = style ? applyTextStyle(element, style) : element;
  const sourceRuns = readArray(styled.runs);
  const firstRun = asRecord(sourceRuns[0]) ?? {};
  const runs = markdownTextRuns(text, rawFont(styled)).map((run) => ({
    ...firstRun,
    text: run.text,
    font: {
      ...(asRecord(firstRun.font) ?? {}),
      ...fontToSource(run.font),
    },
  }));
  return {
    ...styled,
    text,
    runs,
  };
}

function markdownTextRuns(text: string, baseFont: RenderTextFont): RenderTextRun[] {
  const runs: RenderTextRun[] = [];
  let index = 0;
  let buffer = "";
  let bold = false;
  let italic = false;

  const flush = () => {
    if (!buffer) return;
    runs.push({
      text: buffer,
      font: {
        ...baseFont,
        bold: baseFont.bold || bold,
        italic: baseFont.italic || italic,
      },
    });
    buffer = "";
  };

  while (index < text.length) {
    const nextTwo = text.slice(index, index + 2);
    const nextOne = text[index];
    if (nextTwo === "**" || nextTwo === "__") {
      flush();
      bold = !bold;
      index += 2;
      continue;
    }
    if (nextOne === "*" || nextOne === "_") {
      flush();
      italic = !italic;
      index += 1;
      continue;
    }
    buffer += nextOne;
    index += 1;
  }
  flush();
  return runs.length > 0 ? runs : [{ text: " ", font: baseFont }];
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
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1");
}

function linePoints(width: number, height: number, strokeWidthValue: number) {
  if (height <= Math.max(2, strokeWidthValue * 2)) {
    return [0, height / 2, width, height / 2];
  }
  if (width <= Math.max(2, strokeWidthValue * 2)) {
    return [width / 2, 0, width / 2, height];
  }
  return [0, 0, width, height];
}

function valueProgress(element: RawElement) {
  const min = readNumber(element.min_value) ?? readNumber(element.minValue) ?? 0;
  const max = readNumber(element.max_value) ?? readNumber(element.maxValue) ?? 100;
  const value = readNumber(element.value) ?? min;
  const range = max - min;
  if (!Number.isFinite(range) || range === 0) return 0;
  return clamp((value - min) / range, 0, 1);
}

function pointOnCircle(x: number, y: number, radius: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: x + Math.cos(radians) * radius,
    y: y + Math.sin(radians) * radius,
  };
}

function backgroundColor(ui: RawUi) {
  return withHash(readString(ui.background) ?? "#FFFFFF");
}

function rawFont(element: RawElement) {
  const font = asRecord(element.font) ?? {};
  return fontFromRecord(font, {
    family: "Arial",
    size: 18,
    color: "#111827",
    bold: false,
    italic: false,
    underline: false,
    lineHeight: 1.15,
    letterSpacing: 0,
    wrap: "word",
  });
}

function fontFromRecord(
  font: UnknownRecord | null,
  fallback: RenderTextFont,
): RenderTextFont {
  return {
    family: readString(font?.family) ?? fallback.family,
    size: readNumber(font?.size) ?? fallback.size,
    color: readString(font?.color) ?? fallback.color,
    bold: readBoolean(font?.bold) ?? fallback.bold,
    italic: readBoolean(font?.italic) ?? fallback.italic,
    underline:
      readBoolean(font?.underline) ??
      (readString(font?.text_decoration) === "underline" ||
      readString(font?.textDecoration) === "underline"
        ? true
        : fallback.underline),
    lineHeight:
      readNumber(font?.line_height) ??
      readNumber(font?.lineHeight) ??
      fallback.lineHeight,
    letterSpacing:
      readNumber(font?.letter_spacing) ??
      readNumber(font?.letterSpacing) ??
      fallback.letterSpacing,
    wrap: readString(font?.wrap) ?? fallback.wrap,
  };
}

function fontToSource(font: RenderTextFont) {
  return {
    family: font.family,
    size: font.size,
    color: font.color,
    bold: font.bold,
    italic: font.italic,
    underline: font.underline,
    line_height: font.lineHeight,
    letter_spacing: font.letterSpacing,
    wrap: font.wrap,
  };
}

function rawTextStyle(element: RawElement): TextEditStyle {
  const font = rawFont(element);
  return {
    ...font,
    color: withHash(font.color) ?? "#111827",
    horizontal: readHorizontalAlignment(element.alignment?.horizontal),
    vertical: readVerticalAlignment(element.alignment?.vertical),
  };
}

function applyTextStyle(element: RawElement, style: TextEditStyle): RawElement {
  const sourceFont = asRecord(element.font) ?? {};
  const nextFont = {
    ...sourceFont,
    family: style.family,
    size: style.size,
    color: withHash(style.color) ?? "#111827",
    bold: style.bold,
    italic: style.italic,
    underline: style.underline,
    line_height: style.lineHeight,
    letter_spacing: style.letterSpacing,
    wrap: style.wrap,
  };
  const runs = readArray(element.runs);
  return {
    ...element,
    font: nextFont,
    alignment: {
      ...(asRecord(element.alignment) ?? {}),
      horizontal: style.horizontal,
      vertical: style.vertical,
    },
    ...(runs.length > 0
      ? {
          runs: runs.map((run) => {
            const record = asRecord(run) ?? {};
            return {
              ...record,
              font: {
                ...(asRecord(record.font) ?? {}),
                ...nextFont,
              },
            };
          }),
        }
      : {}),
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

function strokeOpacity(stroke: unknown) {
  const value = asRecord(stroke);
  return readNumber(value?.opacity) ?? 1;
}

function colorWithOpacity(color: string | undefined, opacity: number) {
  if (!color) return undefined;
  const alpha = clamp(opacity, 0, 1);
  if (alpha >= 1) return color;
  const hex = color.startsWith("#") ? color.slice(1) : color;
  if (hex.length === 3) {
    const [r, g, b] = hex.split("").map((part) => parseInt(part + part, 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

function shadowProps(element: RawElement) {
  const shadow = asRecord(element.shadow);
  if (!shadow) return {};
  const color = withHash(readString(shadow.color) ?? "#000000");
  const opacity = readNumber(shadow.opacity) ?? 0.2;
  const blur = readNumber(shadow.blur) ?? 0;
  const offsetX = readNumber(shadow.offset_x) ?? readNumber(shadow.offsetX) ?? 0;
  const offsetY = readNumber(shadow.offset_y) ?? readNumber(shadow.offsetY) ?? 0;
  if (opacity <= 0 || (blur <= 0 && offsetX === 0 && offsetY === 0)) return {};
  return {
    shadowColor: color,
    shadowOpacity: opacity,
    shadowBlur: blur,
    shadowOffsetX: offsetX,
    shadowOffsetY: offsetY,
  };
}

function borderRadius(element: RawElement) {
  const value = element.border_radius ?? element.borderRadius;
  if (typeof value === "number") return value;
  const record = asRecord(value);
  const radius = readNumber(record?.radius);
  if (radius != null) return radius;
  const topLeft = readNumber(record?.tl) ?? readNumber(record?.topLeft) ?? 0;
  const topRight = readNumber(record?.tr) ?? readNumber(record?.topRight) ?? topLeft;
  const bottomRight =
    readNumber(record?.br) ?? readNumber(record?.bottomRight) ?? topRight;
  const bottomLeft =
    readNumber(record?.bl) ?? readNumber(record?.bottomLeft) ?? bottomRight;
  if (topLeft || topRight || bottomRight || bottomLeft) {
    return [topLeft, topRight, bottomRight, bottomLeft];
  }
  return 0;
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

function readHorizontalAlignment(value: unknown): TextEditStyle["horizontal"] {
  const normalized = readString(value);
  if (normalized === "center" || normalized === "right") return normalized;
  return "left";
}

function readVerticalAlignment(value: unknown): TextEditStyle["vertical"] {
  const normalized = readString(value);
  if (normalized === "middle" || normalized === "bottom") return normalized;
  return "top";
}

function alignmentOffset(alignment: string | null, available: number, used: number) {
  const free = Math.max(0, available - used);
  if (alignment === "center") return free / 2;
  if (
    alignment === "right" ||
    alignment === "bottom" ||
    alignment === "end" ||
    alignment === "flex-end"
  ) {
    return free;
  }
  return 0;
}

function readNumberInput(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function readOptionalSize(value: unknown): Size | null {
  const record = asRecord(value);
  const width = readNumber(record?.width);
  const height = readNumber(record?.height);
  if (width == null || height == null) return null;
  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
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

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
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
