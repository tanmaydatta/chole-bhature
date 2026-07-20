import { expect, test } from 'vitest';
import editor from './promo/LivePromoEditor.tsx?raw';
import builder from '../components/builder/ConditionBuilder.tsx?raw';
import localTypes from '../lib/types.ts?raw';

test('live Promo authoring imports canonical condition reward and lifecycle wire types without bridge casts', () => {
  expect(editor).not.toMatch(/from ['"]\.\.\/\.\.\/lib\/types['"]/u);
  expect(editor).not.toMatch(/\bas ConditionGroup\b/u);
  expect(builder).toMatch(/from ['"]@incentives\/contracts['"]/u);
  expect(localTypes).not.toMatch(/export interface (?:Condition|NestedConditionGroup|ConditionGroup)\b/u);
});
