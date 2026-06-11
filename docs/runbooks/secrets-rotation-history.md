# Secrets Rotation History

**Owner:** Operations / Security

Append-only log of every production secret rotation and integration reconnect.
One entry per event, newest at the top. Referenced by
`docs/runbooks/secrets-rotation.md` (§ 3 Step 6, § 5A). **Never record the
secret value here — only the metadata.**

Entry template:

```
## YYYY-MM-DD
- Rotated / Reconnected: <secret name(s) or integration>
- Operator: <name>
- Reason: <scheduled | expiry alert (30/7 day) | suspected compromise | …>
- New expiry recorded: <YYYY-MM-DD or n/a>  (for client secrets, the *_EXPIRES_ON value set)
- Verification: <what you checked — login, dashboard, Connection Health countdown, …>
```

---

<!-- Add new rotations above this line. -->

## (no rotations logged yet)

This file was created alongside the finance-integration resilience work so the
runbook's § 6 reference resolves. The first real rotation entry goes above.
