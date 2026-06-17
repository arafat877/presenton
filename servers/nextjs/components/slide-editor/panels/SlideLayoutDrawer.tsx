import type { Slide } from "../lib/slide-schema";
import type { SlideTemplate } from "../componentTemplates";
import { styles } from "../editorStyles";
import { createEmptySlide } from "../lib/empty-slide";
import { KonvaSlide } from "../slide-surface";
import { drawerStyles } from "./drawerStyles";

const EMPTY_SLIDE_PREVIEW = createEmptySlide();

export function SlideLayoutDrawer({
  anchorOffset = 0,
  insertAfterIndex,
  slideTemplates,
  onClose,
  onInsertEmpty,
  onInsert,
}: {
  anchorOffset?: number;
  insertAfterIndex: number;
  slideTemplates: ReadonlyArray<SlideTemplate>;
  onClose: () => void;
  onInsertEmpty: () => void;
  onInsert: (slide: Slide) => void;
}) {
  return (
    <div
      aria-modal="true"
      role="dialog"
      style={drawerStyles.sidecarBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        style={{
          ...drawerStyles.slideLayoutDrawer,
          right: anchorOffset,
        }}
      >
        <div style={drawerStyles.header}>
          <div>
            <div style={styles.eyebrow}>INSERT SLIDE</div>
            <h2 style={drawerStyles.title}>Choose Layout</h2>
          </div>
          <button
            type="button"
            title="Close layouts"
            onClick={onClose}
            style={drawerStyles.iconButton}
          >
            ×
          </button>
        </div>

        <div style={drawerStyles.hint}>
          New slide will be inserted after slide {insertAfterIndex + 1}.
        </div>

        <div style={drawerStyles.slideLayoutGrid}>
          <button
            type="button"
            title="Insert a blank slide"
            onClick={onInsertEmpty}
            style={drawerStyles.slideLayoutCard}
          >
            <span style={drawerStyles.slideLayoutPreview}>
              <KonvaSlide
                slide={EMPTY_SLIDE_PREVIEW}
                width={240}
                height={135}
                interactive={false}
              />
            </span>
            <span style={drawerStyles.slideLayoutName}>Blank Slide</span>
            <span style={drawerStyles.slideLayoutMeta}>
              Start from an empty canvas.
            </span>
          </button>
          {slideTemplates.map((template) => (
            <button
              key={template.id}
              type="button"
              title={template.description ?? template.label}
              onClick={() => onInsert(template.slide)}
              style={drawerStyles.slideLayoutCard}
            >
              <span style={drawerStyles.slideLayoutPreview}>
                <KonvaSlide
                  slide={template.slide}
                  width={240}
                  height={135}
                  interactive={false}
                />
              </span>
              <span style={drawerStyles.slideLayoutName}>{template.label}</span>
              {template.description ? (
                <span style={drawerStyles.slideLayoutMeta}>
                  {template.description}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
