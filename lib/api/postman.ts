import { OPERATIONS } from './openapi';

/** Postman v2.1 collection generated from the same operation list as the OpenAPI document. */
const PRE_REQUEST = `// Fetches/refreshes an OAuth access token with client credentials when missing or expired.
const base = pm.collectionVariables.get('baseUrl');
const token = pm.collectionVariables.get('token');
const exp = Number(pm.collectionVariables.get('token_expires_at') || 0);
if (pm.request.url.getPath().endsWith('/oauth/token')) return;
if (pm.request.method === 'POST' && !pm.request.headers.has('Idempotency-Key')) {
  pm.request.headers.add({ key: 'Idempotency-Key', value: pm.variables.replaceIn('{{$guid}}') });
}
if (token && Date.now() < exp - 60000) return;
pm.sendRequest({
  url: base + '/api/v1/oauth/token',
  method: 'POST',
  header: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: { mode: 'urlencoded', urlencoded: [
    { key: 'grant_type', value: 'client_credentials' },
    { key: 'client_id', value: pm.collectionVariables.get('client_id') },
    { key: 'client_secret', value: pm.collectionVariables.get('client_secret') },
  ] },
}, (err, res) => {
  if (err || res.code !== 200) { console.error('Token request failed', err || res.text()); return; }
  const j = res.json();
  pm.collectionVariables.set('token', j.access_token);
  pm.collectionVariables.set('token_expires_at', String(Date.now() + j.expires_in * 1000));
});`;

const TEST_SCRIPT = `pm.test('status is 2xx', () => pm.expect(pm.response.code).to.be.within(200, 299));
if (pm.response.code === 201 && pm.response.json().data && pm.response.json().data.id) {
  pm.collectionVariables.set('last_id', pm.response.json().data.id);
}`;

const SAMPLE_VARS: Record<string, string> = { id: '{{product_id}}' };

export function buildPostman(baseUrl: string) {
  const folders = new Map<string, unknown[]>();
  for (const op of OPERATIONS) {
    const pathVar = op.path.replace(/\{(\w+)\}/g, (_m, name: string) => {
      if (op.path.startsWith('/products')) return SAMPLE_VARS[name];
      if (op.path.startsWith('/orders')) return '{{order_id}}';
      if (op.path.startsWith('/rfqs')) return '{{rfq_id}}';
      if (op.path.startsWith('/shipments')) return '{{shipment_id}}';
      if (op.path.startsWith('/webhooks')) return '{{webhook_id}}';
      return `{{${name}}}`;
    });
    const raw = `{{baseUrl}}/api/v1${pathVar}`;
    const query = (op.query ?? []).map((q) => ({ key: q.name, value: '', description: q.description, disabled: true }));
    const item = {
      name: op.summary,
      request: {
        method: op.method.toUpperCase(),
        header: [
          { key: 'Accept', value: 'application/json' },
          ...(op.body ? [{ key: 'Content-Type', value: 'application/json' }] : []),
          ...(op.method === 'post' ? [{ key: 'Idempotency-Key', value: '{{$guid}}' }] : []),
        ],
        url: { raw, host: ['{{baseUrl}}'], path: ['api', 'v1', ...pathVar.split('/').filter(Boolean)], query },
        ...(op.body ? { body: { mode: 'raw', raw: JSON.stringify(op.example ?? {}, null, 2), options: { raw: { language: 'json' } } } } : {}),
        description: `${op.summary}\n\nScopes (any of): ${op.scopes.join(', ')}`,
      },
      event: [{ listen: 'test', script: { type: 'text/javascript', exec: TEST_SCRIPT.split('\n') } }],
    };
    if (!folders.has(op.tag)) folders.set(op.tag, []);
    folders.get(op.tag)!.push(item);
  }

  const tokenItem = {
    name: 'Get access token (client credentials)',
    request: {
      method: 'POST',
      auth: { type: 'noauth' },
      header: [{ key: 'Content-Type', value: 'application/x-www-form-urlencoded' }],
      url: { raw: '{{baseUrl}}/api/v1/oauth/token', host: ['{{baseUrl}}'], path: ['api', 'v1', 'oauth', 'token'] },
      body: {
        mode: 'urlencoded',
        urlencoded: [
          { key: 'grant_type', value: 'client_credentials' },
          { key: 'client_id', value: '{{client_id}}' },
          { key: 'client_secret', value: '{{client_secret}}' },
        ],
      },
    },
    event: [
      {
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: [
            "pm.test('token issued', () => pm.response.to.have.status(200));",
            'const j = pm.response.json();',
            "pm.collectionVariables.set('token', j.access_token);",
            "pm.collectionVariables.set('token_expires_at', String(Date.now() + j.expires_in * 1000));",
          ],
        },
      },
    ],
  };

  return {
    info: {
      name: 'Octopus B2B Public API',
      _postman_id: 'b3f1c1c4-0c7a-4d38-9d1e-0c70b2b00001',
      description:
        'Set client_id (cli_…) and client_secret (an oct_test_… key) in the collection variables. A collection pre-request script fetches the bearer token automatically and adds an Idempotency-Key to POSTs.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
    event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: PRE_REQUEST.split('\n') } }],
    variable: [
      { key: 'baseUrl', value: baseUrl },
      { key: 'client_id', value: '' },
      { key: 'client_secret', value: '' },
      { key: 'token', value: '' },
      { key: 'token_expires_at', value: '0' },
      { key: 'product_id', value: '' },
      { key: 'rfq_id', value: '' },
      { key: 'order_id', value: 'ORD-2202' },
      { key: 'shipment_id', value: '' },
      { key: 'webhook_id', value: '' },
      { key: 'last_id', value: '' },
    ],
    item: [{ name: 'Auth', item: [tokenItem] }, ...[...folders].map(([name, item]) => ({ name, item }))],
  };
}
