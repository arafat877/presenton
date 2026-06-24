import { useAtomValue, useSetAtom } from "jotai";
import {
  editingTextIndexAtom,
  editingTextPathAtom,
  editingChartIndexAtom,
  editingChartPathAtom,
  selectedResolvedElementAtom,
  selectedIndexAtom,
  selectedPathAtom,
  selectedTableCellAtom,
  updateElementAtPathAtom,
} from "../state";
import { rootPath, type ElementPath } from "../lib/element-path";
import { ElementToolbar } from "./ElementToolbar";

type WorkspaceToolbarsProps = {
  scale: number;
  onEditChart?: (index: number, path?: ElementPath) => void;
  onEditImage: (index: number, path?: ElementPath) => void;
};

export function WorkspaceToolbars({
  scale,
  onEditChart,
  onEditImage,
}: WorkspaceToolbarsProps) {
  const selectedIndex = useAtomValue(selectedIndexAtom);
  const selectedPath = useAtomValue(selectedPathAtom);
  const selectedElement = useAtomValue(selectedResolvedElementAtom);
  const selectedTableCell = useAtomValue(selectedTableCellAtom);
  const updateElementAtPath = useSetAtom(updateElementAtPathAtom);
  const setEditingTextIndex = useSetAtom(editingTextIndexAtom);
  const setEditingTextPath = useSetAtom(editingTextPathAtom);
  const setEditingChartIndex = useSetAtom(editingChartIndexAtom);
  const setEditingChartPath = useSetAtom(editingChartPathAtom);

  if (!selectedElement) return null;

  return (
    <ElementToolbar
      element={selectedElement}
      index={selectedIndex}
      scale={scale}
      selectedTableCell={selectedTableCell}
      path={selectedPath ?? rootPath(selectedIndex)}
      onChange={(index, element, path) =>
        updateElementAtPath({ path: path ?? rootPath(index), element })
      }
      onEditChart={(index, path) => {
        if (onEditChart) {
          onEditChart(index, path);
          return;
        }
        setEditingTextIndex(null);
        setEditingTextPath(null);
        setEditingChartIndex(index);
        setEditingChartPath(path ?? rootPath(index));
      }}
      onEditImage={onEditImage}
      onEditText={(index, path) => {
        setEditingTextIndex(index);
        setEditingTextPath(path ?? rootPath(index));
      }}
    />
  );
}
