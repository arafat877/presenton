from templates.v2.models.layouts import SlideLayout
from templates.v2.schema import extract_slide_schema_from_layout


def test_extract_slide_schema_from_layout_extracts_editable_content():
    layout = SlideLayout.model_validate(
        {
            "id": "content_slide",
            "description": "Editable content with static decoration.",
            "elements": [
                {
                    "type": "rectangle",
                    "fill": {"color": "#ffffff"},
                },
                {
                    "type": "text",
                    "fixed": False,
                    "name": "title",
                    "min_length": 4,
                    "max_length": 8,
                },
                {
                    "type": "text",
                    "fixed": True,
                    "name": "static_label",
                    "min_length": 1,
                    "max_length": 2,
                },
                {
                    "type": "image",
                    "fixed": False,
                    "name": "hero_image",
                    "is_icon": False,
                },
                {
                    "type": "container",
                    "fixed": True,
                    "child": {
                        "type": "text",
                        "fixed": False,
                        "name": "caption",
                        "min_length": 2,
                        "max_length": 4,
                    },
                },
                {
                    "type": "group",
                    "name": "details",
                    "children": [
                        {
                            "type": "text-list",
                            "fixed": False,
                            "name": "bullets",
                            "min_items": 2,
                            "max_items": 4,
                            "min_item_length": 5,
                            "max_item_length": 10,
                        },
                        {
                            "type": "chart",
                            "fixed": False,
                            "name": "chart",
                            "chart_type": "bar",
                            "data": [],
                        },
                    ],
                },
            ],
        }
    )

    assert extract_slide_schema_from_layout(layout) == {
        "type": "object",
        "properties": {
            "title": {"type": "string", "minLength": 4, "maxLength": 8},
            "hero_image": {
                "type": "object",
                "properties": {"prompt": {"type": "string"}},
                "required": ["prompt"],
                "additionalProperties": False,
            },
            "caption": {"type": "string", "minLength": 2, "maxLength": 4},
            "details": {
                "type": "object",
                "properties": {
                    "bullets": {
                        "type": "array",
                        "minItems": 2,
                        "maxItems": 4,
                        "items": {
                            "type": "string",
                            "minLength": 5,
                            "maxLength": 10,
                        },
                    },
                    "chart": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "value": {"type": "number"},
                                "color": {"type": "string"},
                            },
                            "required": ["label", "value"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["bullets", "chart"],
                "additionalProperties": False,
            },
        },
        "required": ["title", "hero_image", "caption", "details"],
        "additionalProperties": False,
    }


def test_extract_slide_schema_from_layout_collapses_repeated_children_to_array():
    layout = SlideLayout.model_validate(
        {
            "id": "cards_slide",
            "description": "Repeated card layout.",
            "elements": [
                {
                    "type": "flex",
                    "name": "cards",
                    "position": {"x": 0, "y": 0},
                    "size": {"width": 1280, "height": 240},
                    "direction": "row",
                    "min_children": 2,
                    "max_children": 4,
                    "children": [
                        {
                            "type": "group",
                            "name": "card_1",
                            "children": [
                                {
                                    "type": "text",
                                    "fixed": False,
                                    "name": "title_1",
                                    "min_length": 3,
                                    "max_length": 6,
                                },
                                {
                                    "type": "image",
                                    "fixed": False,
                                    "name": "icon_1",
                                    "is_icon": True,
                                },
                            ],
                        },
                        {
                            "type": "group",
                            "name": "card_2",
                            "children": [
                                {
                                    "type": "text",
                                    "fixed": False,
                                    "name": "title_2",
                                    "min_length": 3,
                                    "max_length": 6,
                                },
                                {
                                    "type": "image",
                                    "fixed": False,
                                    "name": "icon_2",
                                    "is_icon": True,
                                },
                            ],
                        },
                    ],
                }
            ],
        }
    )

    assert extract_slide_schema_from_layout(layout) == {
        "type": "object",
        "properties": {
            "cards": {
                "type": "array",
                "minItems": 2,
                "maxItems": 4,
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "minLength": 3,
                            "maxLength": 6,
                        },
                        "icon": {
                            "type": "object",
                            "properties": {"query": {"type": "string"}},
                            "required": ["query"],
                            "additionalProperties": False,
                        },
                    },
                    "required": ["title", "icon"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["cards"],
        "additionalProperties": False,
    }
