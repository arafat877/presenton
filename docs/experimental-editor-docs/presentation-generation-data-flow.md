# Presentation Generation Data Flow

This document explains how the slide editor turns a user prompt and a selected
template into a generated, editable presentation deck.

The important boundary is this: the model does not draw slides. The model
chooses template layout IDs and writes content fields. The application owns
template selection, layout mapping, geometry, styling, validation, fallback
content, and the final editable `Deck`.

## High-Level Flow

```mermaid
flowchart TD
  A[User opens Generate modal] --> B[User enters description, slide count, model, template]
  B --> C[SlideEditor posts SlideGenerationInput]
  C --> D[/api/slide-editor/generate]
  D --> E[Validate request with Zod]
  E --> F[Resolve selected template from TEMPLATES]
  F --> G[Resolve generationLayouts]
  G --> H[Build deterministic fallback plan]
  H --> I{Can selected model run?}
  I -->|No| J[Use fallback plan with warning]
  I -->|Yes| K[Ask model for structured content-only plan]
  K --> L[Validate model output with schema]
  L --> M[Map model layoutId to template slideIndex]
  M --> N[Build editable Deck from template and plan]
  J --> N
  N --> O[Validate final DeckSchema]
  O --> P[Return deck, template id, source, warnings]
  P --> Q[SlideEditor resets editor state]
  Q --> R[User edits, presents, exports]
```

## Main Files

- `components/slide-editor/generation/GenerateSlidesModal.tsx`
  collects the user-facing generation form.
- `components/slide-editor/SlideEditor.tsx`
  sends the request and swaps the generated deck into editor state.
- `app/api/slide-editor/generate/route.ts`
  validates input, calls the selected model, resolves layout metadata, handles
  fallback, and returns the generated deck.
- `components/slide-editor/templates/index.ts`
  registers available templates and their optional generation metadata.
- `components/slide-editor/templates/neo-general.ts`
  defines the Neo General template and its generation layouts.
- `components/slide-editor/templates/report.ts`
  defines the Report template and its generation layouts.
- `components/slide-editor/lib/slide-generation-layout-metadata.ts`
  defines the model-facing metadata type.
- `components/slide-editor/lib/ai-slide-generation.ts`
  converts a normalized generation plan into a validated editable `Deck`.

## User Input

The modal sends this client-side shape:

```ts
type SlideGenerationInput = {
  description: string;
  slideCount: number;
  templateId: string;
  modelProvider: "openai" | "ollama";
  model: string;
};
```

The user controls:

- `description`: prompt or brief, 8 to 4000 characters.
- `slideCount`: requested number of slides, 1 to 20.
- `templateId`: selected visual/generation template.
- `modelProvider`: `openai` or `ollama`.
- `model`: concrete model id, currently `gpt-4.1-mini` or `gemma4`.

`SlideEditor.tsx` posts this object to:

```txt
POST /api/slide-editor/generate
```

## Request Validation

The route validates the request with a strict Zod schema:

```ts
{
  description: z.string().min(8).max(4000),
  slideCount: z.number().int().min(1).max(20),
  templateId: z.string().min(1).max(80),
  modelProvider: z.enum(["openai", "ollama"]).optional(),
  model: z.string().min(1).max(160).optional(),
}
```

Unknown fields are rejected. This keeps the generation pipeline predictable and
protects the later structured-output schema from unexpected request shapes.

## Template Resolution

The route resolves the selected template from `TEMPLATES`:

```ts
const template = TEMPLATES.find((item) => item.id === templateId);
```

Each template descriptor can provide:

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

The key field for generation is `generationLayouts`. It connects model-facing
layout IDs to actual slides inside the template deck.

## Template Generation Metadata

Generation-ready templates should keep metadata beside the template itself.
Neo General and Report both follow this pattern.

```ts
type GenerationLayoutMetadata = {
  layoutId: string;
  slideIndex: number;
  layoutName: string;
  layoutDescription: string;
  semanticKind:
    | "cover"
    | "general"
    | "bullets"
    | "cards"
    | "metrics"
    | "chart"
    | "table"
    | "timeline"
    | "quote"
    | "team"
    | "visual"
    | "closing";
  schemaFields: string[];
  bindings?: GenerationBinding[];
};
```

Example:

```ts
{
  layoutId: "report-dashboard-grid",
  slideIndex: 12,
  layoutName: "Dashboard Grid",
  layoutDescription:
    "A compact report dashboard with top KPI strip and six small chart cards.",
  semanticKind: "chart",
  schemaFields: ["title", "metrics[]=value,label", "chart"],
}
```

The model sees `layoutId`, `layoutDescription`, `semanticKind`, and
`schemaFields`. It does not need to know coordinates, styles, or editor element
structure. The server later maps the chosen `layoutId` back to `slideIndex`.

`bindings` are optional template-owned slot mappings. They tell the generic
builder exactly where generated content should go inside the cloned template
slide:

