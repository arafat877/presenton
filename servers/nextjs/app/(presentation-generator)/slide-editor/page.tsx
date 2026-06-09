import { SlideEditorImportPage } from "@/components/slide-editor";
import {
  PPTX_IMPORT_QUERY_PARAM,
  TEMPLATE_IMPORT_QUERY_PARAM,
} from "@/components/slide-editor/lib/pptx-import-handoff";

type SlideEditorPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SlideEditorPage({
  searchParams,
}: SlideEditorPageProps) {
  const params = await searchParams;
  const pptxImportId = firstQueryValue(params[PPTX_IMPORT_QUERY_PARAM]);
  const templateImportId = firstQueryValue(params[TEMPLATE_IMPORT_QUERY_PARAM]);

  return (
    <SlideEditorImportPage
      pptxImportId={pptxImportId}
      templateImportId={templateImportId}
    />
  );
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
