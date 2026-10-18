import { lstat, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { request } from '@playwright/test';
import { E2eControlAccountSchema, OperatorSessionViewSchema, type E2eControlAccount } from '@incentives/contracts';
import type { Target } from './config.js';
import { verifyFixtureMemberSession } from './operator-client.js';
import { privateDirectory } from './control-client.js';
export async function publishMemberState(target: Target, raw: E2eControlAccount, path: string): Promise<string> {
  try {
    const account = E2eControlAccountSchema.parse(raw), url = new URL(target.operatorOrigin), attrs = account.cookieAttributes;
    if (target.kind !== 'local' || url.origin !== target.operatorOrigin || url.protocol !== 'http:' || !url.port || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || attrs.secure || attrs.expiresAt <= Date.now() || account.cookieHeader.split(';').length !== 1 || !account.cookieHeader.startsWith(attrs.name + '='))
      throw Error();
    await privateDirectory(dirname(path));
    await verifyFixtureMemberSession(target, account);
    const state = { cookies: [{ name: attrs.name, value: account.cookieHeader.slice(attrs.name.length + 1), domain: url.hostname, path: '/',
          httpOnly: true, secure: attrs.secure, sameSite: 'Lax' as const, expires: Math.floor(attrs.expiresAt / 1000) }], origins: [] };
    const context = await request.newContext({ baseURL: target.operatorOrigin, storageState: state, extraHTTPHeaders: { origin: target.operatorOrigin } });
    try {
      const response = await context.get('/operator/v1/session', { maxRedirects: 0, failOnStatusCode: false });
      if (!response.ok())
        throw Error();
      const session = OperatorSessionViewSchema.parse(await response.json());
      if (session.userId !== account.userId || session.membershipId !== account.membershipId || session.merchantId !== account.merchantId
        || session.organizationId !== account.organizationId || session.platformRole !== undefined || session.merchantSelectionRequired
        || session.authenticationMethods.length !== 1 || session.authenticationMethods[0] !== 'e2e-fixture' || attrs.expiresAt <= Date.now())
        throw Error();
      const file = await open(path, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify(state) + '\n');
        await file.sync();
      }
      finally {
        await file.close();
      }
      const info = await lstat(path);
      if (!info.isFile() || (info.mode & 0o777) !== 0o600)
        throw Error();
      return path;
    }
    finally {
      await context.dispose();
    }
  }
  catch {
    throw new Error('Local preauth member state refused');
  }
}
