"""Cliente específico primeiro; grupo só quando a loja não é distinguível."""

import re
from app.historical_parser import normalize
from app.payer_links import payer_key, payer_name


def resolve_customer(history, target, catalogs, documents):
    if target.get("direction") not in (None, "CREDIT"):
        return {}
    parties = {
        str(p["id"]): p for p in catalogs.get("parties", []) if p.get("active", True)
    }
    groups = {
        str(g["id"]): g
        for g in catalogs.get("customer_groups", [])
        if g.get("active", True)
    }

    def specific(identifier, basis):
        return {"party_id": identifier, "customer_group_id": None, "basis": basis}

    if str(target.get("party_id")) in parties:
        return specific(str(target["party_id"]), "selected_client")
    description = str(target.get("raw_description", ""))
    doc = {
        str(i)
        for d in re.findall(r"(?<!\d)\d{11,14}(?!\d)", description)
        for i in documents.get(d, [])
        if str(i) in parties
    }
    if len(doc) == 1:
        return specific(next(iter(doc)), "unique_document")
    key = payer_key(payer_name(description))
    related = [
        r
        for r in history
        if r.get("movement_kind") == "NORMAL"
        and r.get("direction") == "CREDIT"
        and payer_key(payer_name(str(r.get("raw_description", "")))) == key
        and (
            not target.get("id")
            or str(r.get("source_transaction_id")) != str(target["id"])
        )
    ]
    clients = {
        str(r["party_id"])
        for r in related
        if r.get("party_id") and str(r["party_id"]) in parties
    }
    explicit_groups = {
        str(r["customer_group_id"])
        for r in related
        if r.get("customer_group_id") and str(r["customer_group_id"]) in groups
    }
    if len(clients) == 1 and not explicit_groups and len(doc) <= 1:
        return specific(next(iter(clients)), "confirmed_payer_client")
    text = " " + normalize(description) + " "
    named = {
        i
        for i, p in parties.items()
        if len(normalize(p["name"]).split()) >= 2
        and " " + normalize(p["name"]) + " " in text
    }
    if len(named) == 1 and not doc and not explicit_groups and len(clients) <= 1:
        return specific(next(iter(named)), "unique_client_name")
    candidates = doc or clients or named
    if len(candidates) > 1:
        memberships = {
            str(parties[i].get("customer_group_id") or "") for i in candidates
        }
        if len(memberships) == 1 and "" not in memberships:
            explicit_groups |= memberships
        else:
            return {"ambiguous": True}
    if not explicit_groups and str(target.get("customer_group_id")) in groups:
        explicit_groups.add(str(target["customer_group_id"]))
    if len(explicit_groups) == 1:
        group = next(iter(explicit_groups))
        if group in groups and all(
            str(parties[i].get("customer_group_id")) == group for i in clients
        ):
            return {
                "party_id": None,
                "customer_group_id": group,
                "basis": "shared_payer_group",
            }
    return {"ambiguous": bool(candidates or explicit_groups)}


def prioritize_customer(item, identity, catalogs):
    result = dict(item)
    if identity.get("party_id"):
        result.update(party_id=identity["party_id"], customer_group_id=None)
    elif identity.get("customer_group_id"):
        result.update(party_id=None, customer_group_id=identity["customer_group_id"])
    elif identity.get("ambiguous"):
        result.update(party_id=None, customer_group_id=None)
    elif result.get("party_id"):
        # A inferência generativa não pode escolher uma filial sem evidência específica.
        party = next(
            (
                p
                for p in catalogs.get("parties", [])
                if str(p["id"]) == str(result["party_id"])
            ),
            None,
        )
        if party and party.get("customer_group_id"):
            result.update(party_id=None, customer_group_id=None)
        else:
            result["customer_group_id"] = None
    return result
