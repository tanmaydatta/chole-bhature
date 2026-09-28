import {
  ApiCredentialViewSchema,
  OperatorProgramViewSchema,
  OperatorTeamResponseSchema,
  SchemaDefinitionsResponseSchema,
} from '@incentives/contracts';

import { ApiFailure } from './operator-client.js';
import type { Manifest, Resource } from './manifest.js';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface Context {
  manifest: Manifest;
  operator: { request(method: Method, path: string, body?: unknown): Promise<unknown> };
}

function ownedMerchant(manifest: Manifest): Resource {
  const merchant = manifest.resources.find(item => item.kind === 'merchant');
  if (!merchant) throw new Error('Run manifest has no merchant');
  return merchant;
}

function assertOwned(ctx: Context, resource: Resource): void {
  const merchant = ownedMerchant(ctx.manifest);
  if (resource.ownerRunId !== ctx.manifest.runId) throw new Error('Resource belongs to a foreign run');
  if (resource.kind !== 'merchant' && resource.merchantId !== merchant.id) {
    throw new Error('Resource belongs to a foreign merchant');
  }
  if (
    !resource.id.startsWith(`${ctx.manifest.runId}_`)
    && !resource.label?.startsWith(`${ctx.manifest.runId}_`)
  ) throw new Error('Resource lacks run-scoped provenance');
}

export async function cleanupOperatorResource(
  ctx: Context,
  resource: Resource,
): Promise<'cleaned' | 'retained'> {
  assertOwned(ctx, resource);
  switch (resource.kind) {
    case 'credential': {
      const list = ApiCredentialViewSchema.array().parse(
        await ctx.operator.request('GET', '/operator/v1/credentials'),
      );
      const credential = list.find(item => item.id === resource.id);
      if (!credential) return 'cleaned';
      if (credential.merchantId !== resource.merchantId || credential.name !== resource.label) {
        throw new Error('Credential ownership mismatch');
      }
      if (credential.status === 'active') {
        await ctx.operator.request('DELETE', `/operator/v1/credentials/${encodeURIComponent(resource.id)}`);
      }
      const after = ApiCredentialViewSchema.array().parse(
        await ctx.operator.request('GET', '/operator/v1/credentials'),
      ).find(item => item.id === resource.id);
      if (after && after.status === 'active') throw new Error('Credential remains active after revoke');
      return after ? 'retained' : 'cleaned';
    }
    case 'promo': {
      let raw: unknown;
      try {
        raw = await ctx.operator.request('GET', `/operator/v1/programs/${encodeURIComponent(resource.id)}`);
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 404) return 'cleaned';
        throw error;
      }
      const program = OperatorProgramViewSchema.parse(raw);
      if (
        program.configuration.id !== resource.id
        || !program.configuration.name.startsWith(`${ctx.manifest.runId}_`)
      ) throw new Error('Promo ownership mismatch');
      if (program.lifecycle.status === 'draft') return 'retained';
      if (program.lifecycle.status !== 'ended') {
        await ctx.operator.request('POST',
          `/operator/v1/programs/${encodeURIComponent(resource.id)}/end`, {});
      }
      const after = OperatorProgramViewSchema.parse(await ctx.operator.request(
        'GET', `/operator/v1/programs/${encodeURIComponent(resource.id)}`,
      ));
      if (after.lifecycle.status !== 'ended') throw new Error('Promo remains available after end');
      return 'retained';
    }
    case 'schema': {
      const list = SchemaDefinitionsResponseSchema.parse(await ctx.operator.request(
        'GET', '/operator/v1/schema/definitions',
      ));
      const definition = list.definitions.find(item => item.id === resource.id);
      if (!definition) return 'cleaned';
      if (
        definition.definition.key !== resource.schemaKey
        || !definition.definition.key.endsWith(`.${resource.label}`)
      ) throw new Error('Schema ownership mismatch');
      try {
        await ctx.operator.request('DELETE',
          `/operator/v1/schema/definitions/${encodeURIComponent(resource.id)}`);
      } catch (error) {
        if (!(error instanceof ApiFailure) || error.status !== 409) throw error;
        await ctx.operator.request('POST',
          `/operator/v1/schema/definitions/${encodeURIComponent(resource.id)}/deprecate`, {});
        return 'retained';
      }
      const after = SchemaDefinitionsResponseSchema.parse(await ctx.operator.request(
        'GET', '/operator/v1/schema/definitions',
      ));
      if (after.definitions.some(item => item.id === resource.id)) {
        throw new Error('Schema remains after delete');
      }
      return 'cleaned';
    }
    case 'membership': {
      const team = OperatorTeamResponseSchema.parse(await ctx.operator.request('GET', '/operator/v1/team'));
      const member = team.members.find(item => item.id === resource.id);
      if (!member) return 'cleaned';
      if (
        member.email !== resource.email
        || !member.email.startsWith(`e2e+${ctx.manifest.runId}_`)
        || member.organizationId !== resource.organizationId
      ) throw new Error('Membership ownership mismatch');
      if (member.status === 'active') {
        await ctx.operator.request('DELETE',
          `/operator/v1/team/members/${encodeURIComponent(resource.id)}`);
      }
      const after = OperatorTeamResponseSchema.parse(await ctx.operator.request('GET', '/operator/v1/team'));
      if (after.members.some(item => item.id === resource.id && item.status === 'active')) {
        throw new Error('Membership remains active after removal');
      }
      return 'retained';
    }
    case 'customer':
    case 'merchant':
    case 'invitation':
    case 'evaluation':
    case 'redemption':
      return 'retained';
  }
}
