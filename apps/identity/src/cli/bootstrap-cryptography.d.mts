export function randomBootstrapSecret(): string;
export function sha256Hex(value: string | Uint8Array): Promise<string>;
export function deriveBootstrapGrant(
  authSecret: string,
  flowId: string,
  initiatingCodeHash: string,
): Promise<string>;
