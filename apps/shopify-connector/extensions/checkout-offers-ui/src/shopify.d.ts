import 'preact';

// The Shopify CLI normally generates shopify.d.ts with these declarations.
// This repo is a monorepo without a linked CLI project, so declare the
// web-component tags we use. Props are intentionally loose; the runtime
// validates them against the installed @shopify/ui-extensions version.
declare module 'preact' {
  namespace JSX {
    interface IntrinsicElements {
      's-stack': Record<string, unknown>;
      's-heading': Record<string, unknown>;
      's-text': Record<string, unknown>;
      's-banner': Record<string, unknown>;
      's-text-field': Record<string, unknown>;
      's-button': Record<string, unknown>;
      's-badge': Record<string, unknown>;
      's-progress': Record<string, unknown>;
    }
  }
}
