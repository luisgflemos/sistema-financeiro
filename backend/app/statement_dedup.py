"""Identidade de movimentos por evidência bancária, sem decisão financeira da IA."""

from collections import Counter


def classify_rows(rows, previous, decisions, repeated=False):
    tentative = {}
    for row in rows:
        candidates = previous.get(row["fingerprint"], [])
        matches = [
            item
            for item in candidates
            if item.get("signature") == row["signature"]
            and any(
                row.get(key) and row.get(key) == item.get(key)
                for key in ("previous_signature", "next_signature")
            )
        ]
        if len(matches) == 1:
            tentative[row["row"]] = matches[0]["id"]
    usage = Counter(tentative.values())
    confirmed = {number: ref for number, ref in tentative.items() if usage[ref] == 1}
    confirmed_refs = set(confirmed.values())
    result = []
    for row in rows:
        candidates = previous.get(row["fingerprint"], [])
        refs = {item["id"] for item in candidates}
        same_position = any(item.get("signature") == row["signature"] for item in candidates)
        decision = decisions.get(str(row["row"]))
        if repeated:
            status, reason = "duplicate", "Arquivo já importado para esta conta."
        elif row["row"] in confirmed:
            status, reason = (
                "duplicate",
                "Mesmo movimento confirmado pelos dados, saldo e sequência do extrato.",
            )
        elif not candidates:
            status, reason = "new", "Movimento sem correspondência anterior nesta conta."
        elif not same_position and refs <= confirmed_refs:
            status, reason = (
                "new",
                "Ocorrência adicional: as anteriores já foram localizadas neste extrato.",
            )
        elif decision == "skip":
            status, reason = "skip", "O operador confirmou que o movimento já estava importado."
        elif decision == "new":
            status, reason = "new", "O operador confirmou que é outra ocorrência do movimento."
        else:
            status, reason = (
                "review",
                "Há movimentos semelhantes, mas saldo ou sequência não confirmam a identidade.",
            )
        result.append({**row, "status": status, "reason": reason, "candidates": sorted(refs)})
    return result
