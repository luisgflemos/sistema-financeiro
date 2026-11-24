import { useState } from "react";
import { TransactionsPage } from "./transactions-page";
import { PlanningPage } from "./planning-page";

export function TransactionsWorkspace({
  organizationId,
}: {
  organizationId: string;
}) {
  const [tab, setTab] = useState("import");
  return (
    <>
      <div
        className="transaction-tabs"
        role="tablist"
        aria-label="Áreas de Transações"
      >
        {[
          ["import", "Importar Extrato"],
          ["history", "Histórico"],
          ["planning", "Lançamentos"],
        ].map(([value, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === value}
            aria-controls="transaction-section"
            id={"transaction-tab-" + value}
            key={value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id="transaction-section"
        role="tabpanel"
        aria-labelledby={"transaction-tab-" + tab}
      >
        {tab === "planning" ? (
          <PlanningPage organizationId={organizationId} />
        ) : (
          <TransactionsPage
            key={tab}
            organizationId={organizationId}
            mode={tab as "import" | "history"}
          />
        )}
      </div>
    </>
  );
}