```ts
{
  target: "text",
  index: 3,
  source: "metrics[0].label"
}
```

The `index` points to the fillable text slot order after structural labels such
as decorative numbers are skipped. The `source` points into the generated
content plan. This keeps template-specific slot knowledge in the template
metadata instead of hardcoding template IDs in the builder.

If a template does not define explicit metadata, the route derives fallback
metadata by scanning the template deck with `createLayoutCatalog(template.deck)`.
That fallback keeps every template usable, but explicit metadata is better for
small local models because it is shorter and more semantic.

## Fallback Plan

Before calling any model, the route builds a deterministic fallback plan:

```ts
const fallback = syncPlanLayoutIdsToMetadata(
  fallbackGeneratedPlan(template.deck, description, slideCount),
  generationLayouts,
);
```

The fallback is important because:

- generation still works when OpenAI is not configured;
- generation still works when Ollama returns malformed output;
- missing model slides or fields can be normalized against known safe content;
- fallback layout choices are aligned to the selected template metadata.

The fallback plan has the internal `GeneratedDeckPlan` shape. It already uses
`layoutIndex` values that point to template slides.

## Model Selection

The route resolves the model provider from the request:

1. Use `modelProvider` if supplied.
2. If no provider was supplied and the model name contains `gemma`, use
   `ollama`.
3. Otherwise use `openai`.

OpenAI model resolution:

1. request body `model`
2. `SLIDE_EDITOR_OPENAI_MODEL`
3. `OPENAI_MODEL`
4. `gpt-4.1-mini`

Ollama model resolution:

1. request body `model`
2. `SLIDE_EDITOR_OLLAMA_MODEL`
3. `OLLAMA_MODEL`
4. `gemma4`

Ollama base URL resolution:

1. `SLIDE_EDITOR_OLLAMA_BASE_URL`
2. `OLLAMA_BASE_URL`
3. `http://localhost:11434`

The Ollama provider is configured for structured outputs, repair attempts, low
temperature, and an 8192 token context window. The goal is to let local models
do the narrow job of returning valid content JSON instead of asking them to draw
slides.

## Model Output Contract

The model returns a `ModelDeckPlan`. This is not a slide-editor `Deck`.

```ts
type ModelDeckPlan = {
  title: string;
  outline: string[];
  slides: Array<{
    layoutId: string;
    kind:
      | "cover"
      | "general"
      | "bullets"
      | "cards"
      | "metrics"
      | "chart"
      | "table"
      | "timeline"
      | "closing";
    title: string;
    body: string[];
    bullets: string[];
    metrics: Array<{
      value: string;
      label: string;
      description: string;
    }>;
    chart: {
      title: string;
      type: "bar" | "line" | "donut";
      data: Array<{ label: string; value: number }>;
    } | null;
    table: {
      columns: string[];
      rows: string[][];
    } | null;
    imagePrompt: string;
  }>;
};
```

Important constraints:

- The model must return exactly `slideCount` slides.
- Each `layoutId` must come from the provided `generationLayouts`.
- The model must not output `slideIndex`, `layoutIndex`, coordinates, colors,
  or fonts.
- `chart` and `table` are nullable, not optional. This satisfies strict
  structured-output schemas while still allowing "no chart" and "no table".
- Body copy, bullets, metrics, chart data, table rows, and image prompts must be
  about the user's topic, not about the template structure.

## Prompt Data

The user prompt sent to the model is JSON. It contains:

- `task`: create an editable slide deck plan.
- `template`: selected template label.
- `slideCount`: requested slide count.
- `userDescription`: original user brief.
- `generationLayoutMetadata`: the model-facing layout catalog.
- `generationPattern`: outline, layout selection, then schema-shaped content.
- `selectionGuidance`: rules for cover, closing, charts, tables, metrics,
  images, and avoiding filler text.

This prompt keeps the model job small:

1. understand the user's brief;
2. choose one `layoutId` per slide;
3. fill content fields that match the selected layout.

## Layout ID Resolution

The model returns `layoutId`. The application needs `layoutIndex`.

The route resolves this with:

```ts
const layoutById = new Map(
  generationLayouts.map((layout) => [layout.layoutId, layout]),
);
```

For each model slide:

1. Find the metadata entry by `layoutId`.
2. Read its `slideIndex`.
3. Store that value as `layoutIndex`.
4. Preserve `layoutId` as `inspiredLayoutId`.
5. Convert `chart: null` and `table: null` to `undefined`.

If a model returns a layout ID that cannot be found, the route chooses a
compatible layout from metadata based on `kind`. For example, a `metrics` slide
prefers a `metrics` layout, then a `chart` layout, then a `cards` layout.

## Deck Building

The route calls:

```ts
buildAdaptiveGeneratedDeck({
  template: template.deck,
  plan,
  description,
  slideCount,
  generationLayouts,
});
```

