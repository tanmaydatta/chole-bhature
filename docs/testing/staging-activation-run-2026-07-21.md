# Staging activation run — 2026-07-21

**Status:** In progress — invitation fix awaiting merge and operator redeployment

**Notion:** https://app.notion.com/p/3a5e5c7c2b8e81739dfed75f998e6489

## Environment

- API health: Pass (`GET /v1/health` returned 200 with `{ "status": "ok" }`)
- Operator origin: Pass (dashboard loaded over HTTPS)
- Identity exposure: Pass (private Worker was not publicly reachable)
- Product/Auth migrations: Pass (no pending migrations after activation)
- Persisted Worker logs: Pending redeployment of the generated 100% observability config

## Completed manual checks

- Root activation grant exchange: Pass
- Root passkey registration and sign-in: Pass
- Recovery codes displayed and stored by the operator: Pass; values not recorded
- Client provisioning: Pass for two active staging clients
- Root client selection and refresh persistence: Pass for both clients

## Invitation incident

- Result before fix: Fail
- Safe response: HTTP 400, `INVALID_REQUEST`, non-retryable
- Correlation: `3d718b24-0ed9-4801-b5e5-a00f458f4f9d`
- Reproduction: the failure remained after correcting the recipient email
- Boundary evidence: Operator Web accepted the browser body and invoked Identity; Identity rejected the create-invitation RPC before invitation processing
- Root cause: an extra top-level `correlationId` violated strict `IdentityCreateInvitationRequestSchema`; the valid correlation ID already belonged inside `input`
- Code resolution: Pending merge and Operator Web redeployment

## Remaining manual continuation

1. Redeploy API, Identity, and Operator Web after merge so all three persist 100% of staging logs.
2. Retry the client-admin invitation for an allowlisted recipient.
3. Confirm the invitation is listed as sent/pending and the email arrives.
4. Accept the invitation in a fresh browser profile and complete magic-link sign-in.
5. Continue role enforcement, schema, customer, Promo evaluation, redemption, retry, and exhaustion checks from the non-technical guide.

## Evidence policy

Do not add recipient addresses, secrets, cookies, links containing tokens, activation grants, or recovery-code text.
