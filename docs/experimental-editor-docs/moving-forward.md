# Moving Forward: Template V2 Editor Support

This document captures the current compatibility between the FastAPI template v2
element models and the Next.js slide editor, plus the main improvements needed
to make layout rendering predictable.

## Relevant Files

- `servers/fastapi/templates/v2/models/elements.py`
- `servers/nextjs/components/slide-editor/lib/slide-schema.ts`
- `servers/nextjs/components/slide-editor/lib/template-v2-import.ts`
- `servers/nextjs/components/slide-editor/lib/layout-resolver.ts`

## Current Compatibility

The editor can render most backend template v2 elements through
`template-v2-import.ts`. The backend response is not directly rendered as the
editor schema; it is adapted into the editor's normalized `DeckSchema`.

Supported backend element types:

- `text`
- `container`
- `image`
- `text-list`
- `table`
- `rectangle`
- `ellipse`
- `line`
- `chart`
- `flex`
- `grid`
- `group`

The editor also supports some element types that are not currently present in
the FastAPI v2 model:

- `svg`
- `list-view`
- `grid-view`

These extra types are fine as editor-only capabilities, but they should either
be added to the backend model later or clearly treated as unsupported by the
template v2 backend contract.

## Important Semantics

### `layouts` vs `raw_layouts`

The editor should render `layouts` first. `raw_layouts` may be useful for
debugging or fallback, but it is not the primary render contract.

### Source Units

Backend template v2 geometry is treated as a `1280 x 720` pixel coordinate
space. The editor normalizes that into PowerPoint inches:

- width: `10in`
- height: `5.625in`

### `fixed`

`fixed` is dynamic/static content metadata. It does not mean "fixed layout" and
should not decide whether a child participates in flex or grid flow.

## Main Gaps

### Rich Text Runs Are Lossy

The backend `Text` model supports `runs`, where each run can have its own font.
The editor imports these runs, but current rendering and export paths mostly
flatten them into plain text:

- DOM preview joins runs through `textContent(element)`.
- Konva preview renders a single text node with one effective font.
- PPTX export currently writes joined lines with one effective font.

This means per-run bold, italic, color, family, and similar styling can be lost.

### Text Lists Flatten Runs

Backend `TextList.items` is modeled as `list[list[TextRun]]`, allowing rich
formatting inside each bullet. The editor schema stores text-list items as plain
strings, so per-run formatting is discarded during import.

### Table Cells Flatten Text Runs

Backend `TableCell.text` is a `TextRun`. The editor table cell model stores a
plain string plus optional cell-level font. Import preserves some cell font
information, but rich run fidelity is lost.

### Group Frame Mismatch

The backend `Group` model has children and a name, but no `position` or `size`.
The editor `group` element currently requires a frame. The importer has to infer
that frame from child bounds.

That inference is fragile, especially when groups appear inside:

- containers
- flex layouts
- grid layouts
- nested groups

Groups need explicit shared semantics: either they are framed layout elements,
or they are frame-less coordinate wrappers.

### Flex/Grid Child Layout Hints Are Missing

The editor schema supports per-child layout hints:

- `grow`
- `shrink`
- `basis`
- `minWidth`
- `maxWidth`
- `minHeight`
- `maxHeight`
- `columnSpan`
- `rowSpan`
- `alignSelf`

The backend model does not currently expose this `layout` object on elements.
Without it, flex and grid rendering has to infer behavior from element sizes and
defaults.

### Flex/Grid Padding Is Missing Backend-Side

The editor supports `padding` on flex and grid elements, and the resolver uses
it. The FastAPI `Flex` and `Grid` models currently do not include padding.

### Paint Filtering Can Drop Intentional Shapes

The importer drops rectangles and ellipses that do not have visible fill or
stroke. This removes noise well, but it can also drop intentional transparent or
shadow-only shapes if the backend ever emits them.

### Color Validation Is Stricter in the Editor

The editor expects six-digit hex colors. The FastAPI model currently treats
colors as generic strings. Invalid colors are ignored or replaced during import.

## Recommended Improvements

### 1. Add Contract Tests

Use `example.json` as a fixture and add tests that:

- import the template response through `adaptTemplateV2ResponseToDeck`
- resolve slide layout through `resolveSlideLayout`
- assert key element boxes on the cover slide
- assert flex/grid text boxes on content slides
- verify `fixed` does not change layout participation

This should catch regressions like compressed author cards or tiny flex text.

### 2. Formalize the Backend-to-Editor Contract

Document and enforce:

- render from `layouts` before `raw_layouts`
- source geometry is `1280 x 720`
- colors are six-digit hex values
- `fixed` is content metadata only
- snake_case backend fields are adapted to camelCase editor fields

### 3. Add a Backend `LayoutItem` Model

Add optional `layout` to backend element base metadata. It should map to the
editor layout object:

- `grow`
- `shrink`
- `basis`
- `min_width`
- `max_width`
- `min_height`
- `max_height`
- `column_span`
- `row_span`
- `align_self`

This gives flex and grid templates precise sizing behavior.

### 4. Add Padding to Backend Flex and Grid

Add optional `padding: Padding` to both `Flex` and `Grid` models. The editor
already imports and resolves this.

### 5. Fix Group Semantics Explicitly

Choose one canonical behavior:

- framed groups: backend `Group` gets optional `position` and `size`
- frame-less groups: editor schema allows groups without position/size and the
  resolver treats them as coordinate wrappers

Frame-less groups are likely the better match for the current FastAPI model.

### 6. Render Rich Text Runs

Improve text fidelity in stages:

1. DOM preview renders `Text.runs` as styled spans.
2. PPTX export writes rich text runs instead of joined strings.
3. Konva preview either remains a simplified fallback or renders run segments
   with positioned text nodes.

### 7. Decide How Rich Lists and Tables Should Work

Either:

- expand the editor schema to preserve rich runs in text lists and table cells,
  or
- simplify the backend model to match the editor's plain text-list/table model.

If template fidelity is the goal, preserving runs in the editor is preferable.

### 8. Validate Colors Backend-Side

Add FastAPI/Pydantic validation for color fields so invalid color values are
caught before the editor import step.

## Priority Order

1. Contract tests using `example.json`
2. Explicit group semantics
3. Backend `LayoutItem`
4. Flex/grid padding in the backend model
5. Rich text run rendering and PPTX export
6. Rich text-list/table support
7. Backend color validation

