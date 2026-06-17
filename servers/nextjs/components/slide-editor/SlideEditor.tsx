"use client";

import { useHotkey } from "@tanstack/react-hotkeys";
import { Provider, useAtom, useAtomValue, useSetAtom } from "jotai";
import { useHydrateAtoms } from "jotai/utils";
import {
  useMemo,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type ReactNode,
} from "react";
import type { Deck } from "./lib/slide-schema";
import { TEMPLATES, neoGeneralDeck } from "./templates";
import {
  createSlideTemplatesFromDeck,
  type ComponentTemplate,
  type SlideTemplate,
} from "./componentTemplates";
import {
  DeckThemeDrawer,
  SlideEditorDrawer,
  SlideLayoutDrawer,
} from "./panels";
import { PresentationMode } from "./PresentationMode";
import {
  EditorTopbar,
  HiddenExportStages,
  ThumbnailRail,
  layoutStyles,
} from "./shell";
import { SlideWorkspace } from "./workspace";
import {
  useDeckExport,
  useDeleteShortcut,
  useImageUpload,
  useStageSize,
} from "./hooks";
import {
  activeSlideIndexAtom,
  deckAtom,
  editorOpenAtom,
  insertEmptySlideAtom,
  insertSlideAtom,
  presentingAtom,
  redoAtom,
  selectedAtom,
  selectedItemsAtom,
  selectedPathAtom,
  selectedTableCellAtom,
  undoAtom,
} from "./state";
import { styles } from "./editorStyles";

const IMPORTED_TEMPLATE_ID = "__imported-pptx";

export function SlideEditor({
  componentTemplates,
  importTemplateMode = false,
  initialDeck = neoGeneralDeck,
  showTemplateSelect = true,
  slideTemplates,
  toolbarLeading,
}: {
  componentTemplates?: ReadonlyArray<ComponentTemplate>;
  importTemplateMode?: boolean;
  initialDeck?: Deck;
  showTemplateSelect?: boolean;
  slideTemplates?: ReadonlyArray<SlideTemplate>;
  toolbarLeading?: ReactNode;
}) {
  const initialTemplateId = useMemo(
    () => getTemplateIdForDeck(initialDeck),
    [initialDeck],
  );

  return (
    <Provider>
      <SlideEditorBody
        componentTemplates={componentTemplates}
        importTemplateMode={importTemplateMode}
        initialDeck={initialDeck}
        initialTemplateId={initialTemplateId}
        showTemplateSelect={showTemplateSelect}
        slideTemplates={slideTemplates}
        toolbarLeading={toolbarLeading}
      />
    </Provider>
  );
}

