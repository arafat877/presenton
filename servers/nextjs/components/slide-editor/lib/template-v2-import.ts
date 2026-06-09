import { resolveBackendAssetUrl } from "@/utils/api";
import {
  DeckSchema,
  SLIDE_H,
  SLIDE_W,
  type Alignment,
  type BorderRadius,
  type ChartDatum,
  type Deck,
  type Fill,
  type Font,
  type LayoutAlignment,
  type LayoutItem,
  type Padding,
  type Shadow,
  type Slide,
  type SlideElement,
  type Stroke,
  type TableCell,
  type TextListItem,
  type TextRun,
} from "./slide-schema";

const SOURCE_W = 1280;
const SOURCE_H = 720;
const X_SCALE = SLIDE_W / SOURCE_W;
const Y_SCALE = SLIDE_H / SOURCE_H;
const SOURCE_PX_TO_PT = (72 * SLIDE_W) / SOURCE_W;

type UnknownRecord = Record<string, unknown>;
type AdaptedPosition = { x: number; y: number };
type AdaptedSize = { width: number; height: number };
type AdaptedBaseElement = {
  fixed?: boolean | null;
  position?: AdaptedPosition | null;
  size?: AdaptedSize | null;
  rotation?: number | null;
  opacity?: number | null;
  shadow?: Shadow | null;
  componentId?: string | null;
  componentInstanceId?: string | null;
  componentDescription?: string | null;
  componentSlot?: string | null;
  layout?: LayoutItem | null;
};
type AdaptedRequiredBaseElement = AdaptedBaseElement & {
  position: AdaptedPosition;
  size: AdaptedSize;
};

type TemplateV2Layout = {
  id?: unknown;
  description?: unknown;
  elements?: unknown;
  components?: unknown;
};

export type TemplateV2ImportResponse = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  raw_layouts?: unknown;
  layouts?: unknown;
  assets?: unknown;
};

const LAYOUT_ALIGNMENT_VALUES = new Set([
  "flex-start",
  "flex-end",
  "center",
  "stretch",
]);

export function adaptTemplateV2ResponseToDeck(
  template: TemplateV2ImportResponse,
): Deck {
  const layouts = extractRenderableLayouts(template);
  if (layouts.length === 0) {
    throw new Error("Template response did not include any layouts.");
  }

  const slides = layouts.slice(0, 50).map(adaptLayoutToSlide);
  const deck = {
    title: truncateString(readString(template.name) ?? "Imported template", 90),
    description:
      truncateString(readString(template.description) ?? "", 1200) || null,
    slides,
  } satisfies Deck;

  const parsed = DeckSchema.safeParse(deck);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? issue.path.join(".") : "deck";
    throw new Error(
      `Backend template response could not be rendered in the editor (${path}: ${issue?.message ?? "invalid deck"}).`,
    );
  }

  return parsed.data;
}

export function normalizeTemplateV2Fonts(
  template: TemplateV2ImportResponse,
  fallbackFonts: Record<string, string> = {},
): Record<string, string> {
  const assets = asRecord(template.assets);
  const assetFonts = asRecord(assets?.fonts);
  const fonts =
    assetFonts && Object.keys(assetFonts).length > 0 ? assetFonts : fallbackFonts;

  return Object.fromEntries(
    Object.entries(fonts)
      .filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" &&
          entry[0].trim().length > 0 &&
          typeof entry[1] === "string" &&
          entry[1].trim().length > 0,
      )
      .map(([name, url]) => [name, resolveBackendAssetUrl(url)]),
  );
}

function extractLayouts(value: unknown): TemplateV2Layout[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord) as TemplateV2Layout[];
  }

  const record = asRecord(value);
  if (Array.isArray(record?.layouts)) {
    return record.layouts.filter(isRecord) as TemplateV2Layout[];
  }

  return [];
}

function extractRenderableLayouts(
  template: TemplateV2ImportResponse,
): TemplateV2Layout[] {
  const layouts = extractLayouts(template.layouts);
  if (layouts.length > 0) return layouts;
  return extractLayouts(template.raw_layouts);
}

