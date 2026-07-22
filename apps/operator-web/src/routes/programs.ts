import {
  OperatorProgramDraftRequestSchema,
  OperatorProgramListResponseSchema,
  OperatorProgramViewSchema,
  ProgramLifecycleSchema,
  ProgramPublicationResultSchema,
} from '@incentives/contracts';

import { EmptyBodySchema, requiredParam, type ProtectedRoute } from './types.js';

export const programRoutes: readonly ProtectedRoute[] = [
  {
    method: 'GET', pattern: /^\/operator\/v1\/programs$/u,
    permission: 'programs:read', responseSchema: OperatorProgramListResponseSchema,
    downstream: 'core',
    invoke: context => context.env.CORE.listPrograms(context.operator),
  },
  {
    method: 'POST', pattern: /^\/operator\/v1\/programs$/u,
    permission: 'programs:manage', bodySchema: OperatorProgramDraftRequestSchema,
    downstream: 'core',
    responseSchema: OperatorProgramViewSchema, status: 201,
    invoke: context => context.env.CORE.createProgramDraft(
      context.operator, OperatorProgramDraftRequestSchema.parse(context.body),
    ),
    validateOutput(value, context) {
      const output = OperatorProgramViewSchema.parse(value);
      const input = OperatorProgramDraftRequestSchema.parse(context.body);
      if (output.configuration.id !== input.id) {
        throw new Error('Program response did not match its request');
      }
    },
  },
  {
    method: 'GET', pattern: /^\/operator\/v1\/programs\/([^/]+)$/u,
    parameterNames: ['externalRef'], permission: 'programs:read',
    downstream: 'core',
    responseSchema: OperatorProgramViewSchema,
    invoke: context => context.env.CORE.getProgram(
      context.operator, requiredParam(context, 'externalRef'),
    ),
    validateOutput(value, context) {
      if (OperatorProgramViewSchema.parse(value).configuration.id !== requiredParam(context, 'externalRef')) {
        throw new Error('Program response did not match its request');
      }
    },
  },
  {
    method: 'PUT', pattern: /^\/operator\/v1\/programs\/([^/]+)$/u,
    parameterNames: ['externalRef'], permission: 'programs:manage',
    downstream: 'core',
    bodySchema: OperatorProgramDraftRequestSchema, responseSchema: OperatorProgramViewSchema,
    invoke: context => context.env.CORE.updateProgramDraft(
      context.operator,
      requiredParam(context, 'externalRef'),
      OperatorProgramDraftRequestSchema.parse(context.body),
    ),
    validateOutput(value, context) {
      if (OperatorProgramViewSchema.parse(value).configuration.id !== requiredParam(context, 'externalRef')) {
        throw new Error('Program response did not match its request');
      }
    },
  },
  {
    method: 'POST', pattern: /^\/operator\/v1\/programs\/([^/]+)\/publish$/u,
    parameterNames: ['externalRef'], permission: 'programs:publish',
    downstream: 'core',
    bodySchema: EmptyBodySchema, responseSchema: ProgramPublicationResultSchema,
    invoke: context => context.env.CORE.publishProgram(
      context.operator, requiredParam(context, 'externalRef'),
    ),
    validateOutput(value, context) {
      if (
        ProgramPublicationResultSchema.parse(value).programRef
        !== requiredParam(context, 'externalRef')
      ) throw new Error('Program response did not match its request');
    },
  },
  ...(['pause', 'resume', 'end'] as const).map(action => ({
    method: 'POST',
    pattern: new RegExp(`^/operator/v1/programs/([^/]+)/${action}$`, 'u'),
    parameterNames: ['externalRef'],
    permission: 'programs:manage' as const,
    downstream: 'core' as const,
    bodySchema: EmptyBodySchema,
    responseSchema: ProgramLifecycleSchema,
    invoke: context => action === 'pause'
      ? context.env.CORE.pauseProgram(context.operator, requiredParam(context, 'externalRef'))
      : action === 'resume'
        ? context.env.CORE.resumeProgram(context.operator, requiredParam(context, 'externalRef'))
        : context.env.CORE.endProgram(context.operator, requiredParam(context, 'externalRef')),
    validateOutput(value, context) {
      if (ProgramLifecycleSchema.parse(value).programRef !== requiredParam(context, 'externalRef')) {
        throw new Error('Program response did not match its request');
      }
    },
  } satisfies ProtectedRoute)),
];