function SlideEditorBody({
  componentTemplates,
  importTemplateMode,
  initialDeck,
  initialTemplateId,
  showTemplateSelect,
  slideTemplates,
  toolbarLeading,
}: {
  componentTemplates?: ReadonlyArray<ComponentTemplate>;
  importTemplateMode: boolean;
  initialDeck: Deck;
  initialTemplateId: string;
  showTemplateSelect: boolean;
  slideTemplates?: ReadonlyArray<SlideTemplate>;
  toolbarLeading?: ReactNode;
}) {
  useHydrateAtoms([[deckAtom, initialDeck]]);
  useEditorHotkeys();
  useDeleteShortcut();

  const deck = useAtomValue(deckAtom);
  const active = useAtomValue(activeSlideIndexAtom);
  const setDeck = useSetAtom(deckAtom);
  const setActiveSlideIndex = useSetAtom(activeSlideIndexAtom);
  const setSelected = useSetAtom(selectedAtom);
  const setSelectedPath = useSetAtom(selectedPathAtom);
  const setSelectedItems = useSetAtom(selectedItemsAtom);
  const setSelectedTableCell = useSetAtom(selectedTableCellAtom);
  const [editorOpen, setEditorOpen] = useAtom(editorOpenAtom);
  const [presenting, setPresenting] = useAtom(presentingAtom);
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialTemplateId);
  const [themeOpen, setThemeOpen] = useState(false);
  const [slideLayoutOpen, setSlideLayoutOpen] = useState(false);
  const insertEmptySlide = useSetAtom(insertEmptySlideAtom);
  const insertSlide = useSetAtom(insertSlideAtom);
  const { stageWidth, stageWrapRef } = useStageSize();
  const { exportStageRefs, exportingType, handleExport, handlePdfExport } =
    useDeckExport();
  const { imageUploadInputRef, openImageUpload, handleImageUploadChange } =
    useImageUpload();
  const selectedTemplate = useMemo(
    () => TEMPLATES.find((template) => template.id === selectedTemplateId),
    [selectedTemplateId],
  );
  const resolvedSlideTemplates = useMemo(
    () =>
      slideTemplates ??
      createSlideTemplatesFromDeck(
        isDeckBackedTemplateId(selectedTemplateId)
          ? deck
          : (selectedTemplate?.deck ?? initialDeck),
      ),
    [deck, initialDeck, selectedTemplate, selectedTemplateId, slideTemplates],
  );
  const resolvedComponentTemplates =
    componentTemplates ?? selectedTemplate?.componentTemplates ?? [];
  const showTemplateToolbar = !importTemplateMode;

  const resetEditorState = (nextTemplateId: string, nextDeck: Deck) => {
    setSelectedTemplateId(nextTemplateId);
    setDeck(nextDeck);
    setActiveSlideIndex(0);
    setSelected(-1);
    setSelectedPath(null);
    setSelectedItems([]);
    setSelectedTableCell(null);
    setEditorOpen(false);
    setSlideLayoutOpen(false);
    setThemeOpen(false);
    setPresenting(false);
  };

  const handleTemplateChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (isDeckBackedTemplateId(event.target.value)) return;
    const nextTemplate = TEMPLATES.find(
      (template) => template.id === event.target.value,
    );
    if (!nextTemplate) return;
    resetEditorState(nextTemplate.id, structuredClone(nextTemplate.deck));
  };

  return (
    <div style={layoutStyles.shell}>
      <ThumbnailRail />

      <main style={layoutStyles.main}>
        <EditorTopbar
          exportingType={exportingType}
          onExport={handleExport}
          onPdfExport={handlePdfExport}
          onOpenTheme={() => setThemeOpen(true)}
          showTheme={!importTemplateMode}
          toolbarLeading={
            showTemplateToolbar ? (
              <>
                {showTemplateSelect ? (
                  <TemplateSelect
                    importedLabel={
                      selectedTemplateId === IMPORTED_TEMPLATE_ID
                        ? deck.title
                        : undefined
                    }
                    value={selectedTemplateId}
                    onChange={handleTemplateChange}
                  />
                ) : null}
                {toolbarLeading}
              </>
            ) : (
              toolbarLeading
            )
          }
        />

        <SlideWorkspace
          stageWrapRef={stageWrapRef}
          stageWidth={stageWidth}
          imageUploadInputRef={imageUploadInputRef}
          onImageUploadChange={handleImageUploadChange}
          onEditImage={openImageUpload}
          canInsertSlide={deck.slides.length < 50}
          onInsertSlide={() => setSlideLayoutOpen(true)}
        />
      </main>

      {editorOpen ? (
        <SlideEditorDrawer
          componentTemplates={resolvedComponentTemplates}
          onClose={() => setEditorOpen(false)}
        />
      ) : null}

      {slideLayoutOpen ? (
        <SlideLayoutDrawer
          anchorOffset={editorOpen ? 360 : 0}
          insertAfterIndex={active}
          slideTemplates={resolvedSlideTemplates}
          onClose={() => setSlideLayoutOpen(false)}
          onInsertEmpty={() => {
            insertEmptySlide();
            setSlideLayoutOpen(false);
          }}
          onInsert={(slide) => {
            insertSlide(slide);
            setSlideLayoutOpen(false);
          }}
        />
      ) : null}

      {themeOpen ? (
        <DeckThemeDrawer onClose={() => setThemeOpen(false)} />
      ) : null}

      {presenting ? (
        <PresentationMode
          deck={deck}
          startIndex={active}
          onClose={() => setPresenting(false)}
        />
      ) : null}

      <HiddenExportStages
        slides={deck.slides}
        exportStageRefs={exportStageRefs}
      />
    </div>
  );
}

function TemplateSelect({
  importedLabel,
  value,
  onChange,
}: {
  importedLabel?: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <select
      aria-label="Deck template"
      value={value}
      onChange={onChange}
      style={templateSelectStyle}
      title="Choose a deck template"
    >
      {importedLabel ? (
        <option value={IMPORTED_TEMPLATE_ID}>
          {`Imported: ${importedLabel}`}
        </option>
      ) : null}
      {TEMPLATES.map((template) => (
        <option key={template.id} value={template.id}>
          {template.label}
        </option>
      ))}
    </select>
  );
}

function isDeckBackedTemplateId(templateId: string) {
  return templateId === IMPORTED_TEMPLATE_ID;
}

function getTemplateIdForDeck(deck: Deck) {
  return (
    TEMPLATES.find((template) => template.deck === deck)?.id ??
    TEMPLATES.find((template) => template.deck.title === deck.title)?.id ??
    IMPORTED_TEMPLATE_ID
  );
}

function useEditorHotkeys() {
  const undo = useSetAtom(undoAtom);
  const redo = useSetAtom(redoAtom);

  useHotkey("Mod+Z", (event) => {
    event.preventDefault();
    undo();
  });
  useHotkey("Mod+Shift+Z", (event) => {
    event.preventDefault();
    redo();
  });
  useHotkey("Mod+Y", (event) => {
    event.preventDefault();
    redo();
  });
}

const templateSelectStyle = {
  ...styles.input,
  width: 205,
  height: 36,
  padding: "0 9px",
  border: "1px solid transparent",
  background: "transparent",
  boxShadow: "none",
  fontWeight: 750,
} satisfies CSSProperties;
