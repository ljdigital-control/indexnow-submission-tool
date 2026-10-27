// Server-side IndexNow submitter for serverless hosts (e.g. Vercel) where the
// `curl` binary is not guaranteed. Mirrors curlArguments(): fixed official
// endpoint, HTTPS only, no redirects followed, 15 s budget, 4 KB body cap.

export function fetchRequest(submission) {
  if (submission.method === 'GET') {
    const url = new URL(submission.endpoint);
    url.searchParams.set('url', submission.urls[0]);
    url.searchParams.set('key', submission.key);
    url.searchParams.set('keyLocation', submission.keyLocation);
    return { url: url.href, init: { method: 'GET' } };
  }
  return {
    url: submission.endpoint,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(submission.body)
    }
  };
}

export async function submitWithFetch(submission, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const { url, init } = fetchRequest(submission);
  if (new URL(url).protocol !== 'https:') throw new Error('IndexNow endpoints must use HTTPS.');
  const response = await fetchImpl(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text().catch(() => '');
  return { status: response.status, ok: response.status >= 200 && response.status < 300, body: text.slice(0, 4000) };
}
