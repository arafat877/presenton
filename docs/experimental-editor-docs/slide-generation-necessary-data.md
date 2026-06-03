# Slide Generation With Only Necessary Data

This document explains how template-based slide generation avoids asking the
model to generate a full slide. The model produces only the data needed to fill
the selected template layouts. The application keeps ownership of layout,
styling, geometry, validation, and the final editable slide structure.

## Core Principle

The model does not generate a slide-editor `Deck`.

The model generates a smaller content plan:

```ts
{
  layoutId: string;
  kind: "cover" | "general" | "bullets" | "cards" | "metrics" | "chart" | "table" | "timeline" | "closing";
  title: string;
  body: string[];
  bullets: string[];
  metrics: Array<{ value: string; label: string; description: string }>;
  chart: ChartData | null;
  table: TableData | null;
  imagePrompt: string;
}
```

The template and builder turn that plan into a real editable slide.

```txt
model output: content-only plan
template: layout, slots, style, geometry
builder: maps content into template slots
result: editable Deck
```

This is the reason weaker local models can participate. They do not need to
understand the full slide schema, editor element tree, positioning system, or
visual design language.

## What Counts As Necessary Data

Necessary data is the smallest set of subject-specific content needed to fill a
selected layout.

For a chart slide, necessary data may be:

- title;
- chart title;
- chart type;
- chart labels and values;
- one short takeaway.

For a team slide, necessary data may be:

- title;
- team context;
- names;
- roles;
- short bios.

For a cover slide, necessary data may be:

- deck title;
- promise or summary;
- optional author, owner, audience, or date.

The model should not produce:

- `x`, `y`, `w`, `h`;
- font family or font size;
- colors;
- shadows;
- border radius;
- SVG markup;
- layout containers;
- chart element dimensions;
- image element dimensions;
- final `SlideElement[]`;
- final `Deck`.

Those are template and application responsibilities.

## The Template Defines What Is Useful

Generation-ready templates export metadata beside the template deck.

For example, a Report dashboard layout can say:

```ts
{
  layoutId: "report-dashboard-grid",
  slideIndex: 12,
  layoutName: "Dashboard Grid",
  layoutDescription:
    "A compact report dashboard with top KPI strip and six small chart cards.",
  semanticKind: "chart",
  schemaFields: ["title", "metrics[]=value,label", "chart"],
  bindings: [
    { target: "text", index: 0, source: "title" },
    { target: "text", index: 1, source: "metrics[0].value" },
    { target: "text", index: 2, source: "metrics[0].label" }
  ]
}
```

This metadata is the bridge between the model and the template:

- `layoutId` is what the model chooses.
- `slideIndex` is what the server uses to clone the actual template slide.
- `semanticKind` helps the model and fallback logic choose compatible layouts.
- `schemaFields` tells the model what data matters for that layout.
- `bindings` tells the builder which generated field fills each template slot.

The model only needs the model-facing subset, such as layout IDs, descriptions,
semantic kind, and schema fields. Bindings stay useful even when they are not
shown to the model because they are consumed later by the deterministic builder.
Either way, the model does not need the full template slide JSON.

## The Model Gets Metadata, Not Geometry

The prompt sent to the model includes:

- user description;
- requested slide count;
- selected template label;
- generation layout metadata;
- guidance for choosing layout IDs and filling content fields.

It does not include the full editable template slide tree. This matters because
full slide JSON would add a lot of noise:

- dozens of coordinates;
- decorative shapes;
- placeholder text;
- image URLs;
- chart defaults;
- nested layout containers;
- visual details the model should not edit.

Instead, the model receives a compact menu of layout choices.

```txt
Choose one of these layoutIds:
- report-cover
- report-title-description-image
- report-dashboard-grid
- ...
```

Then it fills content for the selected layout.

## Why The Output Schema Has The Same Fields For Every Slide

In an ideal world, each layout would have a completely different output schema.
A dashboard slide would only ask for metrics and charts. A team slide would only
ask for team members. A cover slide would only ask for title and summary.

In practice, the route uses one consistent slide schema:

