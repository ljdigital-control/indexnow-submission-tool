import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = html.match(/<script id="app">([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'inline application script exists');

function createHarness(fetchImpl = async () => { throw new Error('unexpected fetch'); }) {
  const elements = new Map();
  const downloads = [];
  const files = [];
  class FakeBlob {
    constructor(parts, options = {}) { this.parts = parts; this.type = options.type || ''; }
  }
  class TestURL extends URL {
    static createObjectURL(blob) {
      const href = `blob:test-${files.length + 1}`;
      files.push({ blob, href });
      return href;
    }
    static revokeObjectURL() {}
  }
  class Element {
    constructor(id) {
      this.id = id;
      this.value = '';
      this.checked = false;
      this.hidden = ['requestPreview', 'result'].includes(id);
      this.disabled = ['sendRequest', 'downloadKeyFile'].includes(id);
      this.textContent = '';
      this.dataset = {};
      this.listeners = new Map();
      this.tagName = '';
      this.href = '';
      this.download = '';
    }
    click() {
      if (this.tagName === 'a') downloads.push({ href: this.href, filename: this.download });
    }
    addEventListener(type, callback) {
      const callbacks = this.listeners.get(type) || [];
      callbacks.push(callback);
      this.listeners.set(type, callbacks);
    }
    async fire(type, event = {}) {
      for (const callback of this.listeners.get(type) || []) {
        await callback({ preventDefault() {}, ...event });
      }
    }
  }
  const document = {
    createElement(tagName) {
      const element = new Element(`created-${tagName}`);
      element.tagName = tagName;
      return element;
    },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element(id));
      return elements.get(id);
    }
  };
  const context = vm.createContext({
    document,
    URL: TestURL,
    URLSearchParams,
    Blob: FakeBlob,
    crypto: { getRandomValues: array => array.fill(17) },
    fetch: fetchImpl,
    AbortController,
    setTimeout,
    clearTimeout,
    encodeURIComponent,
    navigator: { clipboard: { writeText: async () => {} } }
  });
  vm.runInContext(script, context, { filename: 'index.html:inline-script' });
  return { elements, downloads, files, get: id => document.getElementById(id) };
}

async function selectEngine(h, selected) {
  for (const id of ['bing', 'yandex', 'seznam', 'naver', 'yep', 'amazonbot']) {
    h.get(`engine-${id}`).checked = id === selected;
  }
  await h.get(`engine-${selected}`).fire('change');
}

function fillSingle(h, { urls = 'https://example.com/page', key = 'abcde123', keyLocation = '' } = {}) {
  h.get('urlList').value = urls;
  h.get('apiKey').value = key;
  h.get('keyLocation').value = keyLocation;
}

async function prepare(h) {
  await h.get('prepareForm').fire('submit');
}

async function authorize(h) {
  h.get('ownershipConfirmed').checked = true;
  await h.get('ownershipConfirmed').fire('change');
}

test('builds and downloads a key file, then prefills the site URL and request preview', async () => {
  let calls = [];
  const h = createHarness(async (...args) => { calls.push(args); return { ok: true, json: async () => ({ ok: true, status: 200, body: '' }) }; });
  h.get('siteUrl').value = 'example.com/blog/';
  await h.get('generateKey').fire('click');
  const key = h.get('apiKey').value;
  assert.match(key, /^[A-Za-z0-9]{32}$/);
  assert.equal(h.get('keyLocation').value, `https://example.com/${key}.txt`);
  assert.equal(h.get('urlList').value, 'https://example.com/');
  assert.equal(h.files.length, 1);
  assert.equal(h.files[0].blob.type, 'text/plain;charset=utf-8');
  assert.equal(h.files[0].blob.parts.join(''), key, 'the downloaded UTF-8 text file contains only the key');
  assert.deepEqual(h.downloads, [{ href: 'blob:test-1', filename: `${key}.txt` }]);
  assert.equal(h.get('requestPreview').hidden, false);
  assert.equal(h.get('methodPill').textContent, 'GET');
  assert.match(h.get('bodyPreview').textContent, new RegExp(`key=${key}`));
  assert.match(h.get('bodyPreview').textContent, new RegExp(`keyLocation=${encodeURIComponent(h.get('keyLocation').value)}`));
  assert.match(h.get('curlPreview').textContent, new RegExp(key));
  assert.equal(h.get('endpointUrl').textContent, 'https://www.bing.com/indexnow');
  assert.equal(h.get('ownershipConfirmed').checked, false);
  assert.equal(h.get('sendRequest').disabled, true);
  assert.equal(calls.length, 0, 'generating and preparing never sends a notification');
});

