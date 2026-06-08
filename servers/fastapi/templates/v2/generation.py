import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from json import JSONDecodeError
from typing import Any

from llmai import get_client
from llmai.shared import (
    AssistantMessage,
    JSONObjectResponse,
    SystemMessage,
    UserMessage,
)
from pydantic import BaseModel, ValidationError

from templates.v2.models.layouts import SlideLayout, SlideLayouts
from utils.llm_config import get_llm_config
from utils.llm_provider import get_model


DEFAULT_VALIDATION_RETRIES = 3
MAX_PARALLEL_SLIDE_LAYOUTS = 10


GENERATE_SLIDE_LAYOUT_PROMPT = """
Convert the provided raw SlideLayout JSON object into one flexible SlideLayout JSON object.
Return exactly one raw JSON SlideLayout object. Do not include markdown, comments, or explanations.

# Core Rules
- Use the 1280x720 slide coordinate system.
- Preserve all visible source content, original stacking order, text, image paths/data, image names, colors, and table/list data exactly.
- Match the SlideLayout schema exactly: snake_case fields only, no aliases, and no `component` elements.
- Layout `id` must describe layout structure, not slide content. Use names like `title_description_image`, `split_image_text`, or `header_feature_grid`; do not use topic/content names like a brand, product, or slide subject.
- Use concise lower_snake_case role names for element `name`.
- Layout wrappers (`container`, `flex`, `grid`, `group`) must not replace or omit visible child elements.

# Element Selection
- Use `text` for standalone text boxes; content belongs in `runs`, never top-level `text`.
- Use `image` for photos, illustrations, logos, and icons.
- Use `rectangle`, `ellipse`, and `line` for visible geometry.
- Use `table` for tabular content; cell content belongs in cell `text`.
- Use `chart` only for chart-like data visualizations.
- Use `text-list` for text-only bullet, numbered, or line lists.
- Use `container` for a framed single child.
- Use `group` only for semantic clusters that must move together and cannot be described by flex/grid.

# Flexible Layout Rules
- Use `flex` and `grid` as much as possible to build flexible layout structure, not only repeated items.
- Use `flex` for one-dimensional regions: rows, columns, stacks, split panels, headers, footers, icon/text pairs, card internals, menus, timelines, and content flows.
- Use `grid` for two-dimensional regions: multi-column sections, dashboards, feature blocks, card decks, metric areas, asymmetric regions, and repeated grids.
- Prefer top-level flex/grid for title/body stacks, left/right image-copy layouts, header/content/footer layouts, feature sections, menu sections, and metric sections.
- Set each flex/grid `position` and `size` to the bounding box of the layout region it controls.
- Use gaps, alignment, rows, columns, and flow children instead of hard-coding every child position.
- Children inside `container` must use local coordinates relative to the container frame, never slide-absolute coordinates.
- `group` has no frame; keep slide-level group children in slide coordinates, but grouped children inside a flex/grid slot must use coordinates local to that slot.
- Direct children of `flex` and `grid` must omit `position` and `size`; both are computed by the parent layout. Nested elements inside those computed slots should use local coordinates.
- Keep absolute-positioned elements only for unique or decorative slide-level content outside flexible regions.

# Schema Rules
- Set `fixed: true` for static layout/decorative content.
- Set `fixed: false` for replaceable placeholders used when generating new presentations.
- A group has only `type`, `name`, and `children`; never include group `position`, `size`, or `rotation`.
- Provide required schema bounds wherever supported:
  - text: `min_length` and `max_length`
  - text-list: `min_items`, `max_items`, `min_item_length`, and `max_item_length`
  - table: `min_columns`, `max_columns`, `min_rows`, and `max_rows`
  - flex/grid: `min_children` and `max_children`
- Choose `max_*` values that fit the element frame or flex/grid slot without slide overflow.
- Use identical min/max bounds for repeated or similar placeholders, including bullet items and matching flex/grid siblings.
- Set every `min_*` value to half of the matching `max_*` value, rounded up.
"""