function adaptLayoutToSlide(layout: TemplateV2Layout, index: number): Slide {
  const rawElements = extractLayoutElements(layout);
  const elements = rawElements
    .slice(0, 80)
    .map((element) => adaptElement(element))
    .filter((element): element is SlideElement => Boolean(element));

  const slideElements =
    elements.length > 0 ? elements : [invisibleFallbackElement()];

  return {
    title: titleFromLayout(layout, index),
    background: backgroundFromElements(slideElements),
    elements: slideElements,
  };
}

function extractLayoutElements(layout: TemplateV2Layout): unknown[] {
  if (Array.isArray(layout.elements) && layout.elements.length > 0) {
    return layout.elements;
  }

  const components = readArray(layout as UnknownRecord, "components");
  return components
    .map((component): UnknownRecord | null => {
      const raw = asRecord(component);
      if (!raw) return null;
      const elements = readArray(raw, "elements");
      if (elements.length === 0) return null;
      return {
        type: "group",
        position: readValue(raw, "position") ?? { x: 0, y: 0 },
        size: readValue(raw, "size") ?? { width: SOURCE_W, height: SOURCE_H },
        children: elements,
        componentId: readString(raw.id) ?? undefined,
        componentDescription: readString(raw.description) ?? undefined,
      };
    })
    .filter((component): component is UnknownRecord => Boolean(component));
}

function adaptElement(value: unknown): SlideElement | null {
  const raw = asRecord(value);
  const type = readString(raw?.type);
  if (!raw || !type) return null;

  switch (type) {
    case "text":
      return adaptText(raw);
    case "container":
      return adaptContainer(raw);
    case "image":
      return adaptImage(raw);
    case "text-list":
      return adaptTextList(raw);
    case "table":
      return adaptTable(raw);
    case "rectangle":
      return adaptRectangle(raw);
    case "ellipse":
      return adaptEllipse(raw);
    case "line":
      return adaptLine(raw);
    case "svg":
      return adaptSvg(raw);
    case "chart":
      return adaptChart(raw);
    case "flex":
      return adaptFlex(raw);
    case "grid":
      return adaptGrid(raw);
    case "list-view":
      return adaptListView(raw);
    case "grid-view":
      return adaptGridView(raw);
    case "group":
      return adaptGroup(raw);
    default:
      return null;
  }
}

function adaptText(raw: UnknownRecord): SlideElement {
  const font = adaptFont(readRecord(raw, "font"));
  return {
    ...baseElement(raw),
    type: "text",
    font: font && font.lineHeight == null ? { ...font, lineHeight: 1 } : font,
    alignment: adaptAlignment(readRecord(raw, "alignment")),
    fill: adaptFill(readRecord(raw, "fill")),
    stroke: adaptStroke(readRecord(raw, "stroke")),
    runs: adaptTextRuns(readArray(raw, "runs"), readString(raw.text)),
    maxLength: readNumber(raw, "maxLength", "max_length"),
    minLength: readNumber(raw, "minLength", "min_length"),
  };
}

function adaptContainer(raw: UnknownRecord): SlideElement {
  const child = adaptElement(readValue(raw, "child"));
  const base = baseElement(raw);
  return {
    ...base,
    ...(!base.size && child?.size ? { size: child.size } : {}),
    type: "container",
    alignment: adaptAlignment(readRecord(raw, "alignment")),
    fill: adaptFill(readRecord(raw, "fill")),
    stroke: adaptStroke(readRecord(raw, "stroke")),
    borderRadius: adaptBorderRadius(readRecord(raw, "borderRadius", "border_radius")),
    padding: adaptPadding(readRecord(raw, "padding")),
    shadow: adaptShadow(readRecord(raw, "shadow")),
    child,
  };
}

function adaptImage(raw: UnknownRecord): SlideElement {
  const data = readString(raw.data);
  return {
    ...baseElement(raw),
    type: "image",
    data: data ? resolveBackendAssetUrl(data) : null,
    name: truncateString(readString(raw.name) ?? "", 120) || null,
    fit: readEnum(raw, ["contain", "cover", "fill"], "fit"),
    borderRadius: adaptBorderRadius(readRecord(raw, "borderRadius", "border_radius")),
    is_icon: readBoolean(raw, "is_icon") ?? readBoolean(raw, "isIcon"),
  };
}

