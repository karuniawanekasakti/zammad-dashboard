# Beat refreshes its schedule in place, and its clock must survive restarts

The data-driven beat scheduler updates entries with `merge_inplace`, which
preserves each entry's `last_run_at` and `total_run_count`. It deliberately does
not use `update_from_dict`, which looks like the natural choice for "reload the
schedule from Redis".

`update_from_dict` constructs fresh entries whose `last_run_at` defaults to now.
Applied on every refresh, that resets the schedule clock, so a long interval can
only come due if the scheduler runs uninterrupted for its whole period. A Full
Reconcile is scheduled every six hours, so any beat restart inside that window
pushed it permanently out of reach — which is why the safety net for a stalled
Incremental Sync had never once run.

## Consequences

The refresh path is not interchangeable with Celery's other update helpers; do
not "simplify" it back. Preserving the clock is necessary but not sufficient:
the schedule file must also outlive the container, or a recreate discards the
accumulated progress and the interval again becomes unreachable.

A long-interval schedule that depends on uninterrupted uptime is not a schedule.
Anything the dashboard relies on for self-healing must be reachable across
restarts.
