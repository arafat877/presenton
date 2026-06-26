# Template V2 Direct UI Rendering

This document explains the current direct Template V2 renderer.

The rule is simple:

`slide.ui.components` is the render model and the edit model.

There is no editor `Slide` model in this path. The renderer does not call
`buildDirectComponentsSlide`, does not call `adaptTemplateV2LayoutToSlide`, and
does not read `slide.content.__template_v2_konva_slide__`.

## Files

- `servers/nextjs/app/(presentation-generator)/components/V1ContentRender.tsx`
  selects the Template V2 renderer.
- `servers/nextjs/app/(presentation-generator)/components/TemplateV2DirectComponentsSlide.tsx`
  renders and edits raw `ui.components`.
- `servers/nextjs/app/(presentation-generator)/components/templateV2Events.ts`
  exports the shared Template V2 event names and event payload types without
  importing the old renderer.
- `servers/nextjs/store/slices/presentationGeneration.ts`
  persists edits with `updateSlideUi`.

## Input

The backend sends each slide with `ui.components`:

```ts
{
  index: 0,
  id: "slide-id",
  layout_group: "template-v2",
  ui: {
    id: "left_aligned_cover_9675",
    components: [
      {
        id: "left_title_stack",
        position: { x: 84.2889, y: 212.9139 },
        size: { width: 946.7008, height: 411.3664 },
        elements: [
          {
            type: "text",
            name: "headline_first_row",
            position: { x: 34.944, y: 0 },
            size: { width: 911.744, height: 173.9648 },
            font: { family: "Codec Pro Ultra-Bold", size: 132.44 },
            runs: [{ text: "Air &" }]
          }
        ]
      }
    ]
  }
}
```

The direct renderer uses that object as-is:

- component `position` and `size` are stage pixel coordinates
- child element `position` is relative to the component
- child element `size` is in stage pixels
- element style fields stay in the same snake/camel shape the backend sent

## Entry Flow

`V1ContentRender` detects Template V2:

```ts
const isTemplateV2Slide = layoutGroup.startsWith("template-v2");
```

Then it passes only what the direct renderer needs:

```tsx
<TemplateV2DirectComponentsSlide
  layout={slide.ui}
  isEditMode={isEditMode}
  slideId={slide.id ?? null}
  slideIndex={slide.index}
  renderIndex={renderIndex}
/>
```

The full backend slide object is not passed.

## Component State

`TemplateV2DirectComponentsSlide` stores raw UI JSON:

```ts
const [uiDraft, setUiDraft] = useState<RawUi>(() =>
  cloneJson(layout as RawUi),
);
```

`currentUiRef` points at the latest committed raw UI:

```ts
const currentUiRef = useRef<RawUi>(cloneJson(layout as RawUi));
```

Undo and redo store raw UI snapshots:

```ts
const undoStackRef = useRef<RawUi[]>([]);
const redoStackRef = useRef<RawUi[]>([]);
```

## Render Flow

### 1. Stage

The renderer creates a fixed 1280x720 Konva stage:

```tsx
<Stage width={1280} height={720}>
  <Layer>
    <Rect width={1280} height={720} fill={backgroundColor(uiDraft)} />
    {components.map(...)}
  </Layer>
</Stage>
```

### 2. Components

Each `ui.components[]` item renders as a Konva `Group`:

```tsx
<Group
  x={component.position.x}
  y={component.position.y}
  width={component.size.width}
  height={component.size.height}
>
  {component.elements.map(...)}
</Group>
```

Dragging a component updates:

```ts
ui.components[index].position
```

Resizing a component updates:

```ts
ui.components[index].size
```

and scales its child element positions/sizes so the visual result does not snap
back after the transform ends.

### 3. Elements

Each `component.elements[]` item renders directly from its raw type:

- `rectangle`, `container`, `flex`, `grid`, `group`, `list-view`, `grid-view`
  -> `Rect` frame/container visual
- `ellipse` -> `Ellipse`
- `line` -> `Line`
- `text` -> `Text`
- `text-list` -> `Text`
- `image` -> `KonvaImage`
- `svg` -> loaded SVG image
- `table` -> Konva table grid
- `chart` -> simple Konva chart preview

Child element positions are relative to their parent component or parent
element.

Example:

```ts
component.position = { x: 84, y: 212 }
element.position = { x: 34, y: 0 }
```

The element appears at:

```ts
absolute x = 84 + 34
absolute y = 212 + 0
```

The saved JSON remains:

```ts
element.position = { x: 34, y: 0 }
```

## Selection

Selection is represented as either a component selection:

```ts
{ kind: "component", componentIndex: 2 }
```

or an element selection:

```ts
{ kind: "element", componentIndex: 2, elementPath: [1] }
```

Nested element paths are arrays:

```ts
[1, 0, 2]
```

means:

```ts
component.elements[1].children[0].children[2]
```

The renderer also understands `elements`, single `child`, and repeated
`item` children used by `list-view` and `grid-view`.