function adaptTextList(raw: UnknownRecord): SlideElement {
  return {
    ...baseElement(raw),
    type: "text-list",
    font: adaptFont(readRecord(raw, "font")),
    marker: readEnum(raw, ["bullet", "number", "none"], "marker"),
    items: adaptTextListItems(readArray(raw, "items")),
    maxItems: readNumber(raw, "maxItems", "max_items"),
    minItems: readNumber(raw, "minItems", "min_items"),
    maxItemLength: readNumber(raw, "maxItemLength", "max_item_length"),
    minItemLength: readNumber(raw, "minItemLength", "min_item_length"),
  };
}

function adaptTable(raw: UnknownRecord): SlideElement {
  const columns = adaptTableCells(readArray(raw, "columns")).slice(0, 6);
  const rows = readArray(raw, "rows")
    .map((row) => adaptTableCells(Array.isArray(row) ? row : []))
    .filter((row) => row.length > 0)
    .slice(0, 7);

  return {
    ...baseElement(raw),
    type: "table",
    font: adaptFont(readRecord(raw, "font")),
    columns,
    rows: rows.length > 0 ? rows : [columns],
    maxColumns: readNumber(raw, "maxColumns", "max_columns"),
    minColumns: readNumber(raw, "minColumns", "min_columns"),
    maxRows: readNumber(raw, "maxRows", "max_rows"),
    minRows: readNumber(raw, "minRows", "min_rows"),
  };
}

function adaptRectangle(raw: UnknownRecord): SlideElement | null {
  const base = baseElement(raw);
  const fill = adaptFill(readRecord(raw, "fill"));
  const stroke = adaptStroke(readRecord(raw, "stroke"));
  if (!hasVisiblePaint(fill, stroke, base.opacity)) return null;

  return {
    ...base,
    type: "rectangle",
    fill,
    stroke,
    borderRadius: adaptBorderRadius(readRecord(raw, "borderRadius", "border_radius")),
  };
}

function adaptEllipse(raw: UnknownRecord): SlideElement | null {
  const base = baseElement(raw);
  const fill = adaptFill(readRecord(raw, "fill"));
  const stroke = adaptStroke(readRecord(raw, "stroke"));
  if (!hasVisiblePaint(fill, stroke, base.opacity)) return null;

  return {
    ...base,
    type: "ellipse",
    fill,
    stroke,
  };
}

function adaptLine(raw: UnknownRecord): SlideElement {
  return {
    ...baseElement(raw),
    type: "line",
    stroke:
      adaptStroke(readRecord(raw, "stroke")) ?? {
        color: "000000",
        width: 1,
      },
  };
}

function adaptSvg(raw: UnknownRecord): SlideElement {
  return {
    ...baseElement(raw),
    type: "svg",
    svg: truncateString(readString(raw.svg) ?? "<svg />", 20_000),
    name: truncateString(readString(raw.name) ?? "", 120) || null,
  };
}

function adaptChart(raw: UnknownRecord): SlideElement {
  const data = readArray(raw, "data").map(adaptChartDatum).slice(0, 8);

  return {
    ...baseElement(raw),
    type: "chart",
    chartType:
      readEnum(raw, ["bar", "line", "donut"], "chartType", "chart_type") ??
      "bar",
    data: data.length > 0 ? data : [{ label: "Data", value: 0 }],
    title: truncateString(readString(raw.title) ?? "", 80) || null,
    color: readColor(raw.color),
    axisColor: readColor(readValue(raw, "axisColor", "axis_color")),
    labelColor: readColor(readValue(raw, "labelColor", "label_color")),
    showValues: readBoolean(raw, "showValues", "show_values"),
  };
}