```ts
{
  layoutId,
  kind,
  title,
  body,
  bullets,
  metrics,
  chart,
  table,
  imagePrompt
}
```

This is intentional.

Strict structured output works better when every slide has the same predictable
shape. It also helps local Ollama models because they can return simple literal
JSON repeatedly instead of switching schemas slide by slide.

The important part is that unused fields are cheap and explicit:

- `bullets: []` means this slide has no useful bullets.
- `metrics: []` means this slide has no useful metrics.
- `chart: null` means this slide does not need a chart.
- `table: null` means this slide does not need a table.
- `imagePrompt: ""` is allowed when an image is not important.

So the schema is broad, but the data inside it stays minimal.

## Example: Dashboard Slide

User request:

```txt
Generate a 6-slide quarterly product performance report.
```

Template metadata tells the model that `report-dashboard-grid` wants:

```ts
schemaFields: ["title", "metrics[]=value,label", "chart"]
```

A good model output is:

```json
{
  "layoutId": "report-dashboard-grid",
  "kind": "chart",
  "title": "Quarterly Product Performance",
  "body": ["Usage grew as activation and retention improved across core accounts."],
  "bullets": [],
  "metrics": [
    { "value": "42%", "label": "Activation lift", "description": "" },
    { "value": "18%", "label": "Retention gain", "description": "" },
    { "value": "31K", "label": "Weekly active users", "description": "" }
  ],
  "chart": {
    "title": "Quarterly usage trend",
    "type": "line",
    "data": [
      { "label": "Q1", "value": 21 },
      { "label": "Q2", "value": 27 },
      { "label": "Q3", "value": 34 },
      { "label": "Q4", "value": 42 }
    ]
  },
  "table": null,
  "imagePrompt": ""
}
```

Notice what is absent:

- no card coordinates;
- no chart dimensions;
- no color choices;
- no font choices;
- no grid definition;
- no final slide element structure.

The selected template slide already owns those details.

## Example: Cover Slide

Template metadata:

```ts
{
  layoutId: "report-cover",
  slideIndex: 0,
  semanticKind: "cover",
  schemaFields: ["title", "body[0]=author or owner", "body[1]=subtitle"]
}
```

Good model output:

```json
{
  "layoutId": "report-cover",
  "kind": "cover",
  "title": "Quarterly Product Performance",
  "body": [
    "Product Strategy Team",
    "Activation, retention, and growth signals for leadership review"
  ],
  "bullets": [],
  "metrics": [],
  "chart": null,
  "table": null,
  "imagePrompt": ""
}
```

The model does not need to know that the Report cover has decorative vertical
bars or centered typography. The builder clones the cover slide and fills the
available text slots.

## Server-Side Conversion

The API route converts model-facing layout IDs into internal template indexes.

```txt
model layoutId
  -> generationLayouts lookup
  -> metadata.slideIndex
  -> GeneratedSlideContent.layoutIndex
```

For example:

```txt
"report-dashboard-grid"
  -> slideIndex: 12
  -> clone template.slides[12]
```

The model never has to output `slideIndex` or `layoutIndex`. That prevents a
local model from guessing internal indexes incorrectly.

## Native Template Fill

After layout resolution, the builder tries to reuse the selected native template
slide:

```txt
clone template slide
collect fillable refs
apply template-owned bindings when present
fill unbound text slots heuristically when bindings are absent
fill list slots
fill chart slots
fill table slots
update image names/prompts
validate final slide
```

This path keeps generated slides coherent with the selected template because the
visual identity comes from the template, not the model.

The cloned template slide already contains:

- all positions;
- all sizes;
- typography;
- colors;
- decorative shapes;
- image frames;
- chart containers;
- table styling;
- layout containers.

The generated plan only supplies subject-specific content.

## Binding Sources

Bindings are how a template says, "this exact slot should receive this exact
piece of generated data." This keeps template-specific knowledge out of
`ai-slide-generation.ts`.

Common binding sources include:

- `title`
- `summary`
- `body[0]`
- `bullets[0]`
- `cards[0].title`
- `cards[0].body`
- `cards[0].role`
- `metrics[0].value`
- `metrics[0].label`
- `metrics[0].description`
- `timeline[0].title`
- `timeline[0].description`
- `chart.title`
- `imagePrompt`
- `literal:Some fixed text`

