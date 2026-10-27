// Vercel serverless route: POST /api/submit
// Same validation and response contract as the /api/submit route in server.mjs,
// but forwards with server-side fetch instead of the curl binary.
import { validateSubmission } from '../server.mjs';
import { submitWithFetch } from '../lib/fetch-submit.mjs';

const maxRequestBytes = 5 * 1024 * 1024;
const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

const json = (status, value, extra = {}) =>
  new Response(JSON.stringify(value), { status, headers: { ...jsonHeaders, ...extra } });

export function createSubmitHandler({ submit = submitWithFetch } = {}) {
  return async function handle(request) {
    if (request.method !== 'POST') {
      return json(405, { error: 'Use POST to submit an IndexNow notification.' }, { Allow: 'POST' });
    }
    try {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
        const error = new Error('Content-Type must be application/json.');
        error.statusCode = 415;
        throw error;
      }
      const declared = Number(request.headers.get('content-length') || 0);
      const raw = await request.text();
      if (declared > maxRequestBytes || Buffer.byteLength(raw) > maxRequestBytes) {
        const error = new Error('Submission payload is too large.');
        error.statusCode = 413;
        throw error;
      }
      let input;
      try { input = JSON.parse(raw); }
      catch {
        const error = new Error('Request body must contain valid JSON.');
        error.statusCode = 400;
        throw error;
      }
      const submission = validateSubmission(input);
      return json(200, await submit(submission));
    } catch (error) {
      const status = error.statusCode || 502;
      return json(status, {
        error: status === 502 ? 'The IndexNow endpoint could not be reached or did not return a readable status.' : error.message
      });
    }
  };
}

const handler = createSubmitHandler();
export const POST = handler;
export const GET = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
