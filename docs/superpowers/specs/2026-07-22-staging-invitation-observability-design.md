# Staging invitation contract fix and Worker observability design

**Date:** 2026-07-22  
**Status:** Approved
**Notion:** https://app.notion.com/p/3a5e5c7c2b8e81ee9e6cf9ecb72d3363

## Context

The first staging client-admin invitation consistently returns `INVALID_REQUEST`, including after the recipient email was corrected. Live Worker tails show that Operator Web accepts the browser request and invokes Identity, where the request is rejected before invitation processing.

The generated staging Wrangler configurations also do not explicitly enable persistent Cloudflare Workers Logs. This makes incident diagnosis depend on attaching a real-time tail before reproducing an issue.

## Root cause

Operator Web builds the Identity create-invitation RPC request by spreading a shared helper that adds a top-level `correlationId`. `IdentityCreateInvitationRequestSchema` is strict and accepts only `sessionId`, `selectedMerchantId`, and `input` at the top level. The correlation ID for this operation already belongs inside `input`.

A local contract reproduction confirms that the current request is rejected for the unrecognized top-level key and the same request without that key is accepted.

## Design

### Invitation request

Change only the create-invitation route so it sends:

- `sessionId` at the top level;
- `selectedMerchantId` at the top level; and
- `organizationId`, email, role, expiry, and `correlationId` inside `input`.

Do not change the shared helper because list, retry, role-change, and member-removal contracts legitimately require a top-level correlation ID.

### Staging Worker logs

Add the following explicit configuration to every generated staging Wrangler file for API, Identity, and Operator Web:

```toml
[observability]
enabled = true
head_sampling_rate = 1
```

This persists invocation, application, error, and uncaught-exception logs in Cloudflare Workers Logs at 100% head sampling. It applies only to generated staging configurations. Checked-in local Wrangler configurations remain unchanged, and tracing is not enabled by this change.

The fixed 100% rate is intentional for the current low-volume staging environment. A configurable or lower rate can be added when traffic or log cost justifies it.

## Verification

Automated regression coverage will:

1. pass the create-invitation RPC request through the strict shared contract and verify there is no extra top-level correlation ID;
2. verify all three generated staging configurations contain explicit 100% observability settings; and
3. run the relevant Operator Web, staging runner, contract, typecheck, and build checks.

After the PR is merged, the operator will redeploy API, Identity, and Operator Web. The manual staging flow will then retry the client-admin invitation and verify email delivery and acceptance. Codex will not perform the Cloudflare deployments.

## Documentation and evidence

The staging activation report will record the original failure, correlation ID, confirmed contract mismatch, automated fix verification, deployment versions supplied by the operator, and the final manual outcome. It must not contain email addresses, secrets, cookies, activation grants, or recovery codes.

## Non-goals

- Production deployment or production observability configuration.
- Cloudflare tracing, Logpush, or third-party observability export.
- Changes to invitation recipient policy or staging allowlist semantics.
- Refactoring unrelated Identity RPC request contracts.
