import { catalogIds } from "./catalogs";
import { CatalogPage } from "./catalog-page";
import { ClassificationTree } from "./classification-tree";

type CatalogId = (typeof catalogIds)[number];

export function CatalogWorkspace({
  organizationId,
  selected,
}: {
  organizationId: string;
  selected: CatalogId;
}) {
  return (
    <div id="catalog-section">
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
  );
}