The builder performs these transformations:

1. Build its own deterministic fallback plan.
2. Normalize the selected plan against that fallback.
3. Force slide 1 to `kind=cover` when there is more than one slide.
4. Force the final slide to `kind=closing` when there are more than two slides.
5. Use generation metadata to keep cover and closing slide selections semantic.
6. Clone the selected native template slide when possible.
7. Apply template-owned generation bindings when the selected layout defines
   them.
8. Otherwise use generic text/list/chart/table/image fill heuristics.
9. If native filling cannot produce a slide, use the adaptive renderer.
10. Validate the final deck with `DeckSchema.parse`.

The output is a normal editable slide-editor `Deck`:

```ts
type Deck = {
  title: string;
  description?: string | null;
  theme?: DeckTheme | null;
  slides: Slide[];
};
```

Because the output is a real deck, all editor features continue to work:
selection, editing, moving elements, theming, presenting, PDF export, and PPTX
export.

## Native Template Fill

For generation-ready templates, the preferred path is native fill:

```txt
selected layoutId
  -> metadata.slideIndex
  -> clone template.slides[slideIndex]
  -> collect text/list/chart/table/image refs
  -> apply metadata.bindings when present
  -> write generated content into existing slots
  -> return editable slide
```

This preserves the template's visual identity because geometry, decoration,
colors, shadows, fonts, images, and structural elements come from the template.

The builder skips structural template text where possible, then fills the
remaining text slots with a sequence derived from:

- slide title;
- body text;
- bullet/card text;
- metric values and labels;
- chart/table context;
- team, quote, timeline, and closing-specific values.

Text is fitted before assignment so generated copy does not immediately
truncate or overflow in common layouts.

## Adaptive Fallback

If native filling returns `null`, the builder falls back to adaptive editable
slides.

The adaptive renderer uses:

- the selected layout's inferred purpose;
- the template theme;
- generated content fields;
- deterministic cleanup and fallback values.

This is a safety net for weak local models or templates that do not yet have
precise native fill behavior. It keeps output editable and schema-valid even
when the model response is imperfect.

## Response To The Client

The route returns:

```ts
{
  deck: Deck;
  templateId: string;
  templateLabel: string;
  source: "ai" | "fallback";
  modelProvider: "openai" | "ollama" | null;
  model: string | null;
  warnings: string[];
}
```

`source` tells the client whether model generation succeeded. `warnings`
describe non-fatal failures, such as missing OpenAI keys or malformed local
model output.

## Editor State Update

`SlideEditor.tsx` receives the response and calls:

```ts
resetEditorState(payload.templateId, payload.deck);
```

This updates:

- selected template id;
- active deck atom;
- active slide index;
- selected element state;
- open editor panels;
- presentation mode state.

The generated presentation is now indistinguishable from any other editable
deck in the editor.

## Error And Fallback Paths

The generation flow has several guardrails:

- Invalid JSON request: return `400`.
- Invalid request shape: return `400`.
- Unknown template id: return `404`.
- OpenAI selected without `OPENAI_API_KEY`: use fallback and return warning.
- Model generation failure: use fallback and return warning.
- Model schema validation failure: use fallback and return warning.
- Final deck validation failure: return `500`.

Most model failures do not block the user. The route falls back to deterministic
content unless the final deck itself cannot be built or validated.

## Why This Works For Local Models

Local models are asked for structured content, not slide geometry. That matters.

The local model does not need to:

- calculate coordinates;
- design a grid;
- pick colors;
- infer font sizes;
- create editor elements;
- validate the deck schema.

It only needs to:

- choose a layout ID from a short list;
- write concise title/body/bullet/metric/chart/table content;
- use `null` for charts and tables when not needed.

Everything else is deterministic application code.

## Where To Change Behavior

Use these files for common changes:

- Add or tune template layout choices:
  `components/slide-editor/templates/<template>.ts`
- Register template metadata:
  `components/slide-editor/templates/index.ts`
- Change model request shape or provider behavior:
  `app/api/slide-editor/generate/route.ts`
- Change prompt guidance:
  `app/api/slide-editor/generate/route.ts`
- Change layout ID to slide index resolution:
  `app/api/slide-editor/generate/route.ts`
- Change native template filling:
  `components/slide-editor/lib/ai-slide-generation.ts`
- Change adaptive fallback rendering:
  `components/slide-editor/lib/ai-slide-generation.ts`
- Change the generate form:
  `components/slide-editor/generation/GenerateSlidesModal.tsx`

## Mental Model

Think of the system as five layers:

1. User intent: what the deck should be about.
2. Template metadata: which slide structures are available.
3. Model plan: which structures to use and what content goes into them.
4. Builder: converts the plan into editable slide elements.
5. Editor state: renders and manages the final deck.

The model provides intent-shaped content. The template and builder provide the
presentation.
