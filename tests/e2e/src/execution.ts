import {
  ApiCredentialCreateInputSchema,
  ApiCredentialCreateResultSchema,
  ApiCredentialViewSchema,
  ClientProvisioningViewSchema,
  CustomerRecordSchema,
  E2eRunProofSchema,
  E2eFixtureAccountSchema,
  OperatorProgramViewSchema,
  OperatorTeamResponseSchema,
  PromoProgramSchema,
  ProgramPublicationResultSchema,
  SchemaPublicationResultSchema,
  SchemaDefinitionViewSchema,
  VariableDefinitionSchema,
} from '@incentives/contracts';

import { runScoped, type Target } from './config.js';
import { recordResource, type Manifest, type Resource } from './manifest.js';
import { recipeInputs, type RecipeName } from './recipes.js';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RecipeContext {
  manifest: Manifest;
  target: Target;
  operator: { request(method: Method, path: string, body?: unknown): Promise<unknown> };
  save(): Promise<void>;
  saveToken(slug: string, token: string): Promise<void>;
  getOrCreateProof?(): Promise<string>;
  saveMemberCookie?(slug: string, cookieHeader: string): Promise<void>;
  verifyMemberSession?(input: { cookieHeader: string; membershipId: string;
    userId: string; merchantId: string; role: 'admin' | 'operator' | 'viewer' }): Promise<void>;
  selectedMerchantId?: string;
}

function merchant(ctx: RecipeContext): Resource {
  const value = ctx.manifest.resources.find(resource => resource.kind === 'merchant');
  if (!value) throw new Error('Recipe requires add-merchant in this run');
  if (value.status !== 'active') throw new Error('Run merchant is unavailable');
  return value;
}

async function selectMerchant(ctx: RecipeContext, merchantId: string): Promise<void> {
  if (ctx.selectedMerchantId === merchantId) return;
  await ctx.operator.request('POST', '/operator/v1/platform/merchant-selection', { merchantId });
  ctx.selectedMerchantId = merchantId;
}

async function ensureMerchant(ctx: RecipeContext): Promise<Resource> {
  const value = merchant(ctx);
  await selectMerchant(ctx, value.id);
  return value;
}

function existing(ctx: RecipeContext, kind: Resource['kind'], id: string): Resource | undefined {
  return ctx.manifest.resources.find(resource => resource.kind === kind && resource.id === id);
}

function claimedRun(ctx: RecipeContext): boolean {
  return ctx.target.kind === 'staging'
    || (ctx.target.kind === 'local' && process.env.E2E_MANAGED_LOCAL_STACK === '1');
}

function assertRunEmail(ctx: RecipeContext, email: string): void {
  if (!email.toLowerCase().startsWith(`e2e+${ctx.manifest.runId}_`)) {
    throw new Error(`E2E email must use e2e+${ctx.manifest.runId}_<slug> at an approved mailbox domain`);
  }
}

async function fixtureAccount(
  ctx: RecipeContext, input: { slug: string; role: 'admin' | 'operator' | 'viewer' },
): Promise<unknown> {
  if (ctx.target.kind !== 'staging') {
    throw new Error('Run-scoped fixture account creation is staging-only; local email auth is covered by Identity tests');
  }
  if (!ctx.getOrCreateProof || !ctx.saveMemberCookie || !ctx.verifyMemberSession) {
    throw new Error('Staging fixture account requires durable proof, private cookie storage, and signed-session verification');
  }
  const owner = await ensureMerchant(ctx);
  const proof = await ctx.getOrCreateProof();
  const output = E2eFixtureAccountSchema.parse(await ctx.operator.request(
    'POST', `/operator/v1/platform/e2e-runs/${ctx.manifest.runId}/accounts`,
    { proof, slug: input.slug, role: input.role },
  ));
  const email = `e2e+${ctx.manifest.runId}_${input.slug}@e2e.invalid`;
  if (output.runId !== ctx.manifest.runId || output.merchantId !== owner.id
    || output.organizationId !== owner.organizationId || output.email !== email
    || output.role !== input.role) {
    throw new Error('Fixture account crossed the E2E run boundary');
  }
  const prior = existing(ctx, 'membership', output.membershipId);
  if (prior) {
    if (prior.userId !== output.userId || prior.email !== output.email) {
      throw new Error('Fixture membership changed identity on retry');
    }
    prior.sessionId = output.sessionId;
  } else {
    recordResource(ctx.manifest, { kind: 'membership', id: output.membershipId,
      ownerRunId: ctx.manifest.runId, merchantId: owner.id,
      organizationId: output.organizationId, userId: output.userId,
      sessionId: output.sessionId,
      label: runScoped(ctx.manifest.runId, `member_${input.slug}`), email });
  }
  await ctx.save();
  await ctx.saveMemberCookie(input.slug, output.cookieHeader);
  await ctx.verifyMemberSession({ cookieHeader: output.cookieHeader,
    membershipId: output.membershipId, userId: output.userId,
    merchantId: output.merchantId, role: output.role });
  const { cookieHeader: _cookieHeader, ...safe } = output;
  return safe;
}

