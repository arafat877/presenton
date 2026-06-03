# Slide Editor Template Authoring Reference

This document is for developers who want to create new slide-editor templates.
It explains what a template file contains, how elements behave, how templates
are registered, and how to make a template usable for AI slide generation.

## What A Template Is

A slide-editor template is a normal editable `Deck` plus optional generation
metadata.

Templates are registered in:

```txt
servers/nextjs/components/slide-editor/templates/index.ts
```

Each template descriptor looks like this:

```ts
type TemplateDescriptor = {
  id: string;
  label: string;
  description: string;
  deck: Deck;
  componentTemplates?: ReadonlyArray<ComponentTemplate>;
  generationLayouts?: ReadonlyArray<GenerationLayoutMetadata>;
};
```

The important fields are:

- `id`: stable template id used by the editor and generation route.
- `label`: human-facing name shown in dropdowns.
- `description`: short explanation of the template.
- `deck`: the actual editable slides.
- `generationLayouts`: optional metadata that lets AI generation choose and fill
  the right template slides.

Good examples live in:

```txt
servers/nextjs/components/slide-editor/templates/neo-general.ts
servers/nextjs/components/slide-editor/templates/report.ts
```

## Coordinate System

The slide editor uses PowerPoint-style inches.

```ts
SLIDE_W = 10;
SLIDE_H = 5.625;
```

This is a 16:9 widescreen slide. Every element position and size is expressed in
inches:

```ts
position: { x: 0.5, y: 0.4 },
size: { width: 4.2, height: 0.8 }
```

Keep all elements inside the `10 x 5.625` slide unless you intentionally want
bleed or cropped decoration.

## Recommended File Shape

A template file usually follows this pattern:

```ts
import type { Deck, Slide } from "../lib/slide-schema";
import type { GenerationLayoutMetadata } from "../lib/slide-generation-layout-metadata";
import { createTemplateElements } from "./template-elements";

const FONT = "Poppins";
const BG = "FFFFFF";
const INK = "111827";
const PRIMARY = "7C3AED";

const { text, rect, image, chart, slide } = createTemplateElements({
  fontFamily: FONT,
  defaultTextColor: INK,
  defaultBackground: BG,
  defaultLineColor: "E5E7EB",
  defaultChartColor: PRIMARY,
  defaultChartAxisColor: "CBD5E1",
  defaultChartLabelColor: "64748B",
});

const slides: Slide[] = [
  slide("Cover", [
    text({
      x: 0.7,
      y: 0.8,
      w: 5.8,
      h: 0.8,
      value: "Template Cover",
      size: 42,
      bold: true,
    }),
  ]),
];

export const myTemplateGenerationLayouts = [
  {
    layoutId: "my-template-cover",
    slideIndex: 0,
    layoutName: "Cover",
    layoutDescription: "Opening slide with a large title and subtitle.",
    semanticKind: "cover",
    schemaFields: ["title", "body[0]=subtitle"],
    bindings: [
      { target: "text", index: 0, source: "title" },
      { target: "text", index: 1, source: "body[0]" },
    ],
  },
] satisfies GenerationLayoutMetadata[];

export const myTemplateDeck: Deck = {
  title: "My Template",
  description: "Editable slide-editor template.",
  theme: {
    background: BG,
    primary: PRIMARY,
    secondary: "06B6D4",
    accent: "F59E0B",
    text: INK,
    surface: "F8FAFC",
    muted: "64748B",
  },
  slides,
};
```

Then register it in `templates/index.ts`.

## Template Helper Functions

Use `createTemplateElements` instead of hand-writing every element object. It
keeps template files compact and consistent.

Common helpers:

- `slide(title, elements, background?)`: creates a slide.
- `text({ x, y, w, h, value, size, ... })`: creates editable text.
- `rect(...)`, `ellipse(...)`, `line(...)`: create vector shapes.
- `image({ x, y, w, h, src, fit, r })`: creates an editable image slot.
- `svg({ x, y, w, h, markup, name })`: embeds inline SVG.
- `chart({ x, y, w, h, title, type, data })`: creates a chart element.
- `table({ x, y, w, h, columns, rows })`: creates a table element.

For repeated visual motifs, write local helper functions such as `titleBlock`,
`metricCard`, or `timelineItem`. This keeps the slides readable.

## Element Behaviors

### Text

Text is editable and rendered in editor, presentation mode, PDF, and PPTX.

Important fields:

- `font.family`: font family.
- `font.size`: point size.
- `font.bold` / `font.italic`: style flags.
- `font.lineHeight`: line-height multiplier.
- `font.wrap`: `"word"`, `"char"`, or `"none"`.
- `alignment.horizontal`: `"left"`, `"center"`, or `"right"`.
- `alignment.vertical`: `"top"`, `"middle"`, or `"bottom"`.

Use `wrap: "none"` for labels, short metric values, years, step numbers, and
single-line cover title pieces. Use normal word wrapping for paragraphs and
body copy.

Text fitting tries to preserve full text by shrinking and wrapping. Still, a
tiny box with a long paragraph will produce unreadably small text, so template
authors should size text boxes for the kind of content they expect.

### Images

Image elements support:

- `fit: "cover"`: fill the box and crop overflow.
- `fit: "contain"`: show the full image, leaving empty space if ratios differ.
- `fit: "fill"`: stretch to the box.
- `borderRadius`: rounded or asymmetric clipping.

Use `cover` for visual cards and feature imagery. Use `contain` for logos,
icons, and product screenshots where cropping would be harmful.

PPTX export pre-renders image elements so crop and rounded corners match the
editor.

### Shapes

Use rectangles, ellipses, and lines for visual structure. Rectangles support
fills, strokes, shadows, and rounded corners. Border radius values are in
inches and capped by the schema.

