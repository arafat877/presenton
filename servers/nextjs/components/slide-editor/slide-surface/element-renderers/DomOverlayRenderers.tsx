import type { ReactNode } from "react";
import { useMemo } from "react";
import type { Slide } from "../../lib/slide-schema";
import {
  resolveSlideLayout,
  type ResolvedLayoutItem,
} from "../../lib/layout-resolver";
import type { ElementPath } from "../../lib/element-path";
import {
  getDomOverlayDefinitions,
  type DomOverlayRendererKey,
} from "../../registry";
import type { TableCellSelection } from "../../state";
import { BulletsDomElement } from "./bullets";
import { ChartDomElement } from "./chart";
import { SvgDomElement } from "./svg";
import { TableDomElement } from "./table";
import { TextDomElement } from "./text";

type DomOverlayRenderersProps = {
  editingBulletsIndex?: number | null;
  editingBulletsPath?: ElementPath | null;
  editingTableIndex?: number | null;
  editingTablePath?: ElementPath | null;
  editingTextIndex?: number | null;
  editingTextPath?: ElementPath | null;
  hiddenPaths?: ReadonlySet<ElementPath>;
  hiddenRootIndexes?: ReadonlySet<number>;
  items?: ResolvedLayoutItem[];
  scale: number;
  selectedTableCell?: TableCellSelection | null;
  slide: Slide;
};

const DOM_OVERLAY_RENDERERS = {
  svg: ({ items = [], scale }) => <SvgDomElement items={items} scale={scale} />,
  chart: ({ items = [], scale }) => (
    <ChartDomElement items={items} scale={scale} />
  ),
  "text-list": ({ editingBulletsIndex, editingBulletsPath, items = [], scale }) => (
    <BulletsDomElement
      editingBulletsIndex={editingBulletsIndex}
      editingBulletsPath={editingBulletsPath}
      items={items}
      scale={scale}
    />
  ),
  text: ({ editingTextIndex, editingTextPath, items = [], scale }) => (
    <TextDomElement
      editingTextIndex={editingTextIndex}
      editingTextPath={editingTextPath}
      items={items}
      scale={scale}
    />
  ),
  table: ({
    editingTableIndex,
    editingTablePath,
    items = [],
    scale,
    selectedTableCell,
  }) => (
    <TableDomElement
      editingTableIndex={editingTableIndex}
      editingTablePath={editingTablePath}
      items={items}
      scale={scale}
      selectedCell={selectedTableCell}
    />
  ),
} satisfies Record<
  DomOverlayRendererKey,
  (props: DomOverlayRenderersProps) => ReactNode
>;

export function DomOverlayRenderers(props: DomOverlayRenderersProps) {
  const itemsByRenderer = useMemo(() => {
    const grouped = new Map<DomOverlayRendererKey, ResolvedLayoutItem[]>();
    resolveSlideLayout(props.slide).forEach((item) => {
      const renderer = rendererForItem(item);
      if (!renderer) return;
      const items = grouped.get(renderer);
      if (items) items.push(item);
      else grouped.set(renderer, [item]);
    });
    return grouped;
  }, [props.slide]);

  return (
    <>
      {getDomOverlayDefinitions().map((definition) => {
        const renderer = definition.renderers.domOverlay;
        if (renderer == null) return null;
        const items = filterHiddenItems(
          itemsByRenderer.get(renderer) ?? [],
          props.hiddenPaths,
          props.hiddenRootIndexes,
        );
        return (
          <DomOverlayRenderer
            key={renderer}
            renderer={renderer}
            {...props}
            items={items}
          />
        );
      })}
    </>
  );
}

function rendererForItem(item: ResolvedLayoutItem): DomOverlayRendererKey | null {
  if (item.element.type === "chart") return "chart";
  if (item.element.type === "svg") return "svg";
  if (item.element.type === "table") return "table";
  if (item.element.type === "text") return "text";
  if (item.element.type === "text-list") return "text-list";
  return null;
}

function filterHiddenItems(
  items: ResolvedLayoutItem[],
  hiddenPaths?: ReadonlySet<ElementPath>,
  hiddenRootIndexes?: ReadonlySet<number>,
) {
  if (!hiddenPaths?.size && !hiddenRootIndexes?.size) return items;

  let changed = false;
  const visibleItems = items.filter((item) => {
    const hidden =
      hiddenPaths?.has(item.sourcePath) ||
      hiddenRootIndexes?.has(item.rootIndex);
    if (hidden) changed = true;
    return !hidden;
  });
  return changed ? visibleItems : items;
}

function DomOverlayRenderer({
  renderer,
  ...props
}: DomOverlayRenderersProps & { renderer: DomOverlayRendererKey }) {
  return DOM_OVERLAY_RENDERERS[renderer](props);
}