def generate_slide_layout(layout: SlideLayout) -> SlideLayout:
    '''
    Generate flexible layout for a slide using raw slide layout.
    '''
    client = get_client(config=get_llm_config())
    model = get_model()
    messages = [
        SystemMessage(
            content=_system_prompt_with_schema(
                GENERATE_SLIDE_LAYOUT_PROMPT,
                SlideLayout,
            )
        ),
        UserMessage(content=_json_dumps_for_prompt(layout.model_dump(mode="json"))),
    ]

    result = _generate_with_validation_retries(
        client=client,
        model=model,
        messages=messages,
        label=f"slide layout {layout.id}",
        output_model=SlideLayout,
        validation_retries=DEFAULT_VALIDATION_RETRIES,
    )
    return SlideLayout.model_validate(result)


def generate_template(layouts: SlideLayouts) -> SlideLayouts:
    '''
    Generate template for a slide using raw slide layouts.
    Call generate_slide_layout to generate a flexible layout for one slide.
    Batch generate_slide_layout calls to 10 slides in parallel.
    '''
    if not layouts.layouts:
        raise ValueError("layouts must contain at least one slide layout")

    generated_by_index: dict[int, SlideLayout] = {}
    with ThreadPoolExecutor(
        max_workers=min(MAX_PARALLEL_SLIDE_LAYOUTS, len(layouts.layouts))
    ) as executor:
        futures = {
            executor.submit(generate_slide_layout, layout): index
            for index, layout in enumerate(layouts.layouts)
        }
        for future in as_completed(futures):
            generated_by_index[futures[future]] = future.result()

    generated_layouts = [
        generated_by_index[index] for index in range(len(layouts.layouts))
    ]
    return SlideLayouts.model_validate({"layouts": generated_layouts})


def _generate_with_validation_retries(
    *,
    client: Any,
    model: str,
    messages: list[Any],
    label: str,
    output_model: type[BaseModel],
    validation_retries: int,
) -> dict[str, Any]:
    attempt_messages = list(messages)
    last_error: Exception | None = None

    for attempt in range(1, validation_retries + 2):
        try:
            response = client.generate(
                model=model,
                messages=attempt_messages,
                temperature=0,
                response_format=JSONObjectResponse(),
                max_tokens=8192,
            )
        except Exception as exc:
            last_error = exc
            if attempt > validation_retries:
                raise
            attempt_messages = _messages_for_generation_error_retry(
                messages=attempt_messages,
                label=label,
                error=exc,
            )
            continue

        try:
            parsed = _parse_json_content(response.content)
            return _validate_output_model(parsed, output_model)
        except ValidationError as exc:
            last_error = exc
            if attempt > validation_retries:
                raise
            attempt_messages = _messages_for_model_validation_retry(
                messages=attempt_messages,
                response=response,
                label=label,
                output_model=output_model,
                error=exc,
                invalid_response=parsed,
            )
        except (JSONDecodeError, ValueError) as exc:
            last_error = exc
            if attempt > validation_retries:
                raise
            attempt_messages = _messages_for_json_repair_retry(
                messages=attempt_messages,
                response=response,
                label=label,
                error=exc,
            )

    if last_error is not None:
        raise last_error

    raise RuntimeError(f"LLM failed to generate {label}")


def _validate_output_model(
    parsed: dict[str, Any],
    output_model: type[BaseModel],
) -> dict[str, Any]:
    validated = output_model.model_validate(parsed)
    return validated.model_dump(mode="json")


def _system_prompt_with_schema(
    prompt: str,
    output_model: type[BaseModel],
) -> str:
    return "\n".join(
        [
            prompt.rstrip(),
            "",
            "# Required JSON Schema",
            _json_dumps_for_prompt(output_model.model_json_schema()),
        ]
    )


