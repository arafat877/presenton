from typing import List

from pydantic import BaseModel

from .elements import SlideElement


class SlideLayout(BaseModel):
    id: str
    description: str
    elements: List[SlideElement]


class SlideLayouts(BaseModel):
    layouts: List[SlideLayout]
