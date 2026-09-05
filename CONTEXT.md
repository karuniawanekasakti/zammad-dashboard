# Context

Domain glossary for Zammad Monitor. Terms here are the canonical meaning used
across UI, API, and sync code.

## Ticket State

A ticket's **current state** is its live Zammad state (`new`, `open`,
`pending*`, `closed`, `merged`). A ticket's **state history** is the sequence
of state transitions synced from Zammad into the `ticket_history` table.

## Open (metric)

**Open** always refers to the *state*, never to a ticket's lifetime of having
once been open. There is no "ever-open" concept anywhere in the product.

- **Open tab** (Overview records): tickets whose *current* state is exactly
  `open`, within the selected period/group/agent scope. A ticket that was open
  in the past but is now pending/closed/new does not appear.
- **Open graph** (Overview chart): for each time bucket, the number of tickets
  whose Open interval *overlaps* that bucket. A ticket open for several days
  counts on every one of those days. An interval still active is capped at
  *now*. A ticket that becomes open again counts again for its new open days.
- **Open interval**: a contiguous span during which a ticket was in state
  `open`, reconstructed from state history (`value_to == "open"` starts an
  interval; the next state change ends it). When history is unavailable, an
  approximation is used: `new` → never open; currently `open` → creation until
  now; otherwise → creation until close (or last update).

## Reopened

A **reopen event** is a state transition from `closed` to any non-closed
state (Zammad's own definition, `lib/stats/ticket_reopen.rb`), reconstructed
from state history. A ticket's `reopen_count` tracks how many times it has
been reopened.

- **Reopened graph** (Overview chart): per bucket, the number of reopen
  *events* — a ticket reopened twice counts twice.
- **Reopened tab** (Overview records): in-window tickets with
  `reopen_count > 0` — a count of *tickets*, so it can legitimately differ
  from the graph's event count.
- *Reopen rate* (KPIs, agent stats): the percentage of tickets that were
  reopened. Unrelated to the Overview tab/graph.
