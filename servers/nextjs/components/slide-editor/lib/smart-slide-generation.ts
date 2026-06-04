import { z } from "zod";

import {
  DeckSchema,
  SLIDE_H,
  SLIDE_W,
  type ChartElement,
  type Deck,
  type Fill,
  type Font,
  type ImageElement,
  type LineElement,
  type RectangleElement,
  type Slide,
  type SlideElement,
  type Stroke,
  type SvgElement,
  type TableCell,
  type TextElement,
  type TextListElement,
} from "./slide-schema";

export type SmartDeckThemeInput = {
  background: string;
  surface: string;
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  muted: string;
};

type SmartGenerationInput = {
  description: string;
  slideCount: number;
  theme?: SmartDeckThemeInput;
};

type FallbackKind =
  | "cover"
  | "cards"
  | "metrics"
  | "chart"
  | "timeline"
  | "table"
  | "bullets"
  | "closing";

type FallbackSection = {
  kind: FallbackKind;
  title: string;
  summary: string;
  bullets: string[];
};

type SmartTheme = {
  background: string;
  surface: string;
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  muted: string;
  line: string;
  card: string;
  dark: string;
  accents: string[];
};

const SANS = "Poppins";
const SMART_TEMPLATE_LABEL = "Smart";
const DEFAULT_THEME: SmartTheme = {
  background: "FFFFFE",
  surface: "F7F8FB",
  primary: "2563EB",
  secondary: "F97316",
  accent: "10B981",
  text: "111827",
  muted: "64748B",
  line: "E5E7EB",
  card: "FFFFFF",
  dark: "111827",
  accents: ["2563EB", "F97316", "10B981", "8B5CF6", "06B6D4", "F59E0B"],
};

const SmartHexColorSchema = z
  .string()
  .regex(/^#?[0-9A-Fa-f]{6}$/, "Use 6-digit hex colors.");

const SmartPositionSchema = z
  .object({
    x: z.number().min(0).max(SLIDE_W),
    y: z.number().min(0).max(SLIDE_H),
  })
  .strict();

const SmartSizeSchema = z
  .object({
    width: z.number().positive().max(SLIDE_W),
    height: z.number().positive().max(SLIDE_H),
  })
  .strict();

const SmartFillSchema = z
  .object({
    color: SmartHexColorSchema,
    opacity: z.number().min(0).max(1).nullable(),
  })
  .strict();

const SmartStrokeSchema = z
  .object({
    color: SmartHexColorSchema,
    opacity: z.number().min(0).max(1).nullable(),
    width: z.number().min(0).max(8),
    dash: z.array(z.number().min(0)).max(8).nullable(),
  })
  .strict();

const SmartBorderRadiusSchema = z
  .object({
    tl: z.number().min(0).max(0.5),
    tr: z.number().min(0).max(0.5),
    bl: z.number().min(0).max(0.5),
    br: z.number().min(0).max(0.5),
  })
  .strict();

const SmartFontSchema = z
  .object({
    family: z.string().min(1).max(80).nullable(),
    size: z.number().min(6).max(72).nullable(),
    color: SmartHexColorSchema.nullable(),
    bold: z.boolean().nullable(),
    italic: z.boolean().nullable(),
    lineHeight: z.number().min(0.8).max(1.8).nullable(),
    letterSpacing: z.number().min(0).max(300).nullable(),
    wrap: z.enum(["word", "char", "none"]).nullable(),
  })
  .strict();

const SmartAlignmentSchema = z
  .object({
    horizontal: z.enum(["left", "center", "right"]).nullable(),
    vertical: z.enum(["top", "middle", "bottom"]).nullable(),
  })
  .strict();

const smartElementBaseShape = {
  position: SmartPositionSchema,
  size: SmartSizeSchema,
  rotation: z.number().min(-360).max(360).nullable(),
  opacity: z.number().min(0).max(1).nullable(),
};

const SmartTextRunSchema = z
  .object({
    text: z.string().min(1).max(520),
    font: SmartFontSchema.nullable(),
  })
  .strict();

const SmartTextListItemSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().min(1).max(120),
  })
  .strict();

const SmartChartDatumSchema = z
  .object({
    label: z.string().min(1).max(36),
    value: z.number().min(-1_000_000).max(1_000_000),
    color: SmartHexColorSchema.nullable(),
  })
  .strict();

const SmartTableCellSchema = z
  .object({
    text: z.string().max(70).nullable(),
    fill: SmartFillSchema.nullable(),
    stroke: SmartStrokeSchema.nullable(),
    font: SmartFontSchema.nullable(),
  })
  .strict();

export const SmartSlideElementSchema = z
  .object({
    type: z.enum([
      "text",
      "text-list",
      "rectangle",
      "ellipse",
      "line",
      "svg",
      "image",
      "chart",
      "table",
    ]),
    ...smartElementBaseShape,
    runs: z.array(SmartTextRunSchema).min(1).max(6).nullable(),
    font: SmartFontSchema.nullable(),
    alignment: SmartAlignmentSchema.nullable(),
    fill: SmartFillSchema.nullable(),
    marker: z.enum(["bullet", "number", "none"]).nullable(),
    items: z.array(SmartTextListItemSchema).min(1).max(7).nullable(),
    stroke: SmartStrokeSchema.nullable(),
    borderRadius: SmartBorderRadiusSchema.nullable(),
    svg: z.string().min(1).max(5000).nullable(),
    name: z.string().min(1).max(120).nullable(),
    fit: z.enum(["contain", "cover", "fill"]).nullable(),
    chartType: z.enum(["bar", "line", "donut"]).nullable(),
    data: z.array(SmartChartDatumSchema).min(1).max(8).nullable(),
    title: z.string().min(1).max(80).nullable(),
    color: SmartHexColorSchema.nullable(),
    axisColor: SmartHexColorSchema.nullable(),
    labelColor: SmartHexColorSchema.nullable(),
    showValues: z.boolean().nullable(),
    columns: z.array(SmartTableCellSchema).min(1).max(6).nullable(),
    rows: z.array(z.array(SmartTableCellSchema).min(1).max(6)).min(1).max(7).nullable(),
  })
  .strict();

