import { defineConfig } from '@playwright/test';
import legacy from './playwright.config.js';
if (process.env.E2E_PREAUTH_LOCAL_FLOW !== '1' || process.env.E2E_TARGET !== 'local')
  throw new Error('Preauth config is explicit local-only');
export default defineConfig({ ...legacy, globalSetup: undefined,
  projects: legacy.projects?.filter(project => project.name === 'browser').map(project => ({ ...project, testMatch: '**/promo.browser.spec.ts' })),
});