For example:

```ts
bindings: [
  { target: "text", index: 0, source: "title" },
  { target: "text", index: 1, source: "summary" },
  { target: "text", index: 2, source: "cards[0].title" },
  { target: "text", index: 3, source: "cards[0].body" }
]
```

The template owns this mapping. The builder only knows how to resolve source
paths and write the result into the requested target slot.

## What Happens To Extra Or Empty Data

Because every slide uses the same broad schema, some fields will be irrelevant
for a selected layout.

The builder handles that safely:

- Empty arrays are ignored.
- `chart: null` means no model chart was requested.
- `table: null` means no model table was requested.
- If a selected template slide contains a chart but the model did not provide
  chart data, the builder can synthesize a safe chart from metrics or fallback
  content.
- If a selected template slide has no table, table data is ignored.
- If a selected template slide has no image, `imagePrompt` is only descriptive
  metadata and does not create a new image element.

This keeps the model output simple without making every field visually active.

## Fallback Plan Uses The Same Idea

The deterministic fallback plan also generates content-only data.

It uses:

- the selected template deck;
- inferred layout catalog;
- requested slide count;
- user description;
- position-based slide kinds such as cover, context, metrics, roadmap, and
  closing.

Then `syncPlanLayoutIdsToMetadata` aligns fallback layout choices with explicit
template metadata when available.

That means fallback output follows the same minimal-data contract as AI output.

## Why Not Ask The Model For Full Slide JSON

Asking the model for full slide JSON would be brittle:

- local models are more likely to break nested schemas;
- coordinates are easy to hallucinate;
- visual output becomes inconsistent with the selected template;
- generated decks can become invalid;
- small copy changes could accidentally change layout;
- every template would require much larger prompts;
- validation errors would be harder to repair.

The current design avoids that by separating responsibilities:

```txt
model: content and layout intent
metadata: available layout meanings
template: visual structure
builder: deterministic conversion and validation
```

## Necessary Data By Slide Type

| Slide type | Necessary data | Usually unnecessary |
| --- | --- | --- |
| Cover | title, promise, author/subtitle | bullets, chart, table |
| Bullets | title, concrete bullet items | chart, table, metrics |
| Cards | title, card title/body pairs | chart, table |
| Metrics | title, KPI values, labels, descriptions | table, long body copy |
| Chart | title, chart title, chart labels/values, takeaway | image details, table |
| Table | title, column names, row values, summary | chart, image details |
| Timeline | title, step/milestone labels and descriptions | chart unless data-driven |
| Team | title, names, roles, bios | chart, table |
| Closing | closing title, next step, contact/context | chart, table |

This table is a design guide. The actual model schema remains shared, but the
prompt and metadata tell the model which fields matter.

## Practical Rule For New Templates

When adding a generation-ready template, do not describe every shape on the
slide. Describe what content the slide needs.

Good:

```ts
{
  layoutId: "customer-metric-summary",
  semanticKind: "metrics",
  layoutDescription:
    "A KPI summary slide with three large metric cards and a short insight.",
  schemaFields: ["title", "body[0]=insight", "metrics[]=value,label,description"],
  bindings: [
    { target: "text", index: 0, source: "title" },
    { target: "text", index: 1, source: "body[0]" },
    { target: "text", index: 2, source: "metrics[0].value" },
    { target: "text", index: 3, source: "metrics[0].label" }
  ]
}
```

Weak:

```ts
{
  layoutId: "slide-4",
  semanticKind: "general",
  layoutDescription:
    "A slide with rectangles, circles, text boxes, and blue accents.",
  schemaFields: ["everything"]
}
```

The first version helps the model generate only useful data. The second version
pushes visual reasoning back onto the model, which is exactly what this system
is designed to avoid.

## Mental Model

The selected template already knows how a slide should look.

The model only answers:

1. Which template layout should this slide use?
2. What subject-specific text or data should fill it?

Everything else is deterministic application code.
