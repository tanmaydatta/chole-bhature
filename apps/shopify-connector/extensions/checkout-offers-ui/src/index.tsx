import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { Extension } from './Extension.js';

export * from './Extension.js';
export * from './extension-utils.js';

export default function extension(): void {
  render(<Extension />, document.body);
}
