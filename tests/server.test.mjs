import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer, curlArguments, validateSubmission } from '../server.mjs';

const single = {
  engine: 'bing',
  key: 'abcde123',
  keyLocation: 'https://www.example.com/abcde123.txt',
  urls: ['https://www.example.com/page?q=one#section']
};

test('validates a single URL and builds a fixed-endpoint curl GET without shell interpolation', () => {
  const submission = validateSubmission(single);
  assert.equal(submission.method, 'GET');
  assert.equal(submission.host, 'www.example.com');
  assert.deepEqual(submission.urls, ['https://www.example.com/page?q=one']);
  const args = curlArguments(submission);
  assert.equal(args.at(-1), 'https://www.bing.com/indexnow');
  assert.equal(args.includes('--get'), true);
  assert.equal(args.includes('url=https://www.example.com/page?q=one'), true);
  assert.equal(args.includes('--proto'), true);
  assert.equal(args.includes('=https'), true);
  assert.throws(() => validateSubmission({ ...single, engine: 'constructor' }), /supported IndexNow endpoint/i);
  assert.throws(() => validateSubmission({ ...single, engine: '__proto__' }), /supported IndexNow endpoint/i);
});

test('validates batch scope and emits the documented IndexNow JSON payload', () => {
  const submission = validateSubmission({
    ...single,
    engine: 'yandex',
    keyLocation: 'https://www.example.com/catalog/key.txt',
    urls: ['https://www.example.com/catalog/a', 'https://www.example.com/catalog/b']
  });
  assert.equal(submission.method, 'POST');
  assert.deepEqual(submission.body, {
    host: 'www.example.com',
    key: 'abcde123',
    keyLocation: 'https://www.example.com/catalog/key.txt',
    urlList: ['https://www.example.com/catalog/a', 'https://www.example.com/catalog/b']
  });
  const args = curlArguments(submission);
  assert.equal(args.at(-1), 'https://yandex.com/indexnow');
  assert.equal(args.includes(JSON.stringify(submission.body)), true);
  assert.equal(submission.endpoint, 'https://yandex.com/indexnow');
});

test('same-origin API validates before calling the injected submitter and never reaches a real endpoint', async t => {
  const received = [];
  const server = createAppServer({
    submit: async submission => {
      received.push(submission);
      return { status: 202, ok: true, body: 'accepted' };
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/api/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(single)
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 202, ok: true, body: 'accepted' });
  assert.equal(received.length, 1);
  assert.equal(received[0].endpoint, 'https://www.bing.com/indexnow');

  const invalid = await fetch(`${origin}/api/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...single, engine: 'https://attacker.example/' })
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /supported IndexNow endpoint/i);
  assert.equal(received.length, 1, 'invalid payloads never reach the submitter');
});
