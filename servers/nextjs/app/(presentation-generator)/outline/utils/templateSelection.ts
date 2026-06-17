export const TEMPLATE_V2_SELECTION_PREFIX = "template-v2:";

export function createTemplateV2SelectionId(templateId: string): string {
  return `${TEMPLATE_V2_SELECTION_PREFIX}${templateId}`;
}

export function parseTemplateV2SelectionId(selection: string): string | null {
  if (!selection.startsWith(TEMPLATE_V2_SELECTION_PREFIX)) return null;
  const templateId = selection.slice(TEMPLATE_V2_SELECTION_PREFIX.length);
  return templateId || null;
}