function adaptFlex(raw: UnknownRecord): SlideElement {
  return {
    ...requiredBaseElement(raw),
    type: "flex",
    direction: readEnum(raw, ["row", "column"], "direction") ?? "row",
    wrap: readBoolean(raw, "wrap"),
    alignItems: readLayoutAlignment(raw, "alignItems", "align_items"),
    justifyContent: readLayoutAlignment(raw, "justifyContent", "justify_content"),
    padding: adaptPadding(readRecord(raw, "padding")),
    gap: scaleDistance(readNumber(raw, "gap"), X_SCALE),
    columnGap: scaleDistance(readNumber(raw, "columnGap", "column_gap"), X_SCALE),
    rowGap: scaleDistance(readNumber(raw, "rowGap", "row_gap"), Y_SCALE),
    children: readArray(raw, "children").map(adaptElement).filter(Boolean) as SlideElement[],
    maxChildren: readNumber(raw, "maxChildren", "max_children"),
    minChildren: readNumber(raw, "minChildren", "min_children"),
  };
}

function adaptGrid(raw: UnknownRecord): SlideElement {
  return {
    ...requiredBaseElement(raw),
    type: "grid",
    columns: positiveInteger(readNumber(raw, "columns"), 1),
    rows: positiveIntegerOrNull(readNumber(raw, "rows")),
    gap: scaleDistance(readNumber(raw, "gap"), X_SCALE),
    columnGap: scaleDistance(readNumber(raw, "columnGap", "column_gap"), X_SCALE),
    rowGap: scaleDistance(readNumber(raw, "rowGap", "row_gap"), Y_SCALE),
    alignItems: readLayoutAlignment(raw, "alignItems", "align_items"),
    justifyItems: readLayoutAlignment(raw, "justifyItems", "justify_items"),
    padding: adaptPadding(readRecord(raw, "padding")),
    children: readArray(raw, "children").map(adaptElement).filter(Boolean) as SlideElement[],
    maxChildren: readNumber(raw, "maxChildren", "max_children"),
    minChildren: readNumber(raw, "minChildren", "min_children"),
  };
}

function adaptListView(raw: UnknownRecord): SlideElement {
  return {
    ...baseElement(raw),
    type: "list-view",
    direction: readEnum(raw, ["row", "column"], "direction"),
    gap: scaleDistance(readNumber(raw, "gap"), X_SCALE),
    columnGap: scaleDistance(readNumber(raw, "columnGap", "column_gap"), X_SCALE),
    rowGap: scaleDistance(readNumber(raw, "rowGap", "row_gap"), Y_SCALE),
    alignItems: readLayoutAlignment(raw, "alignItems", "align_items"),
    justifyContent: readLayoutAlignment(raw, "justifyContent", "justify_content"),
    padding: adaptPadding(readRecord(raw, "padding")),
    count: Math.max(0, Math.trunc(readNumber(raw, "count") ?? 0)),
    item: adaptElement(readValue(raw, "item")) ?? invisibleFallbackElement(),
    maxCount: readNumber(raw, "maxCount", "max_count"),
    minCount: readNumber(raw, "minCount", "min_count"),
  };
}

function adaptGridView(raw: UnknownRecord): SlideElement {
  return {
    ...baseElement(raw),
    type: "grid-view",
    columns: positiveInteger(readNumber(raw, "columns"), 1),
    rows: positiveIntegerOrNull(readNumber(raw, "rows")),
    gap: scaleDistance(readNumber(raw, "gap"), X_SCALE),
    columnGap: scaleDistance(readNumber(raw, "columnGap", "column_gap"), X_SCALE),
    rowGap: scaleDistance(readNumber(raw, "rowGap", "row_gap"), Y_SCALE),
    alignItems: readLayoutAlignment(raw, "alignItems", "align_items"),
    justifyItems: readLayoutAlignment(raw, "justifyItems", "justify_items"),
    padding: adaptPadding(readRecord(raw, "padding")),
    count: Math.max(0, Math.trunc(readNumber(raw, "count") ?? 0)),
    item: adaptElement(readValue(raw, "item")) ?? invisibleFallbackElement(),
    maxCount: readNumber(raw, "maxCount", "max_count"),
    minCount: readNumber(raw, "minCount", "min_count"),
  };
}

