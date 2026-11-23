from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator
from sqlalchemy import Connection, text

from app.catalog import Catalog, catalog_router

RequiredText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class CatalogInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active: bool = True


class NamedCatalog(CatalogInput):
    code: RequiredText
    name: RequiredText


class DatedCatalog(NamedCatalog):
    description: str | None = None
    valid_from: date | None = None
    valid_to: date | None = None

    @model_validator(mode="after")
    def validate_period(self):
        if self.valid_from and self.valid_to and self.valid_to < self.valid_from:
            raise ValueError("O fim da vigência deve ser igual ou posterior ao início.")
        return self


class CategoryInput(DatedCatalog):
    code: RequiredText | None = None
    kind: Literal["REVENUE", "EXPENSE", "NEUTRAL"]


class Category(CategoryInput):
    code: RequiredText
    kind: Literal["REVENUE", "EXPENSE", "NEUTRAL"] | None
    id: UUID
    organization_id: UUID


class SubcategoryInput(DatedCatalog):
    code: RequiredText | None = None
    category_id: UUID


class Subcategory(SubcategoryInput):
    code: RequiredText
    id: UUID


class CostCenterInput(NamedCatalog):
    code: RequiredText | None = None
    parent_id: UUID | None = None


class CostCenter(CostCenterInput):
    code: RequiredText
    id: UUID
    organization_id: UUID


class PartyInput(CatalogInput):
    type: Literal["CUSTOMER", "SUPPLIER", "BOTH"]
    display_name: RequiredText
    tax_id: RequiredText | None = None
    contact_name: RequiredText | None = None
    contact_email: RequiredText | None = None
    contact_phone: RequiredText | None = None


class Party(PartyInput):
    id: UUID
    organization_id: UUID


def validate_category(connection: Connection, organization_id: UUID, values: dict, _record_id):
    exists = connection.scalar(
        text("SELECT 1 FROM categories WHERE id = :id AND organization_id = :org"),
        {"id": values["category_id"], "org": organization_id},
    )
    if not exists:
        raise HTTPException(422, "Selecione uma classificação da mesma organização.")


def validate_parent(connection: Connection, organization_id: UUID, values: dict, record_id):
    parent_id = values["parent_id"]
    if parent_id is None:
        return
    ancestors = set(
        connection.scalars(
            text(
                """
                WITH RECURSIVE ancestors AS (
                    SELECT id, parent_id FROM cost_centers
                    WHERE id = :parent AND organization_id = :org
                    UNION
                    SELECT center.id, center.parent_id FROM cost_centers AS center
                    JOIN ancestors ON center.id = ancestors.parent_id
                    WHERE center.organization_id = :org
                )
                SELECT id FROM ancestors
                """
            ),
            {"parent": parent_id, "org": organization_id},
        )
    )
    if not ancestors:
        raise HTTPException(422, "Selecione um centro superior da mesma organização.")
    if record_id in ancestors:
        raise HTTPException(422, "Esse centro superior criaria um ciclo na hierarquia.")


router = APIRouter()
router.include_router(
    catalog_router(Catalog("categories", "categories", "Classificações", CategoryInput, Category))
)
router.include_router(
    catalog_router(
        Catalog(
            "subcategories",
            "subcategories",
            "Subclasses",
            SubcategoryInput,
            Subcategory,
            scope="category_id IN (SELECT id FROM categories WHERE organization_id = :org)",
            direct_organization=False,
            validate=validate_category,
        )
    )
)
router.include_router(
    catalog_router(
        Catalog(
            "cost-centers",
            "cost_centers",
            "Centros de custos",
            CostCenterInput,
            CostCenter,
            validate=validate_parent,
        )
    )
)
router.include_router(
    catalog_router(
        Catalog(
            "parties",
            "parties",
            "Clientes e fornecedores",
            PartyInput,
            Party,
            order_by="display_name",
            private_fields=frozenset(
                {"display_name", "tax_id", "contact_name", "contact_email", "contact_phone"}
            ),
        )
    )
)
