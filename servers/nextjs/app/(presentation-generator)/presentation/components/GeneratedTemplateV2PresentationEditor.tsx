"use client";

import { useMemo } from "react";
import { SlideEditor } from "@/components/slide-editor";
import {
  adaptGeneratedTemplateV2PresentationToDeck,
  type GeneratedTemplateV2PresentationResponse,
} from "@/components/slide-editor/lib/template-v2-import";

export function GeneratedTemplateV2PresentationEditor({
  presentationData,
}: {
  presentationData: GeneratedTemplateV2PresentationResponse;
}) {
  const deckVersionKey = useMemo(() => {
    const slides = Array.isArray(presentationData.slides)
      ? presentationData.slides
      : [];
    let hash = 0;
    const payload = JSON.stringify(slides);
    for (let index = 0; index < payload.length; index += 1) {
      hash = (hash * 31 + payload.charCodeAt(index)) | 0;
    }
    return `${String(presentationData.id ?? "generated-template-v2")}:${slides.length}:${hash}`;
  }, [presentationData.id, presentationData.slides]);

  const editorState = useMemo(() => {
    try {
      return {
        deck: adaptGeneratedTemplateV2PresentationToDeck(presentationData),
        error: null,
      };
    } catch (error) {
      return {
        deck: null,
        error:
          error instanceof Error
            ? error.message
            : "Could not open generated presentation in the editor.",
      };
    }
  }, [presentationData]);

  if (editorState.error || !editorState.deck) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f6fa] p-6 font-syne text-[#101323]">
        <section className="grid w-full max-w-md gap-3 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-bold uppercase text-gray-500">
            Slide Editor
          </p>
          <h1 className="text-xl font-semibold">Could not render presentation</h1>
          <p className="text-sm leading-6 text-gray-600">{editorState.error}</p>
        </section>
      </main>
    );
  }

  return (
    <SlideEditor
      key={deckVersionKey}
      importTemplateMode
      initialDeck={editorState.deck}
      showTemplateSelect={false}
    />
  );
}