function adaptGroup(raw: UnknownRecord): SlideElement {
  const children = readArray(raw, "children")
    .map(adaptElement)
    .filter(Boolean) as SlideElement[];
  const base = baseElement(raw);
  const frame = groupFrame(base, children);

  return {
    ...base,
    ...frame,
    type: "group",
    children,
    maxChildren: readNumber(raw, "maxChildren", "max_children"),
    minChildren: readNumber(raw, "minChildren", "min_children"),
  };
}

function groupFrame(
  base: AdaptedBaseElement,
  children: SlideElement[],
): AdaptedRequiredBaseElement {
  const bounds = childrenBounds(children);
  return {
    ...base,
    position: base.position ?? { x: 0, y: 0 },
    size: base.size ?? bounds,
  };
}

function childrenBounds(children: SlideElement[]): AdaptedSize {
  if (children.length === 0) return { width: 0.1, height: 0.1 };

  const bounds = children.reduce(
    (acc, child) => {
      const x = child.position?.x ?? 0;
      const y = child.position?.y ?? 0;
      const width = child.size?.width ?? 0.1;
      const height = child.size?.height ?? 0.1;
      return {
        width: Math.max(acc.width, x + width),
        height: Math.max(acc.height, y + height),
      };
    },
    { width: 0.1, height: 0.1 },
  );

  return {
    width: clamp(round(bounds.width), 0.01, SLIDE_W),
    height: clamp(round(bounds.height), 0.01, SLIDE_H),
  };
}

function baseElement(
  raw: UnknownRecord,
  options: { requireFrame?: boolean } = {},
): AdaptedBaseElement {
  const base: AdaptedBaseElement = {};
  const position = adaptPosition(readRecord(raw, "position"));
  const size = adaptSize(readRecord(raw, "size"));
  const componentSlot =
    readString(readValue(raw, "componentSlot", "component_slot")) ??
    readString(raw.name);

  if (readBoolean(raw, "fixed") != null) base.fixed = readBoolean(raw, "fixed");
  if (position) base.position = position;
  if (size) base.size = size;
  if (options.requireFrame && !position) base.position = { x: 0, y: 0 };
  if (options.requireFrame && !size) base.size = { width: SLIDE_W, height: SLIDE_H };
  if (options.requireFrame && !readRecord(raw, "layout")) {
    base.layout = { grow: 1, shrink: 1 };
  }
  if (readNumber(raw, "rotation") != null) {
    base.rotation = clamp(readNumber(raw, "rotation") ?? 0, -360, 360);
  }
  if (readNumber(raw, "opacity") != null) {
    base.opacity = clamp(readNumber(raw, "opacity") ?? 1, 0, 1);
  }
  if (componentSlot) base.componentSlot = truncateString(componentSlot, 120);
  if (readString(readValue(raw, "componentId", "component_id"))) {
    base.componentId = truncateString(
      readString(readValue(raw, "componentId", "component_id")) ?? "",
      120,
    );
  }
  if (readString(readValue(raw, "componentInstanceId", "component_instance_id"))) {
    base.componentInstanceId = truncateString(
      readString(readValue(raw, "componentInstanceId", "component_instance_id")) ?? "",
      160,
    );
  }
  if (readString(readValue(raw, "componentDescription", "component_description"))) {
    base.componentDescription = truncateString(
      readString(readValue(raw, "componentDescription", "component_description")) ?? "",
      600,
    );
  }

  const shadow = adaptShadow(readRecord(raw, "shadow"));
  if (shadow) base.shadow = shadow;

  const layout = adaptLayoutItem(readRecord(raw, "layout"));
  if (layout) base.layout = { ...(base.layout ?? {}), ...layout };

  return base;
}

function requiredBaseElement(raw: UnknownRecord): AdaptedRequiredBaseElement {
  return baseElement(raw, { requireFrame: true }) as AdaptedRequiredBaseElement;
}