const SmartDeckThemeSchema = z
  .object({
    background: SmartHexColorSchema,
    surface: SmartHexColorSchema,
    primary: SmartHexColorSchema,
    secondary: SmartHexColorSchema,
    accent: SmartHexColorSchema,
    text: SmartHexColorSchema,
    muted: SmartHexColorSchema,
  })
  .strict();

const SmartSlideSchema = z
  .object({
    background: SmartHexColorSchema,
    title: z.string().min(1).max(60),
    elements: z.array(SmartSlideElementSchema).min(3).max(34),
  })
  .strict();

export function createSmartDeckSchema(slideCount: number) {
  return z
    .object({
      title: z.string().min(1).max(90),
      description: z.string().max(1200),
      theme: SmartDeckThemeSchema,
      slides: z.array(SmartSlideSchema).length(clampSlideCount(slideCount)),
    })
    .strict();
}

type SmartSlideElement = z.infer<typeof SmartSlideElementSchema>;

export function normalizeSmartGeneratedDeck(
  rawDeck: unknown,
  input: SmartGenerationInput,
): Deck {
  const parsed = createSmartDeckSchema(input.slideCount).parse(rawDeck);
  const title = truncateText(parsed.title || createDeckTitle(input.description), 90);
  const theme = deckThemeFromSmartTheme(
    resolveSmartTheme(input.theme ?? parsed.theme),
  );

  return DeckSchema.parse({
    title,
    description: truncateText(parsed.description || input.description, 1200),
    theme,
    slides: parsed.slides.map((slide, index) => {
      const background = cleanHex(slide.background, theme.background);
      return {
        title: truncateText(slide.title || `Slide ${index + 1}`, 60),
        background,
        elements: slide.elements.map((element) =>
          normalizeSmartElement(element, theme, background),
        ),
      };
    }),
  });
}

export function createSmartFallbackDeck(input: SmartGenerationInput): Deck {
  const slideCount = clampSlideCount(input.slideCount);
  const deckTitle = createDeckTitle(input.description);
  const sections = fallbackSections(deckTitle, input.description, slideCount);
  const smartTheme = resolveSmartTheme(input.theme);
  const slides = sections.map((section, index) =>
    fallbackSlide(section, index, slideCount, deckTitle, smartTheme),
  );

  return DeckSchema.parse({
    title: deckTitle,
    description: truncateText(input.description, 1200),
    theme: deckThemeFromSmartTheme(smartTheme),
    slides,
  });
}

