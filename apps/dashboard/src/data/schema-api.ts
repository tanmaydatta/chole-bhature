import { bffClient } from '../lib/bff-client';

export const schemaApi = {
  list: () => bffClient.schemaDefinitions(),
  published: () => bffClient.publishedSchema(),
  create: bffClient.createSchemaDefinition,
  update: bffClient.updateSchemaDefinition,
  remove: bffClient.deleteSchemaDefinition,
  deprecate: bffClient.deprecateSchemaDefinition,
  impact: bffClient.schemaDefinitionImpact,
  publish: bffClient.publishSchema,
};
