import type { Slide } from "./slide-schema";

export function createEmptySlide({
  background = "#FFFFFF",
  backgroundRole,
  title = "Blank Slide",
}: {
  background?: string;
  backgroundRole?: Slide["backgroundRole"];
  title?: string;
} = {}): Slide {
  return {
    title,
    background,
    backgroundRole,
    elements: [
      {
        type: "rectangle",
        position: { x: 0, y: 0 },
        size: { width: 0.1, height: 0.1 },
        fill: { color: "#FFFFFF" },
        opacity: 0,
      },
    ],
  };
}
