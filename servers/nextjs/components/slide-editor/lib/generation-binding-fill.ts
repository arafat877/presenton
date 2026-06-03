import type { TextElement } from "./slide-schema";
import type { GenerationBinding } from "./slide-generation-layout-metadata";

export type BindingTextRef = {
  element: TextElement;
  original: string;
};

export type BindingRefs = {
  text: BindingTextRef[];
};

export type BindingSourceResolver = (source: string) => string | undefined;

export function fillNativeBindings({
  refs,
  bindings,
  resolveSource,
  isStructuralText,
  fitText,
  truncate,
}: {
  refs: BindingRefs;
  bindings: ReadonlyArray<GenerationBinding>;
  resolveSource: BindingSourceResolver;
  isStructuralText: (element: TextElement, original: string) => boolean;
  fitText: (element: TextElement, value: string) => void;
  truncate: (value: string, maxLength: number) => string;
}) {
  const fillableTextRefs = refs.text.filter(
    (ref) => !isStructuralText(ref.element, ref.original),
  );

  for (const binding of bindings) {
    if (binding.target !== "text") continue;

    const ref = fillableTextRefs[binding.index];
    if (!ref) continue;

    const value = resolveSource(binding.source) ?? binding.fallback ?? ref.original;
    const fittedValue =
      binding.maxLength != null ? truncate(value, binding.maxLength) : value;
    fitText(ref.element, fittedValue);
  }
}