function normalizeSmartElement(
  element: SmartSlideElement,
  theme: Deck["theme"],
  slideBackground: string,
): SlideElement {
  switch (element.type) {
    case "text": {
      const fill = normalizeFill(element.fill, theme?.surface ?? DEFAULT_THEME.surface);
      const textBackground = fill?.color ?? slideBackground;
      return {
        type: "text",
        ...normalizeVisibleTextBox(element),
        runs: (element.runs ?? [emptySmartTextRun()]).map((run) => ({
          text: normalizeText(run.text, 520),
          font: run.font
            ? normalizeReadableFont(
                run.font,
                theme?.text ?? DEFAULT_THEME.text,
                12,
                textBackground,
                theme,
              )
            : undefined,
        })),
        font: normalizeReadableFont(
          element.font,
          theme?.text ?? DEFAULT_THEME.text,
          15,
          textBackground,
          theme,
        ),
        alignment: element.alignment ?? undefined,
        fill,
      } satisfies TextElement;
    }
    case "text-list":
      return {
        type: "text-list",
        ...normalizeVisibleTextBox(element),
        marker: element.marker ?? "bullet",
        items: (element.items ?? [emptySmartTextListItem()]).slice(0, 7).map((item) => ({
          type: "text",
          text: normalizeText(item.text, 120),
        })),
        font: normalizeReadableFont(
          element.font,
          theme?.text ?? DEFAULT_THEME.text,
          12,
          slideBackground,
          theme,
        ),
      } satisfies TextListElement;
    case "rectangle":
      return {
        type: "rectangle",
        ...normalizeBox(element),
        fill: normalizeFill(element.fill, theme?.surface ?? DEFAULT_THEME.surface),
        stroke: normalizeStroke(element.stroke, DEFAULT_THEME.line),
        borderRadius: element.borderRadius ?? undefined,
      } satisfies RectangleElement;
    case "ellipse":
      return {
        type: "ellipse",
        ...normalizeBox(element),
        fill: normalizeFill(element.fill, theme?.accent ?? DEFAULT_THEME.accent),
        stroke: normalizeStroke(element.stroke, DEFAULT_THEME.line),
      };
    case "line":
      return {
        type: "line",
        ...normalizeBox(element),
        stroke: normalizeStroke(element.stroke, theme?.muted ?? DEFAULT_THEME.muted) ?? {
          color: DEFAULT_THEME.muted,
          width: 1,
        },
      } satisfies LineElement;
    case "svg":
      return {
        type: "svg",
        ...normalizeBox(element),
        svg: element.svg ?? fallbackSvgMarkup(theme),
        name: truncateText(element.name ?? "Generated visual", 120),
      } satisfies SvgElement;
    case "image":
      return {
        type: "image",
        ...normalizeBox(element),
        name: truncateText(element.name ?? "Generated image", 120),
        fit: element.fit ?? "cover",
        borderRadius: element.borderRadius ?? radius(0.1),
      } satisfies ImageElement;
    case "chart":
      return {
        type: "chart",
        ...normalizeVisibleTextBox(element),
        chartType: element.chartType ?? "bar",
        title: truncateText(element.title ?? "Chart", 80),
        color: cleanHex(element.color, theme?.primary ?? DEFAULT_THEME.primary),
        axisColor: cleanHex(element.axisColor, DEFAULT_THEME.line),
        labelColor: readableTextColor(
          cleanHex(element.labelColor, theme?.muted ?? DEFAULT_THEME.muted),
          DEFAULT_THEME.card,
          theme,
        ),
        showValues: element.showValues ?? true,
        data: (element.data ?? fallbackSmartChartData()).map((datum, index) => ({
          label: normalizeText(datum.label, 36),
          value: Math.round(datum.value),
          color: cleanHex(
            datum.color,
            DEFAULT_THEME.accents[index % DEFAULT_THEME.accents.length],
          ),
        })),
      } satisfies ChartElement;
    case "table": {
      const sourceColumns = element.columns ?? fallbackSmartTableColumns();
      const sourceRows = element.rows ?? fallbackSmartTableRows();
      const columnCount = Math.max(1, Math.min(6, sourceColumns.length));
      const columns = sourceColumns
        .slice(0, columnCount)
        .map((cell) => normalizeTableCell(cell, true, theme));
      const rows = sourceRows.slice(0, 7).map((row) =>
        Array.from({ length: columnCount }, (_, columnIndex) =>
          normalizeTableCell(
            row[columnIndex] ?? emptySmartTableCell(),
            false,
            theme,
          ),
        ),
      );
      return {
        type: "table",
        ...normalizeVisibleTextBox(element),
        font: normalizeReadableFont(
          element.font,
          theme?.text ?? DEFAULT_THEME.text,
          9,
          slideBackground,
          theme,
        ),
        columns,
        rows,
      };
    }
  }
}

function normalizeBox(element: {
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation?: number | null;
  opacity?: number | null;
}) {
  const x = clampNumber(element.position.x, 0, SLIDE_W - 0.05);
  const y = clampNumber(element.position.y, 0, SLIDE_H - 0.05);
  const width = clampNumber(element.size.width, 0.05, SLIDE_W - x);
  const height = clampNumber(element.size.height, 0.05, SLIDE_H - y);
  return {
    position: { x: roundInches(x), y: roundInches(y) },
    size: { width: roundInches(width), height: roundInches(height) },
    rotation: element.rotation ?? undefined,
    opacity: element.opacity ?? undefined,
  };
}

function normalizeVisibleTextBox(element: {
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation?: number | null;
  opacity?: number | null;
}) {
  const box = normalizeBox(element);
  return {
    ...box,
    opacity: box.opacity == null ? undefined : Math.max(0.86, box.opacity),
  };
}

function normalizeFill(
  fill: { color: string; opacity?: number | null } | null | undefined,
  fallback: string,
): Fill | undefined {
  if (!fill) return undefined;
  return {
    color: cleanHex(fill.color, fallback),
    opacity: fill.opacity ?? undefined,
  };
}

function normalizeStroke(
  stroke: { color: string; opacity?: number | null; width: number; dash?: number[] | null } | null | undefined,
  fallback: string,
): Stroke | undefined {
  if (!stroke) return undefined;
  return {
    color: cleanHex(stroke.color, fallback),
    opacity: stroke.opacity ?? undefined,
    width: clampNumber(stroke.width, 0, 8),
    dash: stroke.dash ?? undefined,
  };
}

function normalizeFont(
  font: z.infer<typeof SmartFontSchema> | null | undefined,
  fallbackColor: string,
  fallbackSize = 12,
): Font {
  return {
    family: font?.family?.trim() || SANS,
    size: clampNumber(font?.size ?? fallbackSize, 6, 72),
    color: cleanHex(font?.color, fallbackColor),
    bold: font?.bold ?? undefined,
    italic: font?.italic ?? undefined,
    lineHeight: font?.lineHeight ?? 1.15,
    letterSpacing: font?.letterSpacing ?? undefined,
    wrap: font?.wrap ?? "word",
  };
}

function normalizeReadableFont(
  font: z.infer<typeof SmartFontSchema> | null | undefined,
  fallbackColor: string,
  fallbackSize: number,
  background: string,
  theme: Deck["theme"],
): Font {
  const normalized = normalizeFont(font, fallbackColor, fallbackSize);
  return {
    ...normalized,
    color: readableTextColor(normalized.color ?? fallbackColor, background, theme),
  };
}