export async function executeRecipe(ctx: RecipeContext, name: RecipeName, rawInput: unknown): Promise<unknown> {
  switch (name) {
    case 'add-merchant': {
      const input = recipeInputs[name].parse(rawInput);
      const prior = ctx.manifest.resources.find(resource => resource.kind === 'merchant');
      if (prior) {
        if (prior.status === 'error') {
          if (!prior.provisioningId) throw new Error('Failed merchant lacks a provisioning ID');
          const e2eRun = claimedRun(ctx)
            ? E2eRunProofSchema.parse({ runId: ctx.manifest.runId,
              proof: await (ctx.getOrCreateProof?.()
                ?? Promise.reject(new Error('Staging retry requires durable run proof storage'))) })
            : undefined;
          const retried = ClientProvisioningViewSchema.parse(await ctx.operator.request(
            'POST', `/operator/v1/platform/provisionings/${encodeURIComponent(prior.provisioningId)}/retry`,
            e2eRun ? { e2eRun } : {},
          ));
          if (retried.merchantId !== prior.id || retried.provisioningId !== prior.provisioningId) {
            throw new Error('Merchant retry response crossed the run boundary');
          }
          if (retried.status !== 'active') {
            throw new Error(`Merchant provisioning is ${retried.status}; inspect provisioning ${retried.provisioningId}`);
          }
          prior.status = 'active';
          prior.organizationId = retried.organizationId ?? undefined;
          delete prior.cleanupError;
          await ctx.save();
          await selectMerchant(ctx, prior.id);
          return retried;
        }
        await selectMerchant(ctx, prior.id);
        return prior;
      }
      const label = runScoped(ctx.manifest.runId, 'merchant');
      const e2eRun = claimedRun(ctx)
        ? E2eRunProofSchema.parse({
          runId: ctx.manifest.runId,
          proof: await (ctx.getOrCreateProof?.()
            ?? Promise.reject(new Error('Staging provisioning requires durable run proof storage'))),
        })
        : undefined;
      const output = ClientProvisioningViewSchema.parse(await ctx.operator.request(
        'POST', '/operator/v1/platform/clients',
        { name: `${label} ${input.name}`, idempotencyKey: label,
          ...(e2eRun ? { e2eRun } : {}) },
      ));
      recordResource(ctx.manifest, {
        kind: 'merchant', id: output.merchantId, label,
        ownerRunId: ctx.manifest.runId, provisioningId: output.provisioningId,
        organizationId: output.organizationId ?? undefined,
        status: output.status === 'active' ? 'active' : 'error',
      });
      await ctx.save();
      if (output.status !== 'active') throw new Error(`Merchant provisioning is ${output.status}
        at ${output.failedStep ?? 'unknown step'} (retryable=${output.retryable}); inspect provisioning ${output.provisioningId}`);
      await selectMerchant(ctx, output.merchantId);
      return output;
    }
    case 'add-user': return fixtureAccount(ctx, recipeInputs[name].parse(rawInput));
    case 'add-admin': return fixtureAccount(ctx, { ...recipeInputs[name].parse(rawInput), role: 'admin' });
    case 'set-role': {
      const input = recipeInputs[name].parse(rawInput);
      const owner = await ensureMerchant(ctx);
      const team = OperatorTeamResponseSchema.parse(await ctx.operator.request('GET', '/operator/v1/team'));
      const member = team.members.find(item => item.id === input.membershipId);
      if (!member || member.organizationId !== owner.organizationId) {
        throw new Error('Membership does not belong to this run merchant');
      }
      assertRunEmail(ctx, member.email);
      if (!existing(ctx, 'membership', member.id)) {
        recordResource(ctx.manifest, {
          kind: 'membership', id: member.id, ownerRunId: ctx.manifest.runId,
          merchantId: owner.id, organizationId: member.organizationId,
          label: runScoped(ctx.manifest.runId, 'member'), email: member.email,
        });
        await ctx.save();
      }
      return ctx.operator.request('PATCH', `/operator/v1/team/members/${encodeURIComponent(member.id)}`,
        { role: input.role });
    }
    case 'add-schema': {
      const input = recipeInputs[name].parse(rawInput);
      const owner = await ensureMerchant(ctx);
      const label = runScoped(ctx.manifest.runId, input.slug);
      const key = `${input.definition.source}.${label}`;
      const definition = VariableDefinitionSchema.parse({ ...input.definition, key });
      const definitions = await ctx.operator.request('GET', '/operator/v1/schema/definitions');
      const list = (definitions as { definitions?: unknown[] }).definitions;
      const prior = Array.isArray(list)
        ? list.map(item => SchemaDefinitionViewSchema.parse(item)).find(item => item.definition.key === key)
        : undefined;
      const output = prior ?? SchemaDefinitionViewSchema.parse(await ctx.operator.request(
        'POST', '/operator/v1/schema/definitions', definition,
      ));
      if (!existing(ctx, 'schema', output.id)) {
        recordResource(ctx.manifest, { kind: 'schema', id: output.id,
          ownerRunId: ctx.manifest.runId, merchantId: owner.id, label, schemaKey: key });
        await ctx.save();
      }
      const published = SchemaPublicationResultSchema.parse(await ctx.operator.request(
        'POST', '/operator/v1/schema/publish', {},
      ));
      return { definition: output, publishedVersion: published.version };
    }
    case 'add-customer': {
      const input = recipeInputs[name].parse(rawInput);
      const owner = await ensureMerchant(ctx);
      const id = runScoped(ctx.manifest.runId, input.slug);
      const output = CustomerRecordSchema.parse(await ctx.operator.request(
        'PATCH', `/operator/v1/customers/${encodeURIComponent(id)}`,
        { attributes: input.attributes },
      ));
      if (output.externalRef !== id) throw new Error('Customer response crossed the run boundary');
      if (!existing(ctx, 'customer', id)) {
        recordResource(ctx.manifest, { kind: 'customer', id, ownerRunId: ctx.manifest.runId,
          merchantId: owner.id });
        await ctx.save();
      }
      return output;
    }
    case 'create-api-credential': {
      const input = recipeInputs[name].parse(rawInput);
      const owner = await ensureMerchant(ctx);
      const label = runScoped(ctx.manifest.runId, input.slug);
      const current = ApiCredentialViewSchema.array().parse(await ctx.operator.request('GET', '/operator/v1/credentials'));
      if (current.some(item => item.name === label)) {
        throw new Error('A credential with this run label already exists; revoke it before retrying creation');
      }
      const payload = ApiCredentialCreateInputSchema.parse({
        name: label, kind: input.kind, environment: ctx.target.kind, scopes: input.scopes,
        ...(input.kind === 'publishable'
          ? { allowedOrigins: input.allowedOrigins ?? [ctx.target.operatorOrigin] }
          : {}),
      });
      const output = ApiCredentialCreateResultSchema.parse(await ctx.operator.request(
        'POST', '/operator/v1/credentials', payload,
      ));
      if (output.credential.merchantId !== owner.id || output.credential.name !== label) {
        throw new Error('Credential response crossed the run boundary');
      }
      recordResource(ctx.manifest, { kind: 'credential', id: output.credential.id,
        ownerRunId: ctx.manifest.runId, merchantId: owner.id, label });
      await ctx.save();
      await ctx.saveToken(input.slug, output.token);
      return { credential: output.credential, token: output.token };
    }
    case 'add-promo': {
      const input = recipeInputs[name].parse(rawInput);
      const owner = await ensureMerchant(ctx);
      const id = runScoped(ctx.manifest.runId, input.slug);
      const program = PromoProgramSchema.parse({
        ...input.program, id, name: `${id} ${input.program.name}`.slice(0, 200), status: 'draft',
        ...(input.program.autoApply ? {} : { code: id.toUpperCase() }),
      });
      const prior = existing(ctx, 'promo', id);
      const output = OperatorProgramViewSchema.parse(await ctx.operator.request(
        prior ? 'GET' : 'POST',
        prior ? `/operator/v1/programs/${encodeURIComponent(id)}` : '/operator/v1/programs',
        prior ? undefined : program,
      ));
      if (output.configuration.id !== id) throw new Error('Promo response crossed the run boundary');
      if (!prior) {
        recordResource(ctx.manifest, { kind: 'promo', id, ownerRunId: ctx.manifest.runId,
          merchantId: owner.id, label: id });
        await ctx.save();
      }
      return output;
    }
    case 'publish-promo': {
      const input = recipeInputs[name].parse(rawInput);
      await ensureMerchant(ctx);
      const id = runScoped(ctx.manifest.runId, input.slug);
      if (!existing(ctx, 'promo', id)) throw new Error('Recipe requires add-promo for this run');
      const current = OperatorProgramViewSchema.parse(await ctx.operator.request(
        'GET', `/operator/v1/programs/${encodeURIComponent(id)}`,
      ));
      if (current.lifecycle.status === 'active') return current.lifecycle;
      return ProgramPublicationResultSchema.parse(await ctx.operator.request(
        'POST', `/operator/v1/programs/${encodeURIComponent(id)}/publish`, {},
      ));
    }
    case 'cleanup-run': throw new Error('Use the cleanup-run command with its dry-run and manifest safeguards');
  }
}
