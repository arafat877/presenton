export type GenerationLayoutKind =
  | "cover"
  | "general"
  | "bullets"
  | "cards"
  | "metrics"
  | "chart"
  | "table"
  | "timeline"
  | "quote"
  | "team"
  | "visual"
  | "closing";

export type GenerationBindingTarget =
  | "text"
  | "list"
  | "chart"
  | "table"
  | "image";

export type GenerationBinding = {
  target: GenerationBindingTarget;
  index: number;
  source: string;
  maxLength?: number;
  fallback?: string;
};

export type GenerationLayoutMetadata = {
  layoutId: string;
  slideIndex: number;
  layoutName: string;
  layoutDescription: string;
  semanticKind: GenerationLayoutKind;
  schemaFields: string[];
  bindings?: GenerationBinding[];
};
