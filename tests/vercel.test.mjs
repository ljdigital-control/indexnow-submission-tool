import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubmitHandler } from '../api/submit.mjs';
import { fetchRequest, submitWithFetch } from '../lib/fetch-submit.mjs';
import { validateSubmission } from '../server.mjs';

const single = {
  engine: 'bing',
  key: 'abcde123',
  keyLocation: 'https://www.example.com/abcde123.txt',
  urls: ['https://www.example.com/page?q=one#section']
};

const post = body => new Request('https://tool.example/api/submit', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body)
});

test('Vercel route validates before calling the injected submitter', async () => {
  const received = [];
  const handle = createSubmitHandler({ submit: async s => { received.push(s); return { status: 202, ok: true, body: 'accepted' }; } });

  const ok = await handle(post(single));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { status: 202, ok: true, body: 'accepted' });
  assert.equal(received[0].endpoint, 'https://www.bing.com/indexnow');

  const badEngine = await handle(post({ ...single, engine: 'https://attacker.example/' }));
  assert.equal(badEngine.status, 400);
  assert.match((await badEngine.json()).error, /supported IndexNow endpoint/i);

  const badKey = await handle(post({ ...single, key: 'x' }));
  assert.equal(badKey.status, 400);

  const badJson = await handle(post('{nope'));
  assert.equal(badJson.status, 400);

  const wrongType = await handle(new Request('https://tool.example/api/submit', { method: 'POST', body: 'a=b', headers: { 'content-type': 'text/plain' } }));
  assert.equal(wrongType.status, 415);

  const get = await handle(new Request('https://tool.example/api/submit'));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');

  assert.equal(received.length, 1, 'invalid payloads never reach the submitter');
});

test('fetch submitter builds the documented GET/POST requests without following redirects', async () => {
  const getReq = fetchRequest(validateSubmission(single));
  const u = new URL(getReq.url);
  assert.equal(u.origin + u.pathname, 'https://www.bing.com/indexnow');
  assert.equal(u.searchParams.get('url'), 'https://www.example.com/page?q=one');
  assert.equal(u.searchParams.get('keyLocation'), 'https://www.example.com/abcde123.txt');

  const batch = validateSubmission({ ...single, urls: ['https://www.example.com/a', 'https://www.example.com/b'] });
  const calls = [];
  const result = await submitWithFetch(batch, {
    fetchImpl: async (url, init) => { calls.push([url, init]); return new Response('', { status: 202 }); }
  });
  assert.deepEqual(result, { status: 202, ok: true, body: '' });
  assert.equal(calls[0][0], 'https://www.bing.com/indexnow');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].redirect, 'manual');
  assert.deepEqual(JSON.parse(calls[0][1].body).urlList, ['https://www.example.com/a', 'https://www.example.com/b']);
});
