import type { Deck } from "../lib/slide-schema";
import type { ComponentTemplate } from "../componentTemplates";
import { neoGeneralDeck } from "./neo-general";
import { reportDeck } from "./report";

export type TemplateDescriptor = {
  id: string;
  label: string;
  description: string;
  deck: Deck;
  componentTemplates?: ReadonlyArray<ComponentTemplate>;
};

export const TEMPLATES: ReadonlyArray<TemplateDescriptor> = [
  {
    id: "neo-general",
    label: "Neo General",
    description:
      "Legacy Neo General layouts rebuilt as editable slide-editor elements.",
    deck: neoGeneralDeck,
  },
  {
    id: "report",
    label: "Report",
    description:
      "Legacy Report layouts rebuilt as editable slide-editor elements.",
    deck: reportDeck,
  },
];

export {
  neoGeneralDeck,
  reportDeck,
};
