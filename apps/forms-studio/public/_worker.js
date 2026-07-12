const API_ORIGIN = 'https://line-flattravel.flat-travel.workers.dev';

function buildApiRequest(request) {
  const sourceUrl = new URL(request.url);
  const targetUrl = new URL(sourceUrl.pathname + sourceUrl.search, API_ORIGIN);
  const headers = new Headers(request.headers);

  headers.delete('host');

  return new Request(targetUrl.toString(), {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'manual',
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return fetch(buildApiRequest(request));
    }

    return env.ASSETS.fetch(request);
  },
};