function adaptPosition(value: UnknownRecord | null): { x: number; y: number } | null {
  if (!value) return null;
  return {
    x: clamp(round((readNumber(value, "x") ?? 0) * X_SCALE), 0, SLIDE_W),
    y: clamp(round((readNumber(value, "y") ?? 0) * Y_SCALE), 0, SLIDE_H),
  };
}

function adaptSize(value: UnknownRecord | null): { width: number; height: number } | null {
  if (!value) return null;
  return {
    width: clamp(round((readNumber(value, "width") ?? 1) * X_SCALE), 0.01, SLIDE_W),
    height: clamp(round((readNumber(value, "height") ?? 1) * Y_SCALE), 0.01, SLIDE_H),
  };
}

function adaptLayoutItem(value: UnknownRecord | null): LayoutItem | null {
  if (!value) return null;
  return stripNullish({
    grow: clampOptional(readNumber(value, "grow"), 0, 12),
    shrink: clampOptional(readNumber(value, "shrink"), 0, 12),
    basis: scaleDistance(readNumber(value, "basis"), X_SCALE),
    minWidth: scaleDistance(readNumber(value, "minWidth", "min_width"), X_SCALE),
    maxWidth: scaleDistance(readNumber(value, "maxWidth", "max_width"), X_SCALE),
    minHeight: scaleDistance(readNumber(value, "minHeight", "min_height"), Y_SCALE),
    maxHeight: scaleDistance(readNumber(value, "maxHeight", "max_height"), Y_SCALE),
    columnSpan: clampInteger(readNumber(value, "columnSpan", "column_span"), 1, 12),
    rowSpan: clampInteger(readNumber(value, "rowSpan", "row_span"), 1, 12),
    alignSelf: readLayoutAlignment(value, "alignSelf", "align_self"),
  });
}

function adaptAlignment(value: UnknownRecord | null): Alignment | null {
  if (!value) return null;
  return stripNullish({
    horizontal: readEnum(value, ["left", "center", "right"], "horizontal"),
    vertical: readEnum(value, ["top", "middle", "bottom"], "vertical"),
  });
}

function adaptFont(value: UnknownRecord | null): Font | null {
  if (!value) return null;
  const fontWeight = readNumber(value, "fontWeight", "font_weight");
  const size = readNumber(value, "size");
  return stripNullish({
    family:
      truncateString(readString(value.family) ?? readString(value.name) ?? "", 80) ||
      null,
    size:
      size == null ? null : clamp(round(size * SOURCE_PX_TO_PT), 6, 360),
    color: readColor(value.color),
    bold: readBoolean(value, "bold") ?? (fontWeight == null ? null : fontWeight >= 600),
    italic: readBoolean(value, "italic"),
    lineHeight: clampOptional(readNumber(value, "lineHeight", "line_height"), 0.8, 2.2),
    letterSpacing: clamp(readNumber(value, "letterSpacing", "letter_spacing") ?? 0, -200, 600),
    wrap: readEnum(value, ["word", "char", "none"], "wrap"),
    ellipsis: readBoolean(value, "ellipsis"),
  });
}

function adaptFill(value: UnknownRecord | null): Fill | null {
  const color = readColor(value?.color);
  if (!color) return null;
  return stripNullish({
    color,
    opacity: clamp(readNumber(value ?? {}, "opacity") ?? 1, 0, 1),
  });
}

function adaptStroke(value: UnknownRecord | null): Stroke | null {
  const color = readColor(value?.color);
  if (!color) return null;
  return stripNullish({
    color,
    opacity: clamp(readNumber(value ?? {}, "opacity") ?? 1, 0, 1),
    width: clamp(round((readNumber(value ?? {}, "width") ?? 1) * SOURCE_PX_TO_PT), 0, 8),
    dash: readArray(value ?? {}, "dash")
      .map((item) => readRawNumber(item))
      .filter((item): item is number => item != null && item >= 0),
  });
}

function hasVisiblePaint(
  fill: Fill | null,
  stroke: Stroke | null,
  opacity?: number | null,
) {
  if ((opacity ?? 1) <= 0) return false;
  if (fill && (fill.opacity ?? 1) > 0) return true;
  return Boolean(stroke && stroke.width > 0 && (stroke.opacity ?? 1) > 0);
}

