# IndexNow Key Builder & URL Submission Tool

A responsive IndexNow key builder and URL notifier. The interface is in `index.html`; the small same-origin Node service in `server.mjs` forwards confirmed notifications to a selected participating endpoint with `curl`. No build step, account login, analytics, or external JavaScript dependency is required.

## What it does

- Generates a cryptographically random 32-character IndexNow key in the browser, downloads a UTF-8 `.txt` file containing only that key, and prefills the key and root key-file URL.
- Prefills the site homepage as an example URL and builds a ready request preview; replace that example with each recently changed URL before submitting.
- Offers selectable endpoints for Microsoft Bing, Yandex, Seznam, Naver, Yep, and Amazonbot, with inline SVG brand marks.
- Accepts one URL or a newline-separated batch of up to 10,000 URLs.
- Removes fragments, preserves query strings, removes duplicates, and checks that all submitted URLs use the same HTTP(S) host.
- Validates IndexNow keys against the documented 8–128 character rule and permitted letters, digits, and hyphens.
- Uses the documented GET request for one URL and JSON POST for multiple URLs, including `host`, `key`, `keyLocation`, and `urlList`; the same-origin service uses `curl` so browser CORS restrictions do not block reading the response.
- Checks that the key file is on the submitted host and that every submitted path falls within the key file's authorized directory scope.
- Requires explicit site-owner confirmation, displays the request before sending, and creates a copyable `curl` fallback.
- Shows documented HTTP response meanings and reports service/network/timeout cases as unconfirmed—not as success.

## Key setup and hosting

Click **Generate & download** with your domain to create `{key}.txt` containing exactly the generated key and download the file. Upload that file to the domain's web root with your hosting provider, then open its public URL and confirm the contents match the key. This static page prepares the file but does not sign in to or upload it to your hosting provider. If your site already uses an IndexNow key, paste that existing key instead of replacing it.

The page initially prefills the homepage as a working example, along with the key file URL, request endpoint, and copyable `curl` command. The generated root key-file URL and homepage follow the entered domain while they remain untouched; custom values are preserved. Replace the homepage with recently added, updated, or deleted URL(s), verify the preview, and only send after uploading the key file and confirming site ownership. The key remains in page memory only; it is not written to local storage.

## Search-engine endpoint selection

The available destinations are based on the official [IndexNow participating-engine registry](https://www.indexnow.org/searchengines.json) and the endpoint URL in each participant's official metadata. The page currently lists Microsoft Bing, Yandex, Seznam, Naver, Yep, and Amazonbot. Internet Archive is omitted because its published metadata currently marks it unsubscribed from URL notifications. This list is embedded in the page and should be checked against the official registry for future changes.

Selecting an endpoint chooses where the first notification is sent; it does **not** restrict distribution to that one participant. IndexNow partners share accepted URL notifications with other participating engines. A successful receipt is not confirmation of crawling or indexing.

## Run or host

Run the same-origin service with Node.js 18 or newer and `curl` installed:

```sh
npm start
```

Then open `http://localhost:4173`. Set `PORT` to choose another port. The service serves the page and accepts only its local submission route; it validates the payload and maps the selected engine to a fixed official endpoint. Static hosting or opening `index.html` directly still allows key generation and request preparation, but sending requires the Node service. A separate copyable `curl` command is also available if you choose to submit manually; it contains the public IndexNow key and URL list, so review it before running or sharing it.

### Vercel

The repository also deploys to Vercel with no build step: `index.html` is served statically and `api/submit.mjs` provides the same `/api/submit` route as a serverless function. It reuses `validateSubmission` from `server.mjs` and forwards with server-side `fetch` (HTTPS only, no redirects followed, 15-second timeout) instead of the `curl` binary, which Vercel functions do not guarantee. Connecting the repository to a Vercel project deploys every merge to `main` automatically.

## Verification

The tests exercise the inline page script with a minimal DOM and intercepted `fetch`, and test the Node service with an injected submitter; they send no real IndexNow requests. Run all tests and syntax-check the service with:

```sh
npm test
node --check server.mjs
```

Official sources: [IndexNow documentation](https://www.indexnow.org/documentation), [FAQ](https://www.indexnow.org/faq), [participating-engine registry](https://www.indexnow.org/searchengines.json), and [search-engine protocol reference](https://www.indexnow.org/searchengines).