function normalizeTableCell(
  cell: z.infer<typeof SmartTableCellSchema>,
  header: boolean,
  theme: Deck["theme"],
): TableCell {
  const fill = normalizeFill(
    cell.fill ?? {
      color: header
        ? (theme?.primary ?? DEFAULT_THEME.primary)
        : DEFAULT_THEME.card,
    },
    header ? DEFAULT_THEME.primary : DEFAULT_THEME.card,
  );
  const background = fill?.color ?? (header ? DEFAULT_THEME.primary : DEFAULT_THEME.card);
  return {
    text: normalizeText(cell.text ?? "-", 70),
    fill,
    stroke: normalizeStroke(
      cell.stroke ?? { color: DEFAULT_THEME.line, width: 0.6 },
      DEFAULT_THEME.line,
    ),
    font: normalizeReadableFont(
      cell.font,
      header ? "FFFFFF" : (theme?.text ?? DEFAULT_THEME.text),
      8.5,
      background,
      theme,
    ),
  };
}

function fallbackSections(
  deckTitle: string,
  description: string,
  slideCount: number,
): FallbackSection[] {
  const subject = deckTitle;
  if (slideCount === 1) {
    return [
      {
        kind: "cover",
        title: subject,
        summary: conciseSummary(description, subject),
        bullets: keyPhrases(description, subject).slice(0, 3),
      },
    ];
  }

  return Array.from({ length: slideCount }, (_, index) => {
    if (index === 0) {
      return {
        kind: "cover",
        title: subject,
        summary: conciseSummary(description, subject),
        bullets: keyPhrases(description, subject).slice(0, 3),
      };
    }
    if (index === slideCount - 1) {
      return {
        kind: "closing",
        title: "What To Do Next",
        summary: `Turn the ${subject.toLowerCase()} story into a clear decision and next step.`,
        bullets: ["Agree the decision owner", "Validate the strongest evidence", "Set the next review date"],
      };
    }

    const kinds: FallbackKind[] = [
      "cards",
      "metrics",
      "chart",
      "timeline",
      "table",
      "bullets",
    ];
    const kind = kinds[(index - 1) % kinds.length];
    const titles = {
      cards: "Core Narrative",
      metrics: "Signal Snapshot",
      chart: "Evidence Trend",
      timeline: "Progression",
      table: "Decision Matrix",
      bullets: "Recommended Moves",
    } satisfies Record<Exclude<FallbackKind, "cover" | "closing">, string>;
    return {
      kind,
      title: titles[kind as keyof typeof titles] ?? `Section ${index + 1}`,
      summary: subjectSpecificSummary(kind, subject),
      bullets: keyPhrases(description, subject, index),
    };
  });
}

function fallbackSlide(
  section: FallbackSection,
  index: number,
  slideCount: number,
  deckTitle: string,
  theme: SmartTheme,
): Slide {
  switch (section.kind) {
    case "cover":
      return coverSlide(section, index, slideCount, deckTitle, theme);
    case "metrics":
      return metricsSlide(section, index, slideCount, theme);
    case "chart":
      return chartSlide(section, index, slideCount, theme);
    case "timeline":
      return timelineSlide(section, index, slideCount, theme);
    case "table":
      return tableSlide(section, index, slideCount, theme);
    case "bullets":
      return bulletsSlide(section, index, slideCount, theme);
    case "closing":
      return closingSlide(section, index, slideCount, theme);
    case "cards":
    default:
      return cardsSlide(section, index, slideCount, theme);
  }
}

function coverSlide(
  section: FallbackSection,
  index: number,
  slideCount: number,
  deckTitle: string,
  theme: SmartTheme,
): Slide {
  return slide(section.title, theme.background, [
    rect({ x: 0, y: 0, w: 10, h: 5.625, fill: theme.dark }),
    rect({ x: 0.62, y: 0.62, w: 0.08, h: 4.42, fill: theme.accent, r: 0.03 }),
    svg({
      x: 5.76,
      y: 0.62,
      w: 3.66,
      h: 3.04,
      markup: smartMotifSvg(theme, deckTitle),
      name: `${deckTitle} generated visual`,
    }),
    text({
      x: 0.92,
      y: 0.95,
      w: 1.52,
      h: 0.2,
      value: SMART_TEMPLATE_LABEL.toUpperCase(),
      size: 8,
      color: theme.accent,
      bold: true,
      letterSpacing: 180,
      wrap: "none",
    }),
    text({
      x: 0.88,
      y: 1.36,
      w: 4.52,
      h: 1.32,
      value: deckTitle,
      size: 34,
      color: "FFFFFF",
      bold: true,
      lineHeight: 1.02,
    }),
    text({
      x: 0.92,
      y: 2.98,
      w: 4.2,
      h: 0.62,
      value: section.summary,
      size: 12,
      color: "CBD5E1",
      lineHeight: 1.22,
    }),
    ...section.bullets.slice(0, 3).flatMap((item, itemIndex) => {
      const x = 0.94 + itemIndex * 1.42;
      return [
        rect({ x, y: 4.0, w: 1.18, h: 0.05, fill: theme.accents[itemIndex], r: 0.02 }),
        text({
          x,
          y: 4.22,
          w: 1.18,
          h: 0.34,
          value: item,
          size: 8,
          color: "E5E7EB",
          bold: true,
          lineHeight: 1.12,
        }),
      ];
    }),
    footer(index, slideCount, "CBD5E1"),
  ]);
}

function cardsSlide(
  section: FallbackSection,
  index: number,
  slideCount: number,
  theme: SmartTheme,
): Slide {
  const items = section.bullets.slice(0, 4);
  return slide(section.title, theme.background, [
    ...header(section, theme, "INSIGHTS"),
    ...items.flatMap((item, itemIndex) => {
      const x = 0.72 + (itemIndex % 2) * 4.32;
      const y = 1.62 + Math.floor(itemIndex / 2) * 1.58;
      return cardElements(x, y, 4.04, 1.28, item, section.summary, itemIndex, theme);
    }),
    footer(index, slideCount, theme.muted),
  ]);
}

