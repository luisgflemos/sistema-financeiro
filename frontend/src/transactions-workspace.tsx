import { TransactionsPage } from "./transactions-page";
import { PlanningPage } from "./planning-page";
import { BankBalancesPage } from "./bank-balances-page";

export function TransactionsWorkspace({
  organizationId,
  view,
}: {
  organizationId: string;
  view: "import" | "history" | "planning" | "balances";
}) {
  return (
    <div id="transaction-section">
      {view === "balances" ? (
        <BankBalancesPage organizationId={organizationId} />
      ) : view === "planning" ? (
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
