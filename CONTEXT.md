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

## SLA Monitoring

**Authorized scope** is the ticket population the signed-in role may access before any dashboard filter is applied: administrators see all synchronized tickets, agents see their own tickets, and team leads or project managers see tickets in their assigned groups.

An **active ticket** is currently `new`, `open`, or `pending`. A **monitored ticket** is an active ticket with an actionable SLA deadline. An active ticket without one is labeled **No active SLA deadline** (`no_sla`).

A ticket's **live SLA status** is its SLA verdict evaluated from the ticket's own current facts and the present moment. It is the only authoritative verdict, and it is the one every surface shows.
_Avoid_: current status, real-time status

A ticket's **stored SLA status** is the verdict that was recorded for the ticket at the moment it was last synchronized. It is a snapshot rather than a verdict: stale by construction, and never presented as a ticket's current status.
_Avoid_: cached status, saved status

The **actionable deadline** is Zammad's current escalation deadline, or otherwise the next unsatisfied milestone deadline. A completed first-response milestone is not actionable.

**Warning** means the deadline is at most two hours away; **Critical** means it is at most 30 minutes away. **At-Risk** is Warning plus Critical. **Breached** means the actionable deadline passed or synchronized breach evidence exists; later milestones do not erase that evidence.

**Current compliance** is `(monitored - breached) / monitored`; Warning and Critical remain compliant until breach, and the rate is undefined when there are no monitored tickets. An **SLA-evidenced terminal outcome** is a terminal (`closed` or `merged`) ticket for which Zammad retained at least one evaluated milestone result: any missed milestone makes the outcome breached, otherwise it is closed on time. **Historical compliance** uses only these outcomes in the selected authorized group and priority scope.

## Synchronization

**Data freshness** describes whether the synchronized dataset has a successful
checkpoint within its promised cadence. It is **Never Synced**, **Up to Date**,
or **Out of Date**; when freshness cannot be established, it is **Status
Unavailable**.

**Sync execution** describes current work independently from Data freshness. It
is **Idle**, **Queued**, **Running Incremental Sync**, or **Running Full
Reconcile**.

The **Latest sync attempt** is the retained outcome and evidence for the newest
synchronization attempt. A completed attempt is **Succeeded**, **Failed**, or
**Interrupted**.

An **Incremental Sync** refreshes records changed since the successful
checkpoint. An **Automatic Incremental Sync** is an Incremental Sync requested
without administrator action when the dataset is Out of Date. A **Full
Reconcile** establishes or refreshes the complete synchronized dataset.

The **sync watermark** is the point in time from which an Incremental Sync looks
for changed tickets. It advances only after a run completes successfully, and it
is the lower bound of the next run's window.

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