function adaptBorderRadius(value: UnknownRecord | null): BorderRadius | null {
  if (!value) return null;
  return {
    tl: clamp(round((readNumber(value, "tl") ?? 0) * X_SCALE), 0, 0.5),
    tr: clamp(round((readNumber(value, "tr") ?? 0) * X_SCALE), 0, 0.5),
    bl: clamp(round((readNumber(value, "bl") ?? 0) * X_SCALE), 0, 0.5),
    br: clamp(round((readNumber(value, "br") ?? 0) * X_SCALE), 0, 0.5),
  };
}

function adaptPadding(value: UnknownRecord | null): Padding | null {
  if (!value) return null;
  return {
    top: Math.max(0, round((readNumber(value, "top") ?? 0) * Y_SCALE)),
    right: Math.max(0, round((readNumber(value, "right") ?? 0) * X_SCALE)),
    bottom: Math.max(0, round((readNumber(value, "bottom") ?? 0) * Y_SCALE)),
    left: Math.max(0, round((readNumber(value, "left") ?? 0) * X_SCALE)),
  };
}

function adaptShadow(value: UnknownRecord | null): Shadow | null {
  if (!value) return null;
  return stripNullish({
    color: readColor(value.color),
    blur: clamp(round((readNumber(value, "blur") ?? 0) * X_SCALE), 0, 100),
    opacity: clamp(readNumber(value, "opacity") ?? 0.2, 0, 1),
    offsetX: clamp(round((readNumber(value, "offsetX", "offset_x") ?? 0) * X_SCALE), -2, 2),
    offsetY: clamp(round((readNumber(value, "offsetY", "offset_y") ?? 0) * Y_SCALE), -2, 2),
  });
}

function adaptTextRuns(value: unknown[], fallbackText?: string | null): TextRun[] {
  const runs = value
    .map((item) => {
      const record = asRecord(item);
      if (!record) return null;
      const text = truncateString(readString(record.text) ?? "", 700);
      if (!text) return null;
      const font = adaptFont(readRecord(record, "font"));
      return stripNullish({ text, font }) as TextRun;
    })
    .filter((item): item is TextRun => Boolean(item))
    .slice(0, 24);

  if (runs.length > 0) return runs;
  return [{ text: truncateString(fallbackText || "Text", 700) }];
}

function adaptTextListItems(value: unknown[]): TextListItem[] {
  const items = value
    .map((item) => {
      if (Array.isArray(item)) {
        return item
          .map((run) => readString(asRecord(run)?.text) ?? "")
          .join("");
      }
      const record = asRecord(item);
      return readString(record?.text) ?? readString(item);
    })
    .map((text) => truncateString(text ?? "", 180))
    .filter((text) => text.length > 0)
    .slice(0, 8)
    .map((text) => ({ type: "text" as const, text }));

  return items.length > 0 ? items : [{ type: "text", text: "List item" }];
}

function adaptTableCells(value: unknown[]): TableCell[] {
  const cells = value
    .map((item) => {
      const record = asRecord(item);
      if (!record) return null;
      const textValue = record.text;
      const textRecord = asRecord(textValue);
      const text = truncateString(
        textRecord ? readString(textRecord.text) ?? "" : readString(textValue) ?? "",
        80,
      );
      return stripNullish({
        fill: adaptFill(readRecord(record, "fill")),
        stroke: adaptStroke(readRecord(record, "stroke")),
        font: adaptFont(readRecord(record, "font")) ?? adaptFont(readRecord(textRecord ?? {}, "font")),
        text: text || null,
        maxLength: readNumber(record, "maxLength", "max_length"),
        minLength: readNumber(record, "minLength", "min_length"),
      }) as TableCell;
    })
    .filter((item): item is TableCell => Boolean(item));

  return cells.length > 0 ? cells : [{ text: "" }];
}

function adaptChartDatum(value: unknown): ChartDatum {
  const record = asRecord(value) ?? {};
  const label = truncateString(readString(record.label) ?? "", 40) || "Data";
  return stripNullish({
    label,
    value: clamp(readNumber(record, "value") ?? 0, -1_000_000, 1_000_000),
    color: readColor(record.color),
  }) as ChartDatum;
}