The selected component/element is attached directly to the Konva
`Transformer`.

## Drag And Resize

Dragging is native Konva drag on the raw component/element `Group`.

For an element drag:

```ts
onDragEnd -> ui.components[c].elements[p].position =
  node.absolutePosition() - parentAbsolutePosition
```

The drag handlers read the draggable group from a local Konva group ref, not
from `event.target`. `event.target` can be a child `Rect`, `Text`, or image
inside the group. Saving child-local coordinates is what causes tiny drags to
jump objects out of place.

Component drags work on the whole raw component group and are bounded to the
1280x720 canvas. Element drags are bounded to their parent component or parent
element, so a child cannot be dragged outside the component frame.

Component and child drag events stop bubbling at their own draggable group. That
prevents a small element drag from also being interpreted as a component drag.

Drag priority is component-first. An unselected child element does not start its
own drag, so dragging on it moves the parent component. Click the child once to
select it; then dragging that selected child moves the child inside the parent
bounds.

For an element resize:

```ts
onTransformEnd -> ui.components[c].elements[p].size = {
  width: oldWidth * scaleX,
  height: oldHeight * scaleY
}
```

This is why the object follows the cursor while dragging: the actual visible
Konva group is the draggable node. We are not dragging a separate converted
hit target.

## Inline Editing

Text-like editing uses an absolute HTML textarea over the selected raw element,
plus a compact formatting toolbar for raw text fields.

Open it by double-clicking a text, bullets, table, or SVG element. Images and
charts also use double-click to open their upload/editor flows.

Opening text edit:

```ts
rawTextContent(element)
```

The text toolbar edits:

```ts
element.font.family
element.font.size
element.font.color
element.font.bold
element.font.italic
element.alignment.horizontal
element.runs[].font
```

Closing text edit:

```ts
setRawTextContent(element, draft)
```

The update writes back to:

```ts
element.text
element.runs
```

Bullets update:

```ts
element.items
```

Tables update:

```ts
element.columns
element.rows
```

SVG updates:

```ts
element.svg
```

There is no floating Edit/Delete action for selected elements. Deletion remains
available through the keyboard Delete or Backspace handling.

## Image Upload

Double-clicking or pressing `Edit` on an image stores the selected raw element
path, uploads the file, and updates:

```ts
element.data = uploadedUrl
```

No content field is touched.

## Chart Editing

Charts are stored raw in `ui.components`.

The existing side-panel chart editor still expects older camelCase field names,
so the direct renderer translates only at the event boundary:

```ts
raw chart -> chart editor event payload
chart editor update payload -> raw chart
```

The persisted source remains the raw chart object inside `ui.components`.

## Redux Persistence

Every committed edit calls:

```ts
updateSlideUi({
  index: slideIndex,
  ui: nextUi,
})
```

The reducer only writes:

```ts
presentationData.slides[index].ui = ui;
```

It does not replace the whole slide object.

## Undo And Redo

Undo and redo snapshots are raw `ui` objects.

```ts
undoStackRef.current.push(cloneJson(currentUiRef.current));
```

Undo restores a previous raw `ui`.

Redo restores the next raw `ui`.

## Important Difference From The Old Path

Old path:

```ts
slide.ui -> buildDirectComponentsSlide -> editor Slide -> render -> serialize back to ui
```

Current path:

```ts
slide.ui -> render ui.components directly -> update ui.components directly
```

The only transformations left are local field reads/writes needed to render a
specific primitive or talk to old external event consumers such as the chart
side panel.

## Raw Layout Containers

Most Template V2 components use explicit absolute child positions. Those render
exactly as provided by the backend.

For raw layout elements such as:

- `flex`
- `grid`
- `list-view`
- `grid-view`

the renderer applies a small direct layout pass to the raw children. This keeps
children from stacking at `(0,0)` when the backend represents them as layout
items instead of absolute-positioned shapes.

Flex uses `direction`, `gap`, `align_items`, and `justify_content`. Grid uses
`columns`, `rows`, `column_gap`, `row_gap`, `align_items`, and `justify_items`.
The renderer accepts both snake_case and camelCase for these fields.

Flex/grid children are layout-managed by default, even when the backend includes
placeholder positions such as `{ x: 0, y: 0 }`. If the user manually drags a
layout child, the renderer writes its rendered `position`, rendered `size`, and
`__presenton_manual_position: true`; after that, the child is treated as manually
positioned and will not snap back to the computed flex/grid slot.

`list-view` and `grid-view` repeat the raw `item` template by `count` and lay
out those repeated raw items directly. Editing a repeated item writes back to
the source `item`; deleting a repeated item decreases `count`.

Component groups are clipped to their component frame, and layout containers
clip their children. This prevents layout children from visually spilling over
other components while keeping the stored JSON in `ui.components`.

Rectangle rendering supports both numeric radius and per-corner radius objects
such as `{ tl, tr, bl, br }`. Line rendering detects near-horizontal and
near-vertical lines so divider lines from PPTX JSON do not render diagonally.
