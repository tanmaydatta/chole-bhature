import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const api = 'https://cb-e2e-1dcb45133da23b01d244-api.fixture.workers.dev';
const operator = 'https://cb-e2e-1dcb45133da23b01d244-operator.fixture.workers.dev';

// External transport alone is replaced: real TLS, HTTP, APIRequestContext and
// Chromium Route.fetch/fulfill still deliver headers to independent receivers.
export async function localTransport() {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-access-fixture-'));
  const keyPath = join(directory, 'key.pem');
  const certPath = join(directory, 'cert.pem');
  let emergencyClose = () => {};
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=fixture.invalid'],
    { stdio: 'ignore' });
    const receipts: { host: string; path: string; id?: string; secret?: string }[] = [];
    const sockets = new Set<Duplex>();
    const foreign = 'https://foreign.example';
    const tls = createHttpsServer({ key: await readFile(keyPath), cert: await readFile(certPath) },
      (incoming, outgoing) => {
        receipts.push({ host: incoming.headers.host ?? '', path: incoming.url ?? '',
          id: incoming.headers['cf-access-client-id'] as string | undefined,
          secret: incoming.headers['cf-access-client-secret'] as string | undefined });
        if (incoming.url === '/redirect-foreign' || incoming.url === '/redirect-same') {
          outgoing.writeHead(302, { location: incoming.url === '/redirect-foreign'
            ? `${foreign}/destination` : `${operator}/destination` });
          outgoing.end();
        } else if (incoming.url === '/page') {
          outgoing.setHeader('content-type', 'text/html');
          outgoing.end(`<html><body><script src="/asset.js"></script></body></html>`);
        } else if (incoming.url === '/asset.js') {
          outgoing.setHeader('content-type', 'application/javascript');
          outgoing.end(`Promise.allSettled([fetch('${api}/subrequest'),fetch('${foreign}/subrequest')])
            .then(()=>{document.body.dataset.done='yes'});`);
        } else {
          outgoing.setHeader('access-control-allow-origin', '*');
          outgoing.end('fixture response');
        }
      });
    const proxy = createHttpServer((_incoming, outgoing) => { outgoing.writeHead(403); outgoing.end(); });
    emergencyClose = () => {
      for (const socket of sockets) socket.destroy();
      tls.closeAllConnections(); proxy.closeAllConnections(); tls.close(); proxy.close();
    };
    const allowed = new Set([`${new URL(api).hostname}:443`, `${new URL(operator).hostname}:443`,
      'foreign.example:443']);
    await new Promise<void>((resolve, reject) => {
      tls.once('error', reject); tls.listen(0, '127.0.0.1', resolve);
    });
    const tlsAddress = tls.address();
    if (!tlsAddress || typeof tlsAddress === 'string') throw new Error('Missing TLS fixture port');
    proxy.on('connect', (incoming, client, head) => {
      if (!allowed.has(incoming.url ?? '')) { client.destroy(); return; }
      const upstream = connect(tlsAddress.port, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(client); client.pipe(upstream);
      });
      sockets.add(upstream); sockets.add(client);
      upstream.on('error', () => client.destroy()); client.on('error', () => upstream.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve);
    });
    const proxyAddress = proxy.address();
    if (!proxyAddress || typeof proxyAddress === 'string') throw new Error('Missing proxy fixture port');
    const transport = { proxy: { server: `http://127.0.0.1:${proxyAddress.port}` }, ignoreHTTPSErrors: true };
    return { receipts, transport, async close() {
      for (const socket of sockets) socket.destroy();
      tls.closeAllConnections(); proxy.closeAllConnections();
      await Promise.all([new Promise<void>(resolve => tls.close(() => resolve())),
        new Promise<void>(resolve => proxy.close(() => resolve()))]);
      await rm(directory, { recursive: true, force: true });
    } };
  } catch (error) { emergencyClose(); await rm(directory, { recursive: true, force: true }); throw error; }
}
