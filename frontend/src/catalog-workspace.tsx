import { catalogIds, catalogs } from "./catalogs";
import { CatalogPage } from "./catalog-page";
import { ClassificationTree } from "./classification-tree";

type CatalogId = (typeof catalogIds)[number];

export function CatalogWorkspace({
  organizationId,
  selected,
  onSelect,
}: {
  organizationId: string;
  selected: CatalogId;
  onSelect: (id: CatalogId) => void;
}) {
  return (
    <>
      <div
        className="transaction-tabs"
        role="tablist"
        aria-label="Áreas de Cadastros"
      >
        {catalogIds.map((id) => (
          <button
            type="button"
            key={id}
            role="tab"
            id={"catalog-tab-" + id}
            aria-selected={selected === id}
            aria-controls="catalog-section"
            onClick={() => onSelect(id)}
          >
            {catalogs[id].label}
          </button>
        ))}
      </div>
      <div
        id="catalog-section"
        role="tabpanel"
        aria-labelledby={"catalog-tab-" + selected}
      >
        {selected === "categories" ? (
          <ClassificationTree
            key={organizationId}
            organizationId={organizationId}
          />
        ) : (
          <CatalogPage
            key={organizationId + "/" + selected}
            id={selected}
            organizationId={organizationId}
          />
        )}
      </div>
    </>
  );
}
