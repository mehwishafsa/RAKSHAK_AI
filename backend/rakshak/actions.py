"""
Trusted Action Engine: turns a classified fault into a structured maintenance
action and checks it against the parts inventory. Templates are a documented
lookup table, not generated text.
"""

from __future__ import annotations

from .db import Database

ACTION_TEMPLATES: dict[str, dict] = {
    "BEARING_DEFECT": {
        "title": "Replace Bearing #3 and re-grease drive-end assembly",
        "steps": [
            "Controlled shutdown and lock-out / tag-out (LOTO) of conveyor drive",
            "Remove coupling guard and pull gearbox output bearing #3",
            "Fit new 6312-2RS bearing, re-grease, check shaft alignment",
            "Run-up test: confirm vibration RMS back below 2.3 mm/s",
        ],
        "est_hours": 3.5,
        "technicians": 2,
        "skills": ["Mechanical fitter", "Vibration technician"],
        "parts": [("BRG-6312-2RS", 1), ("GRS-LGHP2-0.4", 1), ("SEAL-OR-110", 2)],
    },
    "OVERHEATING": {
        "title": "Inspect motor cooling path and winding insulation",
        "steps": [
            "Reduce load / controlled shutdown, LOTO",
            "Replace cooling fan, clean fins and fan cowl",
            "Insulation-resistance (megger) test of stator winding",
            "Restart and confirm housing temperature trend returns to baseline",
        ],
        "est_hours": 2.0,
        "technicians": 2,
        "skills": ["Electrician", "Helper"],
        "parts": [("FAN-180M-AX", 1), ("FLT-AIR-180", 1)],
    },
    "LUBRICATION_FAULT": {
        "title": "Restore gearbox lubrication: filter change, flush & refill",
        "steps": [
            "Controlled shutdown, LOTO, drain gearbox sump",
            "Replace oil filter and pump gasket; inspect oil pump",
            "Flush and refill with ISO VG 320 gear oil",
            "Restart and confirm lube-oil pressure ≥ 2.8 bar",
        ],
        "est_hours": 2.5,
        "technicians": 2,
        "skills": ["Mechanical fitter", "Lubrication technician"],
        "parts": [("FLT-OIL-G320", 1), ("OIL-VG320", 20), ("GSK-PUMP-45", 1)],
    },
    "UNCLASSIFIED": {
        "title": "Manual inspection of flagged component",
        "steps": [
            "Field inspection of the top contributing component",
            "Record findings to refine fault rules",
        ],
        "est_hours": 1.0,
        "technicians": 1,
        "skills": ["Maintenance technician"],
        "parts": [],
    },
}

PRIORITY = {
    "CRITICAL": {"label": "Immediate", "window": "Controlled shutdown now; repair within 4 h"},
    "MEDIUM": {"label": "Planned", "window": "Schedule within the next shift (8 h)"},
    "LOW": {"label": "Routine", "window": "Next planned maintenance window"},
}


def check_inventory(db: Database, parts: list[tuple[str, float]]) -> dict:
    lines = []
    for sku, qty in parts:
        row = db.one("SELECT * FROM parts WHERE sku = ?", (sku,))
        on_hand = row["qty_on_hand"] if row else 0.0
        available = on_hand >= qty
        after = on_hand - qty if available else on_hand
        lines.append(
            {
                "sku": sku,
                "name": row["name"] if row else "Unknown part",
                "unit": row["unit"] if row else "ea",
                "required": qty,
                "on_hand": on_hand,
                "location": row["location"] if row else "—",
                "available": available,
                "shortfall": 0 if available else round(qty - on_hand, 2),
                "reorder_after_use": bool(row) and available and after < row["reorder_level"],
            }
        )
    all_ok = all(line["available"] for line in lines)
    return {"all_available": all_ok, "lines": lines}


def build_action(db: Database, fault: dict, risk: str) -> dict:
    tpl = ACTION_TEMPLATES.get(fault["code"], ACTION_TEMPLATES["UNCLASSIFIED"])
    inventory = check_inventory(db, tpl["parts"])
    return {
        "title": tpl["title"],
        "component": fault["component"],
        "component_label": fault["component_label"],
        "steps": tpl["steps"],
        "est_hours": tpl["est_hours"],
        "technicians": tpl["technicians"],
        "skills": tpl["skills"],
        "priority": PRIORITY[risk]["label"],
        "window": PRIORITY[risk]["window"],
        "inventory": inventory,
        "source": "rule template",
    }


def reserve_parts(conn, inventory: dict) -> list[dict]:
    """Decrement stock for available lines inside the caller's transaction."""
    reserved = []
    for line in inventory["lines"]:
        if not line["available"]:
            continue
        conn.execute("UPDATE parts SET qty_on_hand = qty_on_hand - ? WHERE sku = ?", (line["required"], line["sku"]))
        reserved.append({"sku": line["sku"], "qty": line["required"]})
    return reserved
