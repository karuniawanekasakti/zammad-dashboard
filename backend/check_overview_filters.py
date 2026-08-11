"""Assert overview period bucket ranges and ticket filters."""
from types import SimpleNamespace

from app.routers.tickets import _apply_ticket_filters, _overview_buckets

assert len(_overview_buckets("year", 2026)) == 12
assert _overview_buckets("month", 2026, month=2)[-1]["label"] == "28"
assert [b["label"] for b in _overview_buckets("week", 2026, week="2026-W33")] == ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
assert len(_overview_buckets("day", 2026, day="2026-08-11")) == 24

rows = [
    SimpleNamespace(id="1", group_id="g1", owner_id="a1"),
    SimpleNamespace(id="2", group_id="g1", owner_id="a2"),
    SimpleNamespace(id="3", group_id="g2", owner_id="a1"),
]
assert [t.id for t in _apply_ticket_filters(rows, group_id="g1")] == ["1", "2"]
assert [t.id for t in _apply_ticket_filters(rows, owner_id="a1")] == ["1", "3"]
assert [t.id for t in _apply_ticket_filters(rows, group_id="g1", owner_id="a1")] == ["1"]

print("overview filter checks passed")