function metricsSlide(
  section: FallbackSection,
  index: number,
  slideCount: number,
  theme: SmartTheme,
): Slide {
  const metrics = ["42%", "3.2x", "18 mo", "7"];
  return slide(section.title, theme.background, [
    ...header(section, theme, "SIGNALS"),
    ...metrics.flatMap((value, metricIndex) => {
      const x = 0.72 + metricIndex * 2.16;
      const label = section.bullets[metricIndex % section.bullets.length] ?? "Signal";
      return [
        rect({ x, y: 1.74, w: 1.9, h: 2.52, fill: metricIndex === 0 ? theme.dark : theme.card, stroke: theme.line, r: 0.12 }),
        text({
          x: x + 0.24,
          y: 2.14,
          w: 1.22,
          h: 0.46,
          value,
          size: metricIndex === 0 ? 28 : 24,
          color: metricIndex === 0 ? "FFFFFF" : theme.primary,
          bold: true,
          wrap: "none",
        }),
        text({
          x: x + 0.24,
          y: 2.86,
          w: 1.36,
          h: 0.42,
          value: label,
          size: 9,
          color: metricIndex === 0 ? "CBD5E1" : theme.text,
          bold: true,
          lineHeight: 1.12,
        }),
        rect({ x: x + 0.24, y: 3.62, w: 0.72, h: 0.05, fill: theme.accents[metricIndex], r: 0.02 }),
      ];
    }),
    footer(index, slideCount, theme.muted),
  ]);
}

function chartSlide(
  section: FallbackSection,
  index: number,
  slideCount: number,
  theme: SmartTheme,
): Slide {
  const data = section.bullets.slice(0, 5).map((label, datumIndex) => ({
    label: truncateText(label, 18),
    value: 28 + datumIndex * 13 + (index % 3) * 4,
    color: theme.accents[datumIndex % theme.accents.length],
  }));
  return slide(section.title, theme.background, [
    ...header(section, theme, "EVIDENCE"),
    rect({ x: 0.72, y: 1.56, w: 5.6, h: 3.34, fill: theme.card, stroke: theme.line, r: 0.1 }),
    {
      type: "chart",
      position: { x: 1.0, y: 1.88 },
      size: { width: 5.04, height: 2.74 },
      chartType: index % 2 === 0 ? "line" : "bar",
      title: `${section.title} indicators`,
      color: theme.primary,
      axisColor: "CBD5E1",
      labelColor: theme.muted,
      showValues: true,
      data,
    },
    rect({ x: 6.58, y: 1.56, w: 2.68, h: 3.34, fill: theme.dark, stroke: "273449", r: 0.1 }),
    text({
      x: 6.9,
      y: 2.0,
      w: 1.82,
      h: 0.54,
      value: "Read the trend before choosing the move.",
      size: 18,
      color: "FFFFFF",
      bold: true,
      lineHeight: 1.06,
    }),
    text({
      x: 6.92,
      y: 2.92,
      w: 1.8,
      h: 0.72,
      value: section.summary,
      size: 9,
      color: "CBD5E1",
      lineHeight: 1.18,
    }),
    footer(index, slideCount, theme.muted),
  ]);
}

function timelineSlide(
  section: FallbackSection,
  index: number,
  slideCount: number,
  theme: SmartTheme,
): Slide {
  const items = section.bullets.slice(0, 4);
  return slide(section.title, theme.background, [
    ...header(section, theme, "ROADMAP"),
    line({ x: 0.96, y: 3.08, w: 8.08, h: 0.01, color: theme.text, width: 0.8, dash: [5, 5] }),
    ...items.flatMap((item, itemIndex) => {
      const x = 1.1 + itemIndex * 2.02;
      const top = itemIndex % 2 === 0;
      return [
        ellipse({ x: x + 0.22, y: 2.96, w: 0.24, h: 0.24, fill: theme.accents[itemIndex] }),
        rect({ x, y: top ? 1.72 : 3.54, w: 1.48, h: 0.86, fill: theme.card, stroke: theme.line, r: 0.08 }),
        text({
          x: x + 0.18,
          y: top ? 1.9 : 3.72,
          w: 1.1,
          h: 0.36,
          value: item,
          size: 8.4,
          color: theme.text,
          bold: true,
          lineHeight: 1.12,
          align: "center",
        }),
      ];
    }),
    footer(index, slideCount, theme.muted),
  ]);
}

function tableSlide(
  section: FallbackSection,
  index: number,
  slideCount: number,
  theme: SmartTheme,
): Slide {
  return slide(section.title, theme.background, [
    ...header(section, theme, "MATRIX"),
    {
      type: "table",
      position: { x: 0.74, y: 1.7 },
      size: { width: 8.48, height: 2.88 },
      font: { family: SANS, size: 9, color: theme.text },
      columns: ["Area", "Signal", "Action"].map((value) => ({
        text: value,
        fill: { color: theme.primary },
        stroke: { color: theme.line, width: 0.6 },
        font: { family: SANS, size: 8.5, color: "FFFFFF", bold: true },
      })),
      rows: section.bullets.slice(0, 5).map((item, rowIndex) => [
        tableCell(`0${rowIndex + 1}`, theme.surface, theme),
        tableCell(item, theme.card, theme),
        tableCell(rowIndex % 2 === 0 ? "Prioritize" : "Validate", theme.card, theme),
      ]),
    },
    footer(index, slideCount, theme.muted),
  ]);
}

