# The watermark is anchored to when the ticket fetch began, not the run's finish

Both sync kinds advance the watermark to absorb the ticket search/write race: a
ticket changed between the search snapshot and the watermark write would
otherwise be missed by every subsequent run. The window is given a small
deliberate overlap (`WATERMARK_OVERLAP_SECONDS`), so the next run re-fetches the
boundary. Re-fetching is harmless because every ticket write is an upsert.

Both kinds anchor that overlap to the moment their **ticket fetch began** — not
the moment the run finished:

- A managed run stamps `watermark_at` when it enters its `fetching_tickets`
  phase; a standalone run captures the same instant as `fetch_started_at`.
- A **Full Reconcile** fetches every ticket up front and then spends the bulk of
  its run syncing per-ticket history, so finish-minus-overlap can be tens of
  minutes after the fetch. **Incremental Sync** is usually short, but it also
  syncs per-ticket history after fetching and its window can stretch, so it uses
  the same anchor rather than relying on the run being quick.

Anchoring to the finish skips every ticket changed between the fetch and the
finish, permanently — the change is older than the next window's lower bound.

This was not theoretical: after a Full Reconcile that finished at 08:13 having
fetched tickets at 07:48, four tickets changed at 08:10–08:12 were left behind,
because the watermark advanced to the finish with no overlap and the following
incremental window began after them.

## Consequences

Do not "simplify" the watermark back to a run's `finished_at`. A correct
watermark is bounded by the earliest moment its data could be stale — the fetch
start — not by when the run happened to end. An operation recorded before the
`watermark_at` stamp existed falls back to its `finished_at` rather than
raising into the sync path. The `check_sla_staleness` self-check asserts no
sampled row is left behind Zammad, which is what surfaced this;
`check_sync_telemetry` pins the anchor for both kinds and the legacy fallback.
