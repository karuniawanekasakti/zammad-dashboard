# The incremental sync watermark is queried as an inclusive bracketed range

An Incremental Sync asks Zammad for tickets matching
`updated_at:[<watermark> TO *]`, with the full ISO-8601 watermark as an inclusive
lower bound, rather than the more obvious `updated_at:><watermark>`.

Two properties of this Zammad instance's Elasticsearch-backed search force it:

- **A bare date is interpreted in the instance's timezone** (`Asia/Jakarta`,
  +07:00), and `>` rounds *up* to the end of that local day. A watermark dated
  "today" therefore excludes the entire current day and silently returns no rows.
  It also skips a fixed ~17-hour window every day, because the Jakarta day begins
  at 17:00Z.
- **An unescaped `:` in the query value is parsed as a `field:value` separator**,
  so any value containing `HH:MM:SS` silently matches nothing — whether or not it
  carries a `Z`/`+00:00` suffix. The suffix is not the cause; the colon is.

Bracket ranges treat their bounds literally and are inclusive, so neither failure
applies, and no ticket that changed exactly at the watermark is dropped. Upserts
make re-fetching the boundary ticket harmless.

## Consequences

Do not "simplify" this back to a `>` comparison, and do not truncate the
watermark to a date. Both forms fail silently: HTTP 200 with an empty result,
indistinguishable from "nothing changed" — which is how a stalled sync went
unnoticed while every run still reported success.
