import type { CSSProperties } from "react";
import { PT_TO_PX, PX_PER_IN, withHash } from "../../../editorUtils";
import { elementFont } from "../../../lib/element-model";
import { rootPath, type ElementPath } from "../../../lib/element-path";
import type { ResolvedLayoutItem } from "../../../lib/layout-resolver";
import type { TableCellSelection } from "../../../state";
import { DomElementLayer, elementBoxStyle } from "../shared";

export function TableDomElement({
  editingTableIndex,
  editingTablePath,
  items,
  scale,
  selectedCell,
}: {
  editingTableIndex?: number | null;
  editingTablePath?: ElementPath | null;
  items: ResolvedLayoutItem[];
  scale: number;
  selectedCell?: TableCellSelection | null;
}) {
  const editingPath =
    editingTablePath ??
    (editingTableIndex != null ? rootPath(editingTableIndex) : null);

  return (
    <DomElementLayer>
      {items.map((item) => {
        const element = item.element;
        if (element.type !== "table" || item.sourcePath === editingPath) {
          return null;
        }

        const rows = [element.columns, ...element.rows];
        const cols = Math.max(1, ...rows.map((row) => row.length));
        const font = elementFont(element);
        const tableStroke = element.columns[0]?.stroke ?? element.rows[0]?.[0]?.stroke;
        const borderColor = colorWithOpacity(
          tableStroke?.color ?? "D9E2EF",
          tableStroke?.opacity,
        );

        return (
          <table
            key={item.path}
            style={{
              ...elementBoxStyle(element, scale),
              ...tableStyle,
              borderColor,
              borderWidth: tableStroke?.width ?? 1,
              color: withHash(font.color),
              fontFamily: `${font.family}, Helvetica, sans-serif`,
              fontSize: font.size * PT_TO_PX * (scale / PX_PER_IN),
            }}
          >
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {Array.from({ length: cols }).map((_, colIndex) => {
                    const isHeader = rowIndex === 0;
                    const selectedCellPath =
                      selectedCell?.elementPath ??
                      (selectedCell
                        ? rootPath(selectedCell.elementIndex)
                        : null);
                    const isSelected =
                      selectedCell != null &&
                      selectedCellPath === item.sourcePath &&
                      selectedCell.rowIndex === rowIndex &&
                      selectedCell.colIndex === colIndex;
                    const cell = row[colIndex] ?? {};
                    const cellFont = cell.font ?? {};
                    const cellBorderColor = colorWithOpacity(
                      cell.stroke?.color ?? borderColor,
                      cell.stroke?.opacity,
                    );
                    return (
                      <td
                        key={colIndex}
                        style={{
                          ...cellStyle,
                          width: `${100 / cols}%`,
                          height: `${100 / rows.length}%`,
                          borderColor: cellBorderColor,
                          borderWidth: cell.stroke?.width ?? 1,
                          background: colorWithOpacity(
                            cell.fill?.color ??
                              (isHeader ? "0B1F3A" : "FFFFFF"),
                            cell.fill?.opacity,
                          ),
                          color: withHash(cellFont.color ?? font.color),
                          fontFamily: `${cellFont.family ?? font.family}, Helvetica, sans-serif`,
                          fontSize:
                            (cellFont.size ?? font.size) *
                            PT_TO_PX *
                            (scale / PX_PER_IN),
                          fontWeight:
                            (cellFont.bold ?? font.bold ?? isHeader) ? 700 : 400,
                          textAlign: colIndex === 0 ? "left" : "center",
                          boxShadow: isSelected
                            ? "inset 0 0 0 2px #6f93ff"
                            : undefined,
                        }}
                      >
                        {cell.text ?? ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        );
      })}
    </DomElementLayer>
  );
}

const tableStyle: CSSProperties = {
  tableLayout: "fixed",
  borderCollapse: "collapse",
  borderWidth: 1,
  borderStyle: "solid",
  overflow: "hidden",
};

const cellStyle: CSSProperties = {
  boxSizing: "border-box",
  borderWidth: 1,
  borderStyle: "solid",
  padding: "0.05in 0.08in",
  lineHeight: 1.15,
  verticalAlign: "middle",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "normal",
  wordBreak: "break-word",
};

function colorWithOpacity(color: string, opacity?: number | null) {
  const clampedOpacity = Math.max(0, Math.min(opacity ?? 1, 1));
  if (clampedOpacity >= 1) return withHash(color);

  const normalized = color.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return `rgba(0, 0, 0, ${clampedOpacity})`;
  }

  const value = Number.parseInt(normalized, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${clampedOpacity})`;
}