test('preserves the entered domain and refreshes only generated key-file and homepage autofills', async () => {
  const h = createHarness();
  h.get('siteUrl').value = 'https://www.example.com/blog/';
  await h.get('generateKey').fire('click');
  const key = h.get('apiKey').value;
  assert.equal(h.get('keyLocation').value, `https://www.example.com/${key}.txt`);
  assert.equal(h.get('urlList').value, 'https://www.example.com/');

  h.get('siteUrl').value = 'https://shop.example.net/catalog';
  await h.get('siteUrl').fire('input');
  assert.equal(h.get('keyLocation').value, `https://shop.example.net/${key}.txt`);
  assert.equal(h.get('urlList').value, 'https://shop.example.net/');

  h.get('keyLocation').value = 'https://shop.example.net/custom/key.txt';
  h.get('urlList').value = 'https://shop.example.net/changed-page';
  h.get('siteUrl').value = 'https://www.example.org/';
  await h.get('siteUrl').fire('input');
  assert.equal(h.get('keyLocation').value, 'https://shop.example.net/custom/key.txt');
  assert.equal(h.get('urlList').value, 'https://shop.example.net/changed-page');
});

test('rejects a local host before creating a key file or preparing a request', async () => {
  const h = createHarness();
  h.get('siteUrl').value = 'http://localhost:3000';
  await h.get('generateKey').fire('click');
  assert.equal(h.files.length, 0);
  assert.equal(h.downloads.length, 0);
  assert.equal(h.get('requestPreview').hidden, true);
  assert.match(h.get('resultMessage').textContent, /publicly reachable website URL/i);
});

test('single URL prepares RFC3986 GET and sends only after explicit confirmation and click', async () => {
  let calls = [];
  const h = createHarness(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ ok: true, status: 200, body: 'accepted' }) };
  });
  fillSingle(h, { urls: 'https://example.com/new page?q=a&b=c#fragment' });
  await prepare(h);
  assert.equal(h.get('requestPreview').hidden, false);
  assert.equal(h.get('methodPill').textContent, 'GET');
  assert.equal(calls.length, 0, 'preparing does not submit');
  assert.equal(h.get('sendRequest').disabled, true, 'site-owner confirmation is required');
  await authorize(h);
  assert.equal(h.get('sendRequest').disabled, false);
  await h.get('sendRequest').fire('click');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/submit');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.credentials, 'same-origin');
  const submission = JSON.parse(calls[0].options.body);
  assert.equal(submission.engine, 'bing');
  assert.equal(submission.urls[0], 'https://example.com/new%20page?q=a&b=c');
  assert.equal(submission.key, 'abcde123');
  assert.equal(submission.keyLocation, 'https://example.com/abcde123.txt');
  assert.equal(h.get('resultTitle').textContent, 'Request received (200)');
  assert.match(h.get('resultMessage').textContent, /does not mean.*indexed/i);
  assert.equal(h.get('sendRequest').disabled, true, 'a second send requires preparing again');
});

test('offers verified active participant endpoints', async () => {
  const endpoints = {
    bing: 'https://www.bing.com/indexnow',
    yandex: 'https://yandex.com/indexnow',
    seznam: 'https://search.seznam.cz/indexnow',
    naver: 'https://searchadvisor.naver.com/indexnow',
    yep: 'https://indexnow.yep.com/indexnow',
    amazonbot: 'https://indexnow.amazonbot.amazon/indexnow'
  };
  for (const [id, endpoint] of Object.entries(endpoints)) {
    const h = createHarness();
    await selectEngine(h, id);
    fillSingle(h);
    await prepare(h);
    assert.equal(h.get('endpointUrl').textContent, endpoint);
    assert.ok(h.get('bodyPreview').textContent.startsWith(endpoint), `${id} GET request uses the selected participant endpoint`);
  }
});

