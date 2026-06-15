from llmai.shared import AssistantMessage, SystemMessage, UserMessage
from pydantic import BaseModel, Field, ValidationError

from templates.v2.generation import (
    Cluster,
    ClusterCandidate,
    Component,
    _messages_for_json_repair_retry,
    _messages_for_model_validation_retry,
    build_template_layouts,
)
from templates.v2.models.layouts import SlideLayouts


class _FakeResponse:
    def __init__(self, content, messages):
        self.content = content
        self.messages = messages


class _ProviderResponseItem:
    id = "rs_00000000000000000000000000000000"


class _RetrySchema(BaseModel):
    title: str = Field(min_length=5)


def test_build_template_layouts_replaces_candidates_and_keeps_fallbacks():
    raw_layouts = SlideLayouts.model_validate(
        {
            "layouts": [
                {
                    "id": "slide_1",
                    "description": "Raw slide.",
                    "elements": [
                        {
                            "type": "rectangle",
                            "position": {"x": 10, "y": 20},
                            "size": {"width": 100, "height": 80},
                            "fill": {"color": "#ffffff"},
                        },
                        {
                            "type": "rectangle",
                            "position": {"x": 200, "y": 20},
                            "size": {"width": 100, "height": 80},
                            "fill": {"color": "#eeeeee"},
                        },
                    ],
                }
            ]
        }
    )
    candidates = [
        ClusterCandidate(
            id="left_card",
            description="Standalone rectangle component.",
            slide_index=0,
            elements=[0],
        )
    ]
    clusters = [Cluster(id="card", candidates=[0])]
    components = [
        Component(
            id="card_component",
            description="Reusable rectangle card component.",
            design_variables=[],
            elements=[
                {
                    "type": "rectangle",
                    "position": {"x": 10, "y": 20},
                    "size": {"width": 100, "height": 80},
                    "fill": {"color": "#ffffff"},
                }
            ],
        )
    ]

    template, stats = build_template_layouts(
        raw_layouts,
        candidates,
        clusters,
        components,
    )

    layout = template["layouts"][0]
    assert "elements" not in layout
    assert [component["id"] for component in layout["components"]] == [
        "card_component",
        "slide_1_element_2",
    ]
    assert stats.replaced_candidates == 1
    assert stats.skipped_overlapping_candidates == 0
    assert stats.untouched_elements == 1


def test_json_repair_retry_rebuilds_messages_without_provider_response_items():
    original_messages = [
        SystemMessage(content="Return JSON."),
        UserMessage(content="{}"),
    ]
    provider_response_item = _ProviderResponseItem()
    response = _FakeResponse(
        content='{"bad": true',
        messages=[provider_response_item],
    )

    retry_messages = _messages_for_json_repair_retry(
        messages=original_messages,
        response=response,
        label="component",
        error=ValueError("invalid JSON"),
    )

    assert provider_response_item not in retry_messages
    assert retry_messages[:2] == original_messages
    assert isinstance(retry_messages[2], AssistantMessage)
    assert retry_messages[2].content == ['"{\\"bad\\": true"']
    assert isinstance(retry_messages[3], UserMessage)
    assert "Return a complete replacement JSON object." in retry_messages[3].content


def test_validation_retry_rebuilds_messages_without_provider_response_items():
    original_messages = [
        SystemMessage(content="Return schema JSON."),
        UserMessage(content='{"title":"ok"}'),
    ]
    provider_response_item = _ProviderResponseItem()
    invalid_response = {"title": "bad"}
    response = _FakeResponse(
        content=invalid_response,
        messages=[provider_response_item],
    )
    try:
        _RetrySchema.model_validate(invalid_response)
    except ValidationError as exc:
        validation_error = exc
    else:
        raise AssertionError("expected validation error")

    retry_messages = _messages_for_model_validation_retry(
        messages=original_messages,
        response=response,
        label="component",
        output_model=_RetrySchema,
        error=validation_error,
        invalid_response=invalid_response,
    )

    assert provider_response_item not in retry_messages
    assert retry_messages[:2] == original_messages
    assert isinstance(retry_messages[2], AssistantMessage)
    assert retry_messages[2].content == ['{\n  "title": "bad"\n}']
    assert isinstance(retry_messages[3], UserMessage)
    assert "required_json_schema:" in retry_messages[3].content