function invisibleFallbackElement(): SlideElement {
  return {
    type: "rectangle",
    position: { x: 0, y: 0 },
    size: { width: 0.1, height: 0.1 },
    fill: { color: "FFFFFF" },
    opacity: 0,
  };
}

function backgroundFromElements(elements: SlideElement[]) {
  const background = elements.find(
    (element) =>
      element.type === "rectangle" &&
      element.position?.x === 0 &&
      element.position?.y === 0 &&
      element.size?.width === SLIDE_W &&
      element.size?.height === SLIDE_H &&
      element.fill?.color,
  );

  return background?.type === "rectangle" && background.fill?.color
    ? background.fill.color
    : "FFFFFF";
}

function titleFromLayout(layout: TemplateV2Layout, index: number) {
  const id = readString(layout.id);
  const slideNumber = id?.match(/\d+/)?.[0] ?? `${index + 1}`;
  return truncateString(`Slide ${slideNumber}`, 60);
}

function readValue(
  record: UnknownRecord,
  camelKey: string,
  snakeKey = camelToSnake(camelKey),
) {
  return record[camelKey] ?? record[snakeKey];
}

function readRecord(
  record: UnknownRecord | null | undefined,
  camelKey: string,
  snakeKey = camelToSnake(camelKey),
) {
  return asRecord(record ? readValue(record, camelKey, snakeKey) : null);
}

function readArray(
  record: UnknownRecord,
  camelKey: string,
  snakeKey = camelToSnake(camelKey),
) {
  const value = readValue(record, camelKey, snakeKey);
  return Array.isArray(value) ? value : [];
}

function readNumber(
  record: UnknownRecord,
  camelKey: string,
  snakeKey = camelToSnake(camelKey),
) {
  return readRawNumber(readValue(record, camelKey, snakeKey));
}

function readRawNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readBoolean(
  record: UnknownRecord,
  camelKey: string,
  snakeKey = camelToSnake(camelKey),
) {
  const value = readValue(record, camelKey, snakeKey);
  return typeof value === "boolean" ? value : null;
}

function readEnum<const T extends readonly string[]>(
  record: UnknownRecord,
  values: T,
  camelKey: string,
  snakeKey = camelToSnake(camelKey),
): T[number] | null {
  const value = readString(readValue(record, camelKey, snakeKey));
  return value && (values as readonly string[]).includes(value)
    ? (value as T[number])
    : null;
}

function readLayoutAlignment(
  record: UnknownRecord,
  camelKey: string,
  snakeKey = camelToSnake(camelKey),
): LayoutAlignment | null {
  const value = readString(readValue(record, camelKey, snakeKey));
  return value && LAYOUT_ALIGNMENT_VALUES.has(value)
    ? (value as LayoutAlignment)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readColor(value: unknown): string | null {
  const color = readString(value)?.trim();
  if (!color) return null;
  return /^#?[0-9A-Fa-f]{6}$/.test(color) ? color : null;
}

function asRecord(value: unknown): UnknownRecord | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripNullish<T extends UnknownRecord>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) =>
        item !== null &&
        item !== undefined &&
        (!Array.isArray(item) || item.length > 0),
    ),
  ) as T;
}

function scaleDistance(value: number | null, scale: number) {
  return value == null ? null : Math.max(0, round(value * scale));
}

function positiveInteger(value: number | null, fallback: number) {
  return Math.max(1, Math.trunc(value ?? fallback));
}

function positiveIntegerOrNull(value: number | null) {
  return value == null ? null : positiveInteger(value, 1);
}

function clampInteger(value: number | null, min: number, max: number) {
  return value == null ? null : Math.trunc(clamp(value, min, max));
}

function clampOptional(value: number | null, min: number, max: number) {
  return value == null ? null : clamp(value, min, max);
}

function truncateString(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function camelToSnake(value: string) {
  return value.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number) {
  return Math.round(value * 10000) / 10000;
}
