import { TransactionsPage } from "./transactions-page";
import { PlanningPage } from "./planning-page";

export function TransactionsWorkspace({
  organizationId,
  view,
}: {
  organizationId: string;
  view: "import" | "history" | "planning";
}) {
  return (
    <div id="transaction-section">
      {view === "planning" ? (
        <PlanningPage organizationId={organizationId} />
      ) : (
        <TransactionsPage
          key={view}
          organizationId={organizationId}
          mode={view}
        />
      )}
    </div>
  );
}
