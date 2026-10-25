import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const root = path.dirname(fileURLToPath(import.meta.url));
const maxUrls = 10000;
const maxRequestBytes = 5 * 1024 * 1024;
const engines = Object.freeze({
  bing: 'https://www.bing.com/indexnow',
  yandex: 'https://yandex.com/indexnow',
  seznam: 'https://search.seznam.cz/indexnow',
  naver: 'https://searchadvisor.naver.com/indexnow',
  yep: 'https://indexnow.yep.com/indexnow',
  amazonbot: 'https://indexnow.amazonbot.amazon/indexnow'
});

function parseHttpUrl(raw, label) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error(`${label} must be a valid HTTP(S) URL.`);
  let url;
  try { url = new URL(raw.trim()); } catch { throw new Error(`${label} must be an absolute HTTP(S) URL.`); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`${label} must use HTTP or HTTPS.`);
  if (url.username || url.password) throw new Error(`${label} must not contain a username or password.`);
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error(`${label} must not use a local hostname.`);
  }
  url.hash = '';
  return url;
}

function normalizeSubmission(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid submission payload.');
  const endpoint = Object.hasOwn(engines, input.engine) ? engines[input.engine] : null;
  if (!endpoint) throw new Error('Choose a supported IndexNow endpoint.');
  const key = typeof input.key === 'string' ? input.key.trim() : '';
  if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) throw new Error('The key must be 8–128 characters and contain only letters, numbers, or hyphens.');
  if (!Array.isArray(input.urls) || input.urls.length === 0 || input.urls.length > maxUrls) {
    throw new Error('Provide between 1 and 10,000 URLs.');
  }
  const parsed = input.urls.map((raw, index) => parseHttpUrl(raw, `URL ${index + 1}`));
  const urls = [...new Map(parsed.map(url => [url.href, url.href])).values()];
  if (urls.length > maxUrls) throw new Error('A request can contain no more than 10,000 unique URLs.');
  const host = new URL(urls[0]).host.toLowerCase();
  const mismatch = urls.find(value => new URL(value).host.toLowerCase() !== host);
  if (mismatch) throw new Error('All submitted URLs must use the same host.');

  let keyLocation;
  try { keyLocation = new URL(input.keyLocation); } catch { throw new Error('Enter a valid absolute key-file URL.'); }
  if (keyLocation.protocol !== 'http:' && keyLocation.protocol !== 'https:') throw new Error('The key file must use HTTP or HTTPS.');
  if (keyLocation.username || keyLocation.password) throw new Error('The key-file URL must not contain a username or password.');
  if (keyLocation.host.toLowerCase() !== host) throw new Error('The key file must be hosted on the same host as every submitted URL.');
  if (keyLocation.search || keyLocation.hash) throw new Error('The key-file URL must not include a query string or fragment.');
  if (keyLocation.pathname.endsWith('/') || !/\.txt$/i.test(keyLocation.pathname)) throw new Error('The key-file URL must point to a .txt file.');
  const directory = keyLocation.pathname.slice(0, keyLocation.pathname.lastIndexOf('/') + 1) || '/';
  if (urls.some(value => !new URL(value).pathname.startsWith(directory))) {
    throw new Error(`The key file only authorizes URLs under ${directory}.`);
  }
  const method = urls.length === 1 ? 'GET' : 'POST';
  const body = method === 'POST'
    ? { host, key, keyLocation: keyLocation.href, urlList: urls }
    : null;
  return { engine: input.engine, endpoint, method, host, key, keyLocation: keyLocation.href, urls, body };
}

export function validateSubmission(input) {
  try { return normalizeSubmission(input); }
  catch (error) {
    if (!error.statusCode) error.statusCode = 400;
    throw error;
  }
}

export function curlArguments(submission) {
  const args = [
    '--silent', '--show-error', '--connect-timeout', '5', '--max-time', '15',
    '--proto', '=https', '--write-out', '\n%{http_code}'
  ];
  if (submission.method === 'GET') {
    args.push('--get', '--data-urlencode', `url=${submission.urls[0]}`,
      '--data-urlencode', `key=${submission.key}`,
      '--data-urlencode', `keyLocation=${submission.keyLocation}`,
      submission.endpoint);
  } else {
    args.push('--request', 'POST', '--header', 'Content-Type: application/json; charset=utf-8',
      '--data-binary', JSON.stringify(submission.body), submission.endpoint);
  }
  return args;
}

async function runSubmission(submission) {
  const { stdout } = await execFileAsync('curl', curlArguments(submission), {
    encoding: 'utf8', timeout: 17000, maxBuffer: 64 * 1024, windowsHide: true
  });
  const match = stdout.match(/\n(\d{3})$/);
  if (!match) throw new Error('The IndexNow endpoint returned no HTTP status.');
  const status = Number(match[1]);
  return { status, ok: status >= 200 && status < 300, body: stdout.slice(0, match.index).slice(0, 4000) };
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(body);
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
    const error = new Error('Content-Type must be application/json.');
    error.statusCode = 415;
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRequestBytes) {
      const error = new Error('Submission payload is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch {
    const error = new Error('Request body must contain valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

export function createAppServer({ submit = runSubmission } = {}) {
  return createHttpServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/api/submit') {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        sendJson(response, 405, { error: 'Use POST to submit an IndexNow notification.' });
        return;
      }
      try {
        const input = await readJson(request);
        const submission = validateSubmission(input);
        const result = await submit(submission);
        sendJson(response, 200, result);
      } catch (error) {
        const status = error.statusCode || 502;
        sendJson(response, status, { error: status === 502 ? 'The IndexNow endpoint could not be reached or did not return a readable status.' : error.message });
      }
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      response.writeHead(405).end();
      return;
    }
    if (pathname !== '/' && pathname !== '/index.html') {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(path.join(root, 'index.html')).pipe(response);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || '127.0.0.1';
  createAppServer().listen(port, host, () => console.log(`IndexNow tool listening at http://${host}:${port}`));
}
