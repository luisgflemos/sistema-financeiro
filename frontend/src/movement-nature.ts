export function categoryNature(direction: string, treatment = "NORMAL") {
  if (treatment === "AUTOMATIC_PROCESS") return null;
  if (treatment === "INTERNAL_TRANSFER") return "NEUTRAL";
  return direction === "CREDIT" ? "REVENUE" : "EXPENSE";
}
