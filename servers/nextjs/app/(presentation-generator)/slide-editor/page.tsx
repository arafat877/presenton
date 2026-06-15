import { SlideEditorImportPage } from "@/components/slide-editor";
import { TEMPLATE_IMPORT_QUERY_PARAM } from "@/components/slide-editor/lib/template-deck-handoff";

type SlideEditorPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SlideEditorPage({
  searchParams,
}: SlideEditorPageProps) {
  const params = await searchParams;
  const templateImportId = firstQueryValue(params[TEMPLATE_IMPORT_QUERY_PARAM]);

  return <SlideEditorImportPage templateImportId={templateImportId} />;
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