Prefer real shape elements over SVG when the shape needs to be editable.

### SVG

SVG is useful for custom icons, decorative marks, and small illustrations. SVG
content is sanitized during export. Keep SVGs small and self-contained.

Use SVG when the design is template-owned. Use image elements when the content
should be replaceable.

### Charts

Chart elements contain structured data:

```ts
{
  type: "chart",
  chartType: "bar" | "line" | "donut",
  title: "Quarterly Usage",
  data: [
    { label: "Q1", value: 21 },
    { label: "Q2", value: 32 },
  ],
}
```

Chart labels are capped by schema, so use short labels. Generation can fill
chart data when the layout metadata exposes chart fields.

### Tables

Tables are structured, editable elements. Use tables for comparison matrices,
plans, scorecards, and report summaries. Keep row and column counts modest.

### Layout Elements

The editor supports absolute elements and flow layout elements:

- `container`: one child, optional padding/alignment/background.
- `flex`: row or column layout for children.
- `grid`: grid layout for children.
- `group`: groups children while preserving local positions.
- `list-view` / `grid-view`: repeat one item shape multiple times.

Use layout elements when content count can vary or when you want cards to wrap
and align predictably. Use absolute positioning for precise editorial layouts.

## AI Generation Metadata

If a template should work with the `Generate` button, include
`generationLayouts`.

Each metadata item describes one slide in the template deck:

```ts
type GenerationLayoutMetadata = {
  layoutId: string;
  slideIndex: number;
  layoutName: string;
  layoutDescription: string;
  semanticKind: GenerationLayoutKind;
  schemaFields: string[];
  bindings?: GenerationBinding[];
};
```

`slideIndex` is the real slide index inside the template deck. This is what
makes the metadata self-contained and lets the generator clone the correct
template slide.

`semanticKind` tells the model when to use the layout:

- `cover`
- `general`
- `bullets`
- `cards`
- `metrics`
- `chart`
- `table`
- `timeline`
- `quote`
- `team`
- `visual`
- `closing`

`layoutDescription` should describe when the layout is useful, not just what it
looks like. Local models rely heavily on this text.

Good:

```txt
A KPI findings layout with a narrative paragraph and two tall metric panels for
quantitative takeaways.
```

Weak:

```txt
A slide with text and boxes.
```

## Bindings

Bindings tell the generator which generated content should go into which
fillable text slot.

```ts
bindings: [
  { target: "text", index: 0, source: "title" },
  { target: "text", index: 1, source: "summary" },
  { target: "text", index: 2, source: "metrics[0].value" },
  { target: "text", index: 3, source: "metrics[0].label" },
]
```

The `index` is the index among fillable text elements on the cloned template
slide. Structural text, like tiny decorative numbers or fixed labels, is
skipped by the binding engine.

Supported source examples:

- `title`
- `deckTitle`
- `summary`
- `sectionTitle`
- `body[0]`
- `bullets[0]`
- `cards[0].title`
- `cards[0].body`
- `cards[0].role`
- `metrics[0].value`
- `metrics[0].label`
- `metrics[0].description`
- `timeline[0].marker`
- `timeline[0].title`
- `timeline[0].description`
- `chart.title`
- `chart.data[0].label`
- `chart.data[0].value`
- `coverTitle[0]`
- `literal:Fixed Label`

Bindings should fill only the content the layout truly needs. Do not bind every
possible field just because it exists.

## Template Design Rules

Use these rules when creating new templates:

- Keep each slide's purpose obvious.
- Give every generation-ready layout a stable `layoutId`.
- Keep `slideIndex` correct after reordering slides.
- Use real content-like placeholder text, not lorem ipsum, in visible slots.
- Leave enough room for generated text to wrap or shrink.
- Use `wrap: "none"` only where wrapping would break the layout.
- Use `cover` image fit for editorial images and `contain` for logos/screens.
- Keep chart labels short.
- Prefer reusable helper functions for cards, metrics, and timeline items.
- Avoid template-specific logic in `ai-slide-generation.ts`; put template
  semantics in `generationLayouts` and `bindings`.

## Adding A New Template

1. Create a file in `servers/nextjs/components/slide-editor/templates/`.
2. Build a `Deck` using `createTemplateElements`.
3. Add `generationLayouts` if the template should support AI generation.
4. Export the deck and metadata.
5. Register the template in `templates/index.ts`.
6. Open the editor and test normal editing.
7. Test `Generate` with both short and long prompts.
8. Test present mode, PDF export, and PPTX export.

## Common Problems

### Generated Text Does Not Fit

The renderer will shrink and wrap text, but the template should still provide
reasonable space. Increase the text box size, reduce initial font size, or split
the content across multiple slots.

### Cover Titles Overlap

Use multiple title slots and bind them with `coverTitle[0]`,
`coverTitle[1]`, etc. Keep title slots `wrap: "none"` when they are designed as
separate fixed lines.

### Metrics Repeat

This usually means the layout asks for more metric slots than the generated
content provides. Prefer layouts with a realistic number of metric slots, or
ensure chart data can provide additional unique values.

### Placeholder Text Leaks

Add bindings for the visible slots, or make the placeholder text meaningful
enough to survive fallback generation.

### PPTX Looks Different From Editor

Most basic elements export natively. Some visuals, like rounded clipped images,
are pre-rendered to preserve editor appearance. If a complex composition does
not export well, simplify it into native shapes or test the PPTX path early.

## Mental Model

A template owns the visual system. The model owns only the content plan.

The best templates are specific enough to feel designed, but generic enough that
many topics can flow into them. Use metadata and bindings to describe the
template's intent, then let the generation pipeline fill only the necessary
slots.
