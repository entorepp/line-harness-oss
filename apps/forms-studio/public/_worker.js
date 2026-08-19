const API_ORIGIN = 'https://line-flattravel.flat-travel.workers.dev';
const TOKYO_TRANSPORT_SURVEY_FORM_ID = '96ff4bc9-40df-4b10-a3db-486f82374b30';

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

    if (
      url.pathname === '/public-form'
      && url.searchParams.get('id') === TOKYO_TRANSPORT_SURVEY_FORM_ID
    ) {
      const assetUrl = new URL('/tokyo-transport-survey/', url);
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    return env.ASSETS.fetch(request);
  },
};
