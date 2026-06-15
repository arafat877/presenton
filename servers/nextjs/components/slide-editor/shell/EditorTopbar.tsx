import { useAtom, useAtomValue } from "jotai";
import { Palette, Play } from "lucide-react";
import { type ReactNode } from "react";
import { styles } from "../editorStyles";
import { truncateWords } from "../editorUtils";
import { ExportPptxButton } from "../shared/ExportPptxButton";
import {
  activeSlideAtom,
  activeSlideIndexAtom,
  deckAtom,
  exportModeAtom,
  isExportingAtom,
  presentingAtom,
} from "../state";
import { layoutStyles } from "./layoutStyles";

type EditorTopbarProps = {
  exportingType: "pptx" | "pdf" | null;
  onExport: () => void;
  onPdfExport: () => void;
  onOpenTheme: () => void;
  showTheme?: boolean;
  toolbarLeading?: ReactNode;
};

export function EditorTopbar({
  exportingType,
  onExport,
  onPdfExport,
  onOpenTheme,
  showTheme = true,
  toolbarLeading,
}: EditorTopbarProps) {
  const deck = useAtomValue(deckAtom);
  const active = useAtomValue(activeSlideIndexAtom);
  const activeSlide = useAtomValue(activeSlideAtom);
  const isExporting = useAtomValue(isExportingAtom);
  const [exportMode, setExportMode] = useAtom(exportModeAtom);
  const [, setPresenting] = useAtom(presentingAtom);

  return (
    <div style={layoutStyles.topbar}>
      <div style={layoutStyles.topbarTitle}>
        <div style={layoutStyles.currentTitle}>
          {activeSlide.title ?? `Slide ${active + 1}`}
        </div>
        <div style={layoutStyles.meta}>
          {deck.description
            ? truncateWords(deck.description, 6)
            : "React + Konva live preview; JSON remains the source of truth."}
        </div>
      </div>
      <div style={layoutStyles.toolbar}>
        {toolbarLeading ? (
          <div style={layoutStyles.toolbarGroup}>{toolbarLeading}</div>
        ) : null}
        {showTheme ? (
          <div style={layoutStyles.toolbarGroup}>
            <button
              type="button"
              onClick={onOpenTheme}
              style={styles.toolbarIconButton}
              title="Configure deck theme"
              aria-label="Configure deck theme"
            >
              <Palette size={16} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        <div style={layoutStyles.toolbarGroup}>
          <button
            type="button"
            onClick={() => setPresenting(true)}
            style={styles.toolbarSecondaryButton}
            title="Start presentation"
          >
            <Play size={15} aria-hidden="true" />
            Present
          </button>
          <ExportPptxButton
            mode={exportMode}
            onModeChange={setExportMode}
            onExport={onExport}
            onPdfExport={onPdfExport}
            isExporting={isExporting}
            exportingType={exportingType}
          />
        </div>
      </div>
    </div>
  );
}