function bulletsSlide(
  section: FallbackSection,
  index: number,
  slideCount: number,
  theme: SmartTheme,
): Slide {
  return slide(section.title, theme.background, [
    ...header(section, theme, "ACTIONS"),
    rect({ x: 0.72, y: 1.62, w: 3.42, h: 3.2, fill: theme.surface, stroke: theme.line, r: 0.12 }),
    svg({
      x: 1.08,
      y: 1.92,
      w: 2.7,
      h: 2.48,
      markup: smartMotifSvg(theme, section.title),
      name: `${section.title} visual`,
    }),
    {
      type: "text-list",
      position: { x: 4.62, y: 1.76 },
      size: { width: 4.2, height: 2.72 },
      marker: "number",
      items: section.bullets.slice(0, 5).map((item) => ({
        type: "text",
        text: item,
      })),
      font: { family: SANS, size: 15, color: theme.text, lineHeight: 1.2 },
    },
    footer(index, slideCount, theme.muted),
  ]);
}

function closingSlide(
  section: FallbackSection,
  index: number,
  slideCount: number,
  theme: SmartTheme,
): Slide {
  return slide(section.title, theme.dark, [
    rect({ x: 0.74, y: 0.72, w: 0.76, h: 0.06, fill: theme.accent, r: 0.02 }),
    text({
      x: 0.72,
      y: 1.14,
      w: 4.8,
      h: 0.94,
      value: section.title,
      size: 32,
      color: "FFFFFF",
      bold: true,
      lineHeight: 1.05,
    }),
    text({
      x: 0.76,
      y: 2.34,
      w: 4.18,
      h: 0.62,
      value: section.summary,
      size: 12,
      color: "CBD5E1",
      lineHeight: 1.22,
    }),
    ...section.bullets.slice(0, 3).flatMap((item, itemIndex) =>
      cardElements(5.76, 1.0 + itemIndex * 1.14, 3.16, 0.86, item, "Next step", itemIndex, {
        ...theme,
        card: "1F2937",
        text: "FFFFFF",
        muted: "CBD5E1",
        line: "374151",
      }),
    ),
    footer(index, slideCount, "CBD5E1"),
  ]);
}

function header(section: FallbackSection, theme: SmartTheme, label: string): SlideElement[] {
  return [
    text({
      x: 0.72,
      y: 0.52,
      w: 1.3,
      h: 0.18,
      value: label,
      size: 7.5,
      color: theme.primary,
      bold: true,
      letterSpacing: 160,
      wrap: "none",
    }),
    text({
      x: 0.72,
      y: 0.84,
      w: 5.4,
      h: 0.58,
      value: section.title,
      size: 24,
      color: theme.text,
      bold: true,
      lineHeight: 1.04,
    }),
    text({
      x: 6.28,
      y: 0.86,
      w: 2.9,
      h: 0.5,
      value: section.summary,
      size: 8.5,
      color: theme.muted,
      lineHeight: 1.18,
    }),
    rect({ x: 0.72, y: 1.42, w: 0.82, h: 0.045, fill: theme.accent, r: 0.02 }),
  ];
}

function cardElements(
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  body: string,
  index: number,
  theme: SmartTheme,
): SlideElement[] {
  return [
    rect({ x, y, w, h, fill: theme.card, stroke: theme.line, r: 0.1 }),
    rect({ x: x + 0.22, y: y + 0.2, w: 0.48, h: 0.045, fill: theme.accents[index % theme.accents.length], r: 0.02 }),
    text({
      x: x + 0.22,
      y: y + 0.42,
      w: w - 0.44,
      h: 0.34,
      value: title,
      size: h > 1 ? 13 : 10,
      color: theme.text,
      bold: true,
      lineHeight: 1.1,
    }),
    text({
      x: x + 0.22,
      y: y + (h > 1 ? 0.82 : 0.62),
      w: w - 0.5,
      h: Math.max(0.16, h - (h > 1 ? 0.94 : 0.7)),
      value: body,
      size: h > 1 ? 7.6 : 6.8,
      color: theme.muted,
      lineHeight: 1.14,
    }),
  ];
}

function footer(index: number, slideCount: number, color: string): SlideElement {
  return text({
    x: 8.56,
    y: 5.18,
    w: 0.76,
    h: 0.18,
    value: `${String(index + 1).padStart(2, "0")}/${String(slideCount).padStart(2, "0")}`,
    size: 7.5,
    color,
    bold: true,
    align: "right",
    wrap: "none",
  });
}

function slide(title: string, background: string, elements: SlideElement[]): Slide {
  return {
    title: truncateText(title, 60),
    background,
    elements,
  };
}

function text({
  x,
  y,
  w,
  h,
  value,
  size,
  color,
  bold,
  lineHeight,
  letterSpacing,
  align,
  wrap = "word",
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  value: string;
  size: number;
  color: string;
  bold?: boolean;
  lineHeight?: number;
  letterSpacing?: number;
  align?: "left" | "center" | "right";
  wrap?: "word" | "char" | "none";
}): TextElement {
  return {
    type: "text",
    position: { x, y },
    size: { width: w, height: h },
    runs: [{ text: truncateText(value || " ", 520) || " " }],
    font: {
      family: SANS,
      size,
      color,
      bold,
      lineHeight,
      letterSpacing,
      wrap,
    },
    alignment: align ? { horizontal: align } : undefined,
  };
}

