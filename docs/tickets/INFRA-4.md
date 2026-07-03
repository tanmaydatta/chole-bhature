# INFRA-4 · Observability

> ⚠️ Detailed from the spec — refresh from the outputs of its dependencies before starting (see "Depends on").

## Context
Spec §11 (observability: Workers logs + Sentry + basic alerts + health checks + structured request logging with merchant/program ids). Depends on INFRA-2.

## Scope
- Structured logging, Sentry integration, basic alerts, health-check endpoint(s), merchant/program-id request logging.

## Acceptance criteria
- [ ] Every request log line includes merchant id and (where applicable) program id.
- [ ] Sentry captures unhandled errors from `apps/api` in staging/production.
- [ ] A health-check endpoint exists and is monitored/alertable.
- [ ] Basic alert(s) are configured for error-rate/latency thresholds.

## Technical notes
Scope-level for now; applies across staging/production environments (INFRA-2) — dev is exempt from alerting.

## Interfaces
**Consumes:** INFRA-2 staging/production environments + secrets management (Sentry DSN).
**Produces:** structured logging, the health-check endpoint, and alerting — supports BE-18 (reliability pass) and general ops; no ticket structurally blocks on it.

## Out of scope
- Full APM/tracing (basic logs + Sentry + health checks only, per Spec §11).
- SOC 2 compliance work (posture only, deferred per Spec §2).

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
