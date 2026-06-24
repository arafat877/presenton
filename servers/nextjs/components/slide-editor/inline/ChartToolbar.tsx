import { BarChart3, Download, Palette, Pencil } from "lucide-react";
import type { ChartSlideElement } from "../state";
import { withHash, withoutHash } from "../editorUtils";
import {
  chartDataFromSeries,
  chartDataToCsv,
  resolvedChartCategories,
} from "../lib/chart-data";
import { InlineToolbar } from "./InlineToolbar";
import { inlineStyles } from "./inlineStyles";

export function ChartToolbar({
  element,
  index,
  scale,
  onChange,
  onEdit,
}: {
  element: ChartSlideElement;
  index: number;
  scale: number;
  onChange: (index: number, element: ChartSlideElement) => void;
  onEdit?: (index: number) => void;
}) {
  const categories = resolvedChartCategories(element);

  return (
    <InlineToolbar element={element} scale={scale}>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          paddingRight: 8,
          borderRight: "1px solid #E6E6EA",
        }}
      >
        <BarChart3 size={16} strokeWidth={2} />
        <select
          aria-label="Chart type"
          title="Chart type"
          value={element.chartType}
          onChange={(event) =>
            onChange(index, {
              ...element,
              chartType: event.target.value as ChartSlideElement["chartType"],
            })
          }
          style={{
            ...inlineStyles.select,
            minWidth: 126,
            border: "none",
            paddingLeft: 0,
          }}
        >
          <option value="bar">Bar Chart</option>
          <option value="line">Line Chart</option>
          <option value="area">Area Chart</option>
          <option value="pie">Pie Chart</option>
          <option value="donut">Donut Chart</option>
        </select>
      </div>

      <button
        type="button"
        title="Edit chart"
        onClick={() => onEdit?.(index)}
        style={inlineStyles.iconButton}
      >
        <Pencil size={16} strokeWidth={2} />
      </button>

      <label
        title="Series color"
        style={{
          ...inlineStyles.iconButton,
          display: "grid",
          placeItems: "center",
          position: "relative",
        }}
      >
        <Palette size={16} strokeWidth={2} />
        <input
          aria-label="Chart color"
          type="color"
          value={withHash(element.color ?? "D4A24C")}
          onChange={(event) => {
            const color = withoutHash(event.target.value);
            onChange(index, {
              ...element,
              color,
              seriesColors: element.series?.length
                ? [color, ...(element.seriesColors ?? []).slice(1)]
                : element.seriesColors,
              data: chartDataFromSeries(categories, element.series ?? [], color),
            });
          }}
          style={{
            height: 1,
            left: "50%",
            opacity: 0,
            position: "absolute",
            top: "50%",
            width: 1,
          }}
        />
      </label>

      <button
        type="button"
        title="Download chart data"
        onClick={() => downloadChartData(element)}
        style={inlineStyles.iconButton}
      >
        <Download size={16} strokeWidth={2} />
      </button>
    </InlineToolbar>
  );
}

function downloadChartData(element: ChartSlideElement) {
  const blob = new Blob([chartDataToCsv(element)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${(element.title || "chart").toLowerCase().replace(/\W+/g, "-") || "chart"}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
