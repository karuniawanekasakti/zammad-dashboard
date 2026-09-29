# Session-bound JWTs, and revocation checked when a connection opens

Sessions are revoked by a short-lived lookup on every authenticated request and
on every new WebSocket connection, and the hidden internal surface is gated on
authentication alone.

A session identifier is carried in the JWT and resolved on each request; a token
whose session is revoked is rejected with `401`. The alternative — a JWT that is
valid until it expires — means "force logout" is not a real operation: up to
eight hours of access survives revocation, and the hidden surface cannot honestly
claim to have ended a session it only marked. The lookup is deliberately cheap
and cached, in keeping with the existing hot-cache pattern.

Revocation is checked **when a request arrives or a WebSocket connection
opens**, never against connections already established. A revoked session's
open socket keeps receiving fan-out until the client reconnects; the WebSocket
path carries no session state to evict. This is accepted rather than solved:
evicting live sockets would require the API instance holding a connection to
learn about a revocation made elsewhere, which the current design has no channel
for.

## Considered Options

- **Session-bound JWT, checked per request** (chosen): revocation takes effect
  on the next request, and every HTTP surface enforces the same rule.
- **Stateless JWT until expiry**: what the PRD describes (an eight-hour token).
  Rejected — a "revoked" session that still works is worse than no revoke
  control, because the UI reports a state the backend does not hold.
- **Role-gating the internal surface**: rejected deliberately. The surface is
  *hidden, not privileged*: its endpoints are unadvertised (absent from the
  OpenAPI schema, an unobvious path namespace) but require only a valid login.

## Consequences

**Obscurity is not authorization between authenticated users.** On a
single-user deployment "hidden" and "authorized" coincide; the moment there is a
second authenticated user, any of them can reach the hidden surface directly by
URL, and hiding it from the schema does not stop them. The surface exposes the
session list and activity history to any authenticated user, so it must not be
treated as an admin-only boundary until it is actually role-gated.

The current single-user assumption covers several of the design decisions above:
any authenticated user can already see themselves in the session list, so
hard-gating the surface would add friction without adding protection today.
That assumption must be revisited, not inherited, when the auth model grows a
second user.

Retention for the two session tables is **deferred**: the growth is small on a
single-user install, the PRD's 30-day cleanup worker is not wired to these
tables, and no cleanup task is being built now. The consequence is unbounded
growth until that job exists — acceptable here, but the tables should not be
assumed to be pruned.
