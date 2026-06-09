"""Create editable content JSON schemas from template v2 slide layouts."""

from __future__ import annotations

import re
from typing import Any

from .models.layouts import SlideLayout


CONTENT_TYPES = {"text", "image", "text-list", "table", "chart"}
REPEATED_NAME_SUFFIX_RE = re.compile(r"_\d+$")


def extract_slide_schema_from_layout(layout: SlideLayout) -> dict[str, Any]:
    """
    Take slide layout and return content schema from slide layout.
    """
    return _object_schema(_properties_schema(layout.elements))


def _properties_schema(elements: list[Any]) -> dict[str, Any]:
    properties: dict[str, Any] = {}

    for name, schema in _nodes_for_elements(elements):
        _add_property(properties, name, schema)

    return properties


def _nodes_for_elements(elements: list[Any]) -> list[tuple[str, dict[str, Any]]]:
    nodes: list[tuple[str, dict[str, Any]]] = []

    for value in elements:
        node = _node_for_element_value(value)
        if node is not None:
            nodes.append(node)

    return nodes


def _node_for_element_value(value: Any) -> tuple[str, dict[str, Any]] | None:
    element = _element_dict(value)
    if element is None:
        return None

    return _node_for_element(element)


def _node_for_element(element: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    element_type = element.get("type")

    if element_type == "container":
        return _node_for_element_value(element.get("child"))

    if element_type in {"flex", "grid", "group"}:
        children = element.get("children", [])
        if not isinstance(children, list):
            return None

        nodes = _nodes_for_elements(children)
        if not nodes:
            return None

        name = _element_name(element)
        if name is None:
            return None

        if element_type in {"flex", "grid"}:
            array_schema = _array_schema_for_repeated_children(element, children, nodes)
            if array_schema is not None:
                return name, array_schema

        properties: dict[str, Any] = {}
        for child_name, child_schema in nodes:
            _add_property(properties, child_name, child_schema)

        schema = _object_schema(properties)
        if element_type in {"flex", "grid"}:
            schema.update(
                _compact(
                    {
                        "minProperties": element.get("min_children"),
                        "maxProperties": element.get("max_children"),
                    }
                )
            )

        return name, schema

    if element_type not in CONTENT_TYPES or element.get("fixed") is not False:
        return None

    name = _element_name(element)
    if name is None:
        return None

    return name, _content_schema_for_element(element)


def _content_schema_for_element(element: dict[str, Any]) -> dict[str, Any]:
    element_type = element["type"]

    if element_type == "text":
        return _compact(
            {
                "type": "string",
                "minLength": element.get("min_length"),
                "maxLength": element.get("max_length"),
            }
        )

    if element_type == "image":
        key = "query" if element.get("is_icon") is True else "prompt"
        return _object_schema({key: {"type": "string"}})

    if element_type == "text-list":
        return _compact(
            {
                "type": "array",
                "minItems": element.get("min_items"),
                "maxItems": element.get("max_items"),
                "items": _compact(
                    {
                        "type": "string",
                        "minLength": element.get("min_item_length"),
                        "maxLength": element.get("max_item_length"),
                    }
                ),
            }
        )

    if element_type == "table":
        return _compact(
            {
                "type": "array",
                "minItems": element.get("min_rows"),
                "maxItems": element.get("max_rows"),
                "items": _compact(
                    {
                        "type": "array",
                        "minItems": element.get("min_columns"),
                        "maxItems": element.get("max_columns"),
                        "items": {"type": "string"},
                    }
                ),
            }
        )

    if element_type == "chart":
        return {
            "type": "array",
            "items": _object_schema(
                {
                    "label": {"type": "string"},
                    "value": {"type": "number"},
                    "color": {"type": "string"},
                },
                required=["label", "value"],
            ),
        }

    raise ValueError(f"unsupported content element type: {element_type}")


def _array_schema_for_repeated_children(
    element: dict[str, Any],
    children: list[Any],
    nodes: list[tuple[str, dict[str, Any]]],
) -> dict[str, Any] | None:
    if len(nodes) < 2 or len(nodes) != _element_count(children):
        return None

    item_schemas = [
        _schema_without_repeated_name_suffix(schema, _repeated_name_suffix(name))
        for name, schema in nodes
    ]
    first_schema = item_schemas[0]
    if any(schema != first_schema for schema in item_schemas[1:]):
        return None

    return _compact(
        {
            "type": "array",
            "minItems": element.get("min_children"),
            "maxItems": element.get("max_children"),
            "items": first_schema,
        }
    )


def _object_schema(
    properties: dict[str, Any],
    *,
    required: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties) if required is None else required,
        "additionalProperties": False,
    }


def _element_name(element: dict[str, Any]) -> str | None:
    name = element.get("name")
    if not isinstance(name, str):
        return None

    stripped = name.strip()
    return stripped or None


def _add_property(
    properties: dict[str, Any],
    name: str,
    schema: dict[str, Any],
) -> None:
    key = name
    suffix = 2

    while key in properties:
        key = f"{name}_{suffix}"
        suffix += 1

    properties[key] = schema


def _schema_without_repeated_name_suffix(
    schema: dict[str, Any],
    suffix: str | None,
) -> dict[str, Any]:
    if schema.get("type") != "object":
        return {
            key: _normalize_schema_value(value, suffix)
            for key, value in schema.items()
        }

    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return {
            key: _normalize_schema_value(value, suffix)
            for key, value in schema.items()
        }

    normalized_properties: dict[str, Any] = {}
    name_map: dict[str, str] = {}

    for key, value in properties.items():
        normalized_key = _strip_repeated_suffix(key, suffix)
        name_map[key] = normalized_key
        normalized_properties[normalized_key] = _normalize_schema_value(value, suffix)

    normalized_schema = {
        key: _normalize_schema_value(value, suffix)
        for key, value in schema.items()
        if key not in {"properties", "required"}
    }
    normalized_schema["properties"] = normalized_properties

    required = schema.get("required")
    if isinstance(required, list):
        normalized_schema["required"] = [
            name_map.get(item, _strip_repeated_suffix(item, suffix))
            for item in required
            if isinstance(item, str)
        ]

    return normalized_schema


def _normalize_schema_value(value: Any, suffix: str | None) -> Any:
    if isinstance(value, dict):
        return _schema_without_repeated_name_suffix(value, suffix)

    if isinstance(value, list):
        return [_normalize_schema_value(item, suffix) for item in value]

    return value


def _repeated_name_suffix(value: str) -> str | None:
    match = REPEATED_NAME_SUFFIX_RE.search(value)
    return match.group(0) if match else None


def _strip_repeated_suffix(value: str, suffix: str | None) -> str:
    if suffix and value.endswith(suffix):
        return value[: -len(suffix)]

    return value


def _element_count(values: list[Any]) -> int:
    return sum(1 for value in values if _element_dict(value) is not None)


def _compact(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None}


def _element_dict(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        return value

    model_dump = getattr(value, "model_dump", None)
    if not callable(model_dump):
        return None

    dumped = model_dump(mode="json")
    if isinstance(dumped, dict):
        return dumped

    return None