test('batch builds the documented JSON POST and enforces a subdirectory key scope', async () => {
  let calls = [];
  const h = createHarness(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ ok: true, status: 202, body: 'pending validation' }) };
  });
  await selectEngine(h, 'yandex');
  fillSingle(h, {
    urls: 'https://example.com/catalog/a\nhttp://example.com/catalog/b?x=1',
    keyLocation: 'https://example.com/catalog/key.txt'
  });
  await prepare(h);
  assert.equal(h.get('methodPill').textContent, 'POST');
  assert.equal(h.get('urlCount').textContent, '2 URLs');
  assert.equal(calls.length, 0);
  await authorize(h);
  await h.get('sendRequest').fire('click');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/submit');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json; charset=utf-8');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.engine, 'yandex');
  assert.equal(body.key, 'abcde123');
  assert.equal(body.keyLocation, 'https://example.com/catalog/key.txt');
  assert.deepEqual(Array.from(body.urls), ['https://example.com/catalog/a', 'http://example.com/catalog/b?x=1']);
  assert.match(h.get('resultTitle').textContent, /202/);
  assert.match(h.get('resultMessage').textContent, /validation is pending/i);
});

test('rejects invalid key, mixed hosts, out-of-scope paths, and more than 10,000 URLs', async () => {
  const h = createHarness();
  fillSingle(h, { key: 'short' });
  await prepare(h);
  assert.match(h.get('resultMessage').textContent, /8–128/);
  assert.equal(h.get('result').hidden, false, 'validation errors stay visible outside the hidden request preview');
  assert.equal(h.get('requestPreview').hidden, true);

  fillSingle(h, { urls: 'https://example.com/a\nhttps://other.example/b' });
  await prepare(h);
  assert.match(h.get('resultMessage').textContent, /same host/i);

  fillSingle(h, { urls: 'https://example.com/catalog/a\nhttps://example.com/outside', keyLocation: 'https://example.com/catalog/key.txt' });
  await prepare(h);
  assert.match(h.get('resultMessage').textContent, /outside that path/i);

  fillSingle(h, { urls: Array.from({ length: 10001 }, (_, i) => `https://example.com/${i}`).join('\n') });
  await prepare(h);
  assert.match(h.get('resultMessage').textContent, /no more than 10,000/);
});

test('deduplicates URLs and invalidates a prepared request if input changes', async () => {
  const h = createHarness();
  fillSingle(h, { urls: 'https://example.com/a#one\nhttps://example.com/a#two\nhttps://example.com/b' });
  await prepare(h);
  assert.equal(h.get('urlCount').textContent, '2 URLs');
  await authorize(h);
  assert.equal(h.get('sendRequest').disabled, false);
  h.get('urlList').value += '\nhttps://example.com/c';
  await h.get('urlList').fire('input');
  assert.equal(h.get('requestPreview').hidden, true);
  assert.equal(h.get('sendRequest').disabled, true);
  await prepare(h);
  await authorize(h);
  await selectEngine(h, 'naver');
  assert.equal(h.get('requestPreview').hidden, true, 'changing the destination invalidates the prepared request');
  assert.equal(h.get('endpointUrl').textContent, 'https://searchadvisor.naver.com/indexnow');
});

test('reports same-origin service/network failures as unconfirmed rather than success', async () => {
  const h = createHarness(async () => { throw new TypeError('Failed to fetch'); });
  fillSingle(h);
  await prepare(h);
  await authorize(h);
  await h.get('sendRequest').fire('click');
  assert.match(h.get('resultTitle').textContent, /could not confirm/i);
  assert.match(h.get('resultMessage').textContent, /unconfirmed/i);
  assert.equal(h.get('result').dataset.kind, 'error');
});
