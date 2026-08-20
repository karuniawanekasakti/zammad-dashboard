from app.routers.tickets import _map_ticket


def main() -> None:
    ticket = _map_ticket({"id": 1, "priority_case": "p02", "ticket_category": "SRSM"})
    assert ticket.severity == "p02"
    assert ticket.severity_label == "P2 - High"
    assert ticket.ticket_category == "SRSM"
    assert ticket.ticket_category_label == "Service Request Support and Management"

    ticket = _map_ticket({"id": 2, "priority_case": {"name": "BRI01"}, "ticket_category": {"value": "HSU"}})
    assert ticket.severity == "BRI01"
    assert ticket.severity_label == "BRI Critical 1 (0-30 KM)"
    assert ticket.ticket_category == "HSU"
    assert ticket.ticket_category_label == "Hardware Software Update"


if __name__ == "__main__":
    main()