function rect({
  x,
  y,
  w,
  h,
  fill,
  stroke,
  opacity,
  r,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke?: string;
  opacity?: number;
  r?: number;
}): RectangleElement {
  return {
    type: "rectangle",
    position: { x, y },
    size: { width: w, height: h },
    fill: { color: fill, opacity },
    stroke: stroke ? { color: stroke, width: 0.7 } : undefined,
    borderRadius: r != null ? radius(r) : undefined,
  };
}

function ellipse({
  x,
  y,
  w,
  h,
  fill,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}) {
  return {
    type: "ellipse",
    position: { x, y },
    size: { width: w, height: h },
    fill: { color: fill },
  } satisfies SlideElement;
}

function line({
  x,
  y,
  w,
  h,
  color,
  width,
  dash,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  width: number;
  dash?: number[];
}): LineElement {
  return {
    type: "line",
    position: { x, y },
    size: { width: w, height: h },
    stroke: { color, width, dash },
  };
}

function svg({
  x,
  y,
  w,
  h,
  markup,
  name,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  markup: string;
  name: string;
}): SvgElement {
  return {
    type: "svg",
    position: { x, y },
    size: { width: w, height: h },
    svg: markup,
    name,
  };
}

function tableCell(textValue: string, fill: string, theme: SmartTheme): TableCell {
  return {
    text: truncateText(textValue, 70),
    fill: { color: fill },
    stroke: { color: theme.line, width: 0.6 },
    font: { family: SANS, size: 8.5, color: theme.text },
  };
}

function radius(value: number) {
  return { tl: value, tr: value, bl: value, br: value };
}

function cleanHex(value: string | null | undefined, fallback: string) {
  const clean = String(value ?? "").replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(clean) ? clean : fallback;
}

