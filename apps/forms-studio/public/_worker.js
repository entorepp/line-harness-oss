const API_ORIGIN = 'https://line-flattravel.flat-travel.workers.dev';
const TRANSPORT_SURVEY_PATHS = new Map([
  ['96ff4bc9-40df-4b10-a3db-486f82374b30', '/tokyo-transport-survey/'],
  ['82119557-3c07-4f17-ab39-193d1fb35df3', '/kyoto-transport-survey/'],
  ['f01bcdfc-4b53-44c4-9fbf-9bf5ce2707cb', '/osaka-transport-survey/'],
  ['db018579-e461-43cc-84c5-2cdfad0e8d5b', '/kanazawa-transport-survey/'],
  ['1528b3da-2966-4c7c-945d-38e9ea322204', '/hiroshima-transport-survey/'],
  ['eef7e0b9-c0b0-49d8-8a30-bd34a6cf2c92', '/fuji-odawara-transport-survey/'],
  ['e5a619c2-b729-4d9a-9151-b8e5f7d86382', '/fuji-mishima-transport-survey/'],
  ['96a7fa63-8f10-4e8d-881c-4eef2c32c04b', '/fuji-shizuoka-transport-survey/'],
]);

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

    const surveyPath = url.pathname === '/public-form'
      ? TRANSPORT_SURVEY_PATHS.get(url.searchParams.get('id'))
      : null;
    if (surveyPath) {
      const assetUrl = new URL(surveyPath, url);
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    return env.ASSETS.fetch(request);
  },
};
