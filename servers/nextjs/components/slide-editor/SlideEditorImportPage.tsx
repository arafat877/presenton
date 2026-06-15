"use client";

import { useEffect, useState } from "react";
import { useFontLoader as loadFontAssets } from "@/app/(presentation-generator)/hooks/useFontLoad";
import { SlideEditor } from "./SlideEditor";
import { editorTheme, baseFont, displayFont, styles } from "./editorStyles";
import { DeckSchema, type Deck } from "./lib/slide-schema";
import {
  readStagedTemplateDeckImport,
  removeStagedTemplateDeckImport,
} from "./lib/template-deck-handoff";
import { neoGeneralDeck } from "./templates";

const IMPORT_CACHE_DELETE_DELAY_MS = 60_000;

type ImportState =
  | { status: "loading" }
  | { status: "ready"; deck: Deck }
  | { status: "error"; message: string };

export function SlideEditorImportPage({
  showTemplateSelect = true,
  templateImportId,
}: {
  showTemplateSelect?: boolean;
  templateImportId?: string;
}) {
  const [importState, setImportState] = useState<ImportState>(() =>
    templateImportId
      ? { status: "loading" }
      : { status: "ready", deck: neoGeneralDeck },
  );

  useEffect(() => {
    if (!templateImportId) {
      setImportState({ status: "ready", deck: neoGeneralDeck });
      return;
    }

    let cancelled = false;
    setImportState({ status: "loading" });

    const importDeck = async () => {
      try {
        const stagedImport = await readStagedTemplateDeckImport(templateImportId);
        if (!stagedImport) {
          throw new Error(
            "The selected template could not be found. Please import it again.",
          );
        }

        if (stagedImport.fonts && Object.keys(stagedImport.fonts).length > 0) {
          loadFontAssets(stagedImport.fonts);
        }

        const parsedDeck = DeckSchema.safeParse(stagedImport.deck);
        if (!parsedDeck.success) {
          throw new Error("The selected template could not be rendered.");
        }

        if (cancelled) return;
        setImportState({ status: "ready", deck: parsedDeck.data });

        window.setTimeout(() => {
          void removeStagedTemplateDeckImport(
            templateImportId,
            stagedImport.createdAt,
          ).catch((error) => {
            console.warn("Could not clear staged template import:", error);
          });
        }, IMPORT_CACHE_DELETE_DELAY_MS);
      } catch (error) {
        if (cancelled) return;
        console.error("Template import failed:", error);
        setImportState({
          status: "error",
          message:
            error instanceof Error ? error.message : "Failed to open template.",
        });
      }
    };

    void importDeck();

    return () => {
      cancelled = true;
    };
  }, [templateImportId]);

  if (importState.status === "loading") {
    return (
      <EditorImportStatus
        title="Opening template"
        description="Opening your deck in the editor..."
      />
    );
  }

  if (importState.status === "error") {
    return (
      <EditorImportStatus
        title="Import failed"
        description={importState.message}
      />
    );
  }

  return (
    <SlideEditor
      key={templateImportId ?? "default-slide-editor"}
      importTemplateMode={Boolean(templateImportId)}
      initialDeck={importState.deck}
      showTemplateSelect={showTemplateSelect}
    />
  );
}

function EditorImportStatus({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: editorTheme.background,
        color: editorTheme.text,
        fontFamily: baseFont,
      }}
    >
      <section
        style={{
          width: "min(420px, 100%)",
          display: "grid",
          gap: 12,
          padding: 24,
          borderRadius: 8,
          border: `1px solid ${editorTheme.border}`,
          background: editorTheme.surface,
          boxShadow: "0 14px 34px rgba(16,19,35,0.08)",
        }}
        aria-live="polite"
      >
        <div style={styles.eyebrow}>Slide Editor</div>
        <h1
          style={{
            margin: 0,
            fontFamily: displayFont,
            fontSize: 22,
            lineHeight: 1.2,
          }}
        >
          {title}
        </h1>
        <p
          style={{
            margin: 0,
            color: editorTheme.textSoft,
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      </section>
    </main>
  );
}