function readableTextColor(
  color: string,
  background: string,
  theme: Deck["theme"],
) {
  const normalizedColor = cleanHex(color, theme?.text ?? DEFAULT_THEME.text);
  const normalizedBackground = cleanHex(background, DEFAULT_THEME.background);
  if (contrastRatio(normalizedColor, normalizedBackground) >= 4.5) {
    return normalizedColor;
  }

  const candidates = [
    "FFFFFF",
    "F8FAFC",
    theme?.surface,
    theme?.background,
    theme?.text,
    "111827",
    "0F172A",
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates
    .map((candidate) => cleanHex(candidate, normalizedColor))
    .sort(
      (left, right) =>
        contrastRatio(right, normalizedBackground) -
        contrastRatio(left, normalizedBackground),
    )[0] ?? normalizedColor;
}

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: string) {
  const channels = [0, 2, 4].map((offset) => {
    const channel = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function resolveSmartTheme(theme: SmartDeckThemeInput | null | undefined): SmartTheme {
  const primary = cleanHex(theme?.primary, DEFAULT_THEME.primary);
  const secondary = cleanHex(theme?.secondary, DEFAULT_THEME.secondary);
  const accent = cleanHex(theme?.accent, DEFAULT_THEME.accent);
  return {
    background: cleanHex(theme?.background, DEFAULT_THEME.background),
    surface: cleanHex(theme?.surface, DEFAULT_THEME.surface),
    primary,
    secondary,
    accent,
    text: cleanHex(theme?.text, DEFAULT_THEME.text),
    muted: cleanHex(theme?.muted, DEFAULT_THEME.muted),
    line: DEFAULT_THEME.line,
    card: cleanHex(theme?.surface, DEFAULT_THEME.card),
    dark: primary,
    accents: [
      primary,
      secondary,
      accent,
      ...DEFAULT_THEME.accents.filter(
        (color) => ![primary, secondary, accent].includes(color),
      ),
    ],
  };
}

function deckThemeFromSmartTheme(theme: SmartTheme) {
  return {
    background: theme.background,
    surface: theme.surface,
    primary: theme.primary,
    secondary: theme.secondary,
    accent: theme.accent,
    text: theme.text,
    muted: theme.muted,
  };
}

function emptySmartTableCell(): z.infer<typeof SmartTableCellSchema> {
  return {
    text: "-",
    fill: null,
    stroke: null,
    font: null,
  };
}

function emptySmartTextRun(): z.infer<typeof SmartTextRunSchema> {
  return {
    text: "Generated text",
    font: null,
  };
}

function emptySmartTextListItem(): z.infer<typeof SmartTextListItemSchema> {
  return {
    type: "text",
    text: "Key point",
  };
}

function fallbackSmartChartData(): z.infer<typeof SmartChartDatumSchema>[] {
  return [
    { label: "Signal", value: 42, color: null },
    { label: "Momentum", value: 64, color: null },
    { label: "Focus", value: 78, color: null },
  ];
}

function fallbackSmartTableColumns(): z.infer<typeof SmartTableCellSchema>[] {
  return [
    { text: "Area", fill: null, stroke: null, font: null },
    { text: "Detail", fill: null, stroke: null, font: null },
  ];
}

function fallbackSmartTableRows(): z.infer<typeof SmartTableCellSchema>[][] {
  return [
    [
      { text: "Priority", fill: null, stroke: null, font: null },
      { text: "Review", fill: null, stroke: null, font: null },
    ],
  ];
}

function fallbackSvgMarkup(theme: Deck["theme"]) {
  const primary = cleanHex(theme?.primary, DEFAULT_THEME.primary);
  const secondary = cleanHex(theme?.secondary, DEFAULT_THEME.secondary);
  const accent = cleanHex(theme?.accent, DEFAULT_THEME.accent);
  return `<svg viewBox="0 0 640 420" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="420" rx="34" fill="#FFFFFF"/><rect x="58" y="60" width="524" height="300" rx="28" fill="#F8FAFC" stroke="#E2E8F0" stroke-width="4"/><path d="M104 278 C176 220 232 254 292 190 C366 112 438 166 536 96" fill="none" stroke="#${primary}" stroke-width="14" stroke-linecap="round"/><rect x="112" y="232" width="92" height="90" rx="18" fill="#${primary}" opacity="0.9"/><rect x="254" y="188" width="92" height="134" rx="18" fill="#${secondary}" opacity="0.9"/><rect x="396" y="144" width="92" height="178" rx="18" fill="#${accent}" opacity="0.9"/></svg>`;
}

function clampSlideCount(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(20, Math.max(1, Math.trunc(value)));
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function roundInches(value: number) {
  return Math.round(value * 1000) / 1000;
}

function normalizeText(value: string, maxLength: number) {
  return truncateText(value.replace(/\s+/g, " ").trim() || " ", maxLength) || " ";
}

function truncateText(value: string, maxLength: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function createDeckTitle(description: string) {
  const clean = description.replace(/\s+/g, " ").trim();
  const firstSentence = clean.split(/[.!?]/)[0]?.trim() || clean;
  const withoutFiller = firstSentence
    .replace(/^(create|generate|make|build)\s+(a\s+)?(presentation|deck)\s+(about|on|for)\s+/i, "")
    .trim();
  return titleCase(truncateText(withoutFiller || "Smart Generated Deck", 72));
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word.length <= 3 && /^[A-Z0-9]+$/.test(word)
        ? word
        : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`,
    )
    .join(" ");
}

function conciseSummary(description: string, subject: string) {
  const clean = truncateText(description, 150);
  if (clean.length >= 24) return clean;
  return `A concise briefing about ${subject.toLowerCase()} with a decision-ready narrative.`;
}

function subjectSpecificSummary(kind: FallbackKind, subject: string) {
  switch (kind) {
    case "metrics":
      return `The strongest ${subject.toLowerCase()} signals should anchor the decision.`;
    case "chart":
      return `Use the directional evidence to show where ${subject.toLowerCase()} is gaining or losing momentum.`;
    case "timeline":
      return `Sequence the story so the audience sees progress, inflection points, and next moves.`;
    case "table":
      return `Compare the options clearly enough to move from discussion to ownership.`;
    case "bullets":
      return `Convert the narrative into concrete actions the audience can support.`;
    case "cards":
    default:
      return `Frame the ${subject.toLowerCase()} story around the points that matter most.`;
  }
}

function keyPhrases(description: string, subject: string, offset = 0) {
  const words = description
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 24);
  const seeds = words.length > 0 ? words : subject.split(/\s+/).filter(Boolean);
  const defaults = [
    "Audience stakes",
    "Evidence base",
    "Decision window",
    "Operating model",
    "Near-term move",
    "Success measure",
  ];
  return Array.from({ length: 6 }, (_, index) => {
    const first = seeds[(index * 2 + offset) % seeds.length];
    const second = seeds[(index * 2 + offset + 1) % seeds.length];
    if (!first) return defaults[(index + offset) % defaults.length];
    return titleCase(truncateText([first, second].filter(Boolean).join(" "), 32));
  });
}

function smartMotifSvg(theme: SmartTheme, seedText: string) {
  const seed = hashString(seedText);
  const a = theme.accents[seed % theme.accents.length];
  const b = theme.accents[(seed + 2) % theme.accents.length];
  const c = theme.accents[(seed + 4) % theme.accents.length];
  const lift = 24 + (seed % 46);
  return `<svg viewBox="0 0 640 420" xmlns="http://www.w3.org/2000/svg">
<rect width="640" height="420" rx="34" fill="#FFFFFF"/>
<rect x="42" y="44" width="556" height="332" rx="28" fill="#F8FAFC" stroke="#E2E8F0" stroke-width="4"/>
<path d="M92 ${284 - lift} C166 ${226 - lift} 220 ${256 + lift / 2} 286 ${190 - lift / 2} C362 ${112 + lift / 2} 432 ${164 - lift / 3} 536 ${92 + lift / 3}" fill="none" stroke="#${a}" stroke-width="14" stroke-linecap="round"/>
<rect x="102" y="${236 - lift / 2}" width="92" height="${96 + lift / 2}" rx="18" fill="#${a}" opacity="0.9"/>
<rect x="236" y="${190 + lift / 4}" width="92" height="${118 - lift / 4}" rx="18" fill="#${b}" opacity="0.9"/>
<rect x="370" y="${146 - lift / 5}" width="92" height="${146 + lift / 5}" rx="18" fill="#${c}" opacity="0.9"/>
<circle cx="148" cy="${210 - lift / 2}" r="14" fill="#111827"/>
<circle cx="282" cy="${168 + lift / 4}" r="14" fill="#111827"/>
<circle cx="416" cy="${124 - lift / 5}" r="14" fill="#111827"/>
<path d="M96 336 H542" stroke="#CBD5E1" stroke-width="5" stroke-linecap="round" stroke-dasharray="16 18"/>
</svg>`;
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
