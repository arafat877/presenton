import { memo } from "react";
import { renderKonvaElement, type KonvaElementRenderProps } from "./elementRenderers";

function KonvaElementBase(props: KonvaElementRenderProps) {
  return renderKonvaElement(props);
}

function areKonvaElementPropsEqual(
  previous: KonvaElementRenderProps,
  next: KonvaElementRenderProps,
) {
  return (
    previous.element === next.element &&
    previous.index === next.index &&
    previous.scale === next.scale &&
    previous.selected === next.selected &&
    previous.editing === next.editing &&
    previous.bulletsRenderMode === next.bulletsRenderMode &&
    previous.chartRenderMode === next.chartRenderMode &&
    previous.tableRenderMode === next.tableRenderMode &&
    previous.textRenderMode === next.textRenderMode &&
    Boolean(previous.onTableCellClick) === Boolean(next.onTableCellClick)
  );
}

export const KonvaElement = memo(KonvaElementBase, areKonvaElementPropsEqual);
KonvaElement.displayName = "KonvaElement";
