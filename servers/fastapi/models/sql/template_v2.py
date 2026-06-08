from typing import Optional
import uuid

from sqlmodel import JSON, Field, SQLModel
from sqlalchemy import Column

class TemplateV2(SQLModel):
    id: uuid.UUID = Field(primary_key=True, default_factory=uuid.uuid4)
    name: str = Field(nullable=False)
    description: Optional[str] = Field(nullable=True)
    raw_layouts: Optional[dict] = Field(sa_column=Column(JSON, nullable=True))
    layouts: dict = Field(sa_column=Column(JSON, nullable=False))
    extracted_assets: Optional[dict] = Field(sa_column=Column(JSON, nullable=True))
