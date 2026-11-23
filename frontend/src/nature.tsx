export const natureLabels: Record<string, string> = {
  REVENUE: "Receita",
  EXPENSE: "Despesa",
  NEUTRAL: "Neutra",
};

export function NatureBadge({ value }: { value: string }) {
  if (!natureLabels[value]) return <>—</>;
  return (
    <span className={`nature nature-${value}`}>{natureLabels[value]}</span>
  );
}
