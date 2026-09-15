# SLA status is computed on read, never stored

Ticket SLA status is derived on every read from Zammad's own SLA facts
(`escalation_at`, milestone deadlines, and the milestone diffs) together with
the current time. It is never persisted and never served from a stored column.

## Considered Options

- **Compute on read** (chosen): the verdict is always consistent with the row it
  describes and with the moment it is read.
- **Store the verdict on the synced row**: what the dashboard did before. Because
  the SLA Monitor recomputed while the ticket detail page rendered the stored
  value, one ticket displayed two contradictory verdicts — `Breached` on one page
  and `On Track` on the other — from the same underlying row.
- **Store the verdict plus a `computed_at` stamp, recomputing on read**: keeps a
  redundant field that every future reader must remember not to trust.

## Consequences

Every surface that shows SLA status goes through the one shared computation. A
stored `sla_status` or remaining-time value is not a source of truth, and a
time-relative field must never be rendered as though it were live.

Because a live verdict is only as trustworthy as the ticket's own freshness, SLA
surfaces must also expose Data freshness — otherwise a stale verdict is
indistinguishable from a current one.