def _parse_json_content(content: Any) -> dict[str, Any]:
    text_content = _text_from_content(content)

    if text_content is not None:
        parsed = json.loads(text_content)
    else:
        parsed = content

    if not isinstance(parsed, dict):
        raise ValueError("LLM response must be a JSON object")

    return parsed


def _text_from_content(content: Any) -> str | None:
    if isinstance(content, str):
        return content

    if not isinstance(content, list):
        return None

    parts: list[str] = []
    for part in content:
        if isinstance(part, str):
            parts.append(part)
            continue

        text = getattr(part, "text", None)
        if isinstance(text, str):
            parts.append(text)

    return "".join(parts) if parts else None


def _messages_for_generation_error_retry(
    *,
    messages: list[Any],
    label: str,
    error: Exception,
) -> list[Any]:
    return [
        *messages,
        UserMessage(
            content=_json_repair_prompt(
                label=label,
                invalid_response=None,
                error=error,
            )
        ),
    ]


def _messages_for_json_repair_retry(
    *,
    messages: list[Any],
    response: Any,
    label: str,
    error: Exception,
) -> list[Any]:
    invalid_response = _text_from_content(response.content) or response.content
    response_messages = getattr(response, "messages", None)
    if response_messages:
        retry_messages = list(response_messages)
    else:
        retry_messages = [
            *messages,
            AssistantMessage(content=[_json_dumps_for_prompt(invalid_response)]),
        ]

    retry_messages.append(
        UserMessage(
            content=_json_repair_prompt(
                label=label,
                invalid_response=invalid_response,
                error=error,
            )
        )
    )
    return retry_messages


def _messages_for_model_validation_retry(
    *,
    messages: list[Any],
    response: Any,
    label: str,
    output_model: type[BaseModel],
    error: ValidationError,
    invalid_response: dict[str, Any],
) -> list[Any]:
    response_messages = getattr(response, "messages", None)
    if response_messages:
        retry_messages = list(response_messages)
    else:
        retry_messages = [
            *messages,
            AssistantMessage(content=[_json_dumps_for_prompt(invalid_response)]),
        ]

    retry_messages.append(
        UserMessage(
            content=_model_validation_repair_prompt(
                label=label,
                output_model=output_model,
                invalid_response=invalid_response,
                error=error,
            )
        )
    )
    return retry_messages


def _json_repair_prompt(
    *,
    label: str,
    invalid_response: Any | None,
    error: Exception,
) -> str:
    parts = [
        f"The previous {label} response was not a valid JSON object for this task.",
        "Return a complete replacement JSON object.",
        "Return raw JSON only. Do not include markdown fences, comments, explanations, or any text before or after the JSON object.",
        "",
        "parse_errors:",
        _format_error_for_prompt(error),
    ]

    if invalid_response is not None:
        parts.extend(
            [
                "",
                "invalid_response:",
                _json_dumps_for_prompt(invalid_response),
            ]
        )

    return "\n".join(parts)


def _model_validation_repair_prompt(
    *,
    label: str,
    output_model: type[BaseModel],
    invalid_response: dict[str, Any],
    error: ValidationError,
) -> str:
    return "\n".join(
        [
            f"The previous {label} JSON did not match the required schema.",
            "Return a complete corrected replacement JSON object.",
            "Return raw JSON only. Do not include markdown fences, comments, explanations, or any text before or after the JSON object.",
            "",
            "validation_errors:",
            _format_error_for_prompt(error),
            "",
            "invalid_response:",
            _json_dumps_for_prompt(invalid_response),
            "",
            "required_json_schema:",
            _json_dumps_for_prompt(output_model.model_json_schema()),
        ]
    )


def _format_error_for_prompt(error: Exception) -> str:
    if isinstance(error, ValidationError):
        return _json_dumps_for_prompt(error.errors())

    return str(error)


def _json_dumps_for_prompt(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False)
