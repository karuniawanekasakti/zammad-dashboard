# Context

Domain glossary for Zammad Monitor. Terms here are the canonical meaning used
across UI, API, and sync code.

## Ticket State

A ticket's **current state** is its live Zammad state (`new`, `open`,
`pending*`, `closed`, `merged`). A ticket's **state history** is the sequence
of state transitions synced from Zammad into the `ticket_history` table.

## Open (metric)

**Open** has two distinct, intentionally different meanings on the Overview:

- **Open graph** (Overview chart): for each time bucket, the number of tickets
  *created* in that bucket (`zammad_created_at`). Identical bucketing to
  Created/Closed, NOT a cumulative overlap of a ticket's open lifetime.
- **Open tab** (Overview records): tickets whose *current* state is exactly
  `open`, within the selected period window scope (and group/agent scope). A
  ticket created in the window but now closed/pending/new does not appear.

The chart's Open line (per-period creations) and the Open tab (currently-open
tickets) therefore count different sets by design.

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

## Release

A **release** is an immutable, annotated Git tag on the `master` branch named
`vX.Y.Z` (Semantic Versioning). It is the only unit of deployment: production
is never deployed from a branch, only from a release. The tag name *is* the
version — there is no separate version file to keep in sync.

## Deploy

A **deploy** is the act of making the production server run exactly the code
of one release: the server checks out the release's tag and builds and starts
the containers from it. It is *triggered* by creating the release on GitHub
and *executed* by the GitHub Actions runner on the server. A deploy is
**healthy** when the dashboard's health endpoint answers; it **fails** when
any step errors or the health check times out, and a failed deploy must leave
the previously running version serving traffic.

## Rollback

A **rollback** is a deploy of an earlier release. There is no special undo
mechanism: to roll back, re-run the deploy workflow for the previous tag.
