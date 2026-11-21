import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestEngagementRead } from './form.js';

afterEach(() => vi.unstubAllGlobals());

describe('engagement read transport', () => {
  it.each(['repliers', 'verify?username=traveller'])('keeps external %s GET headerless to avoid a new CORS preflight', async action => {
    const response = Response.json({ success: true, data: [] });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);
    const url = `https://external.example/api/engagement-gates/campaign/${action}`;
    expect(await requestEngagementRead(url, false)).toBe(response);
    // A second argument containing Content-Type: application/json would turn
    // this previously simple cross-origin GET into a preflighted request.
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(url);
    expect(fetchMock.mock.calls[0][1]).toBeUndefined();
  });

  it('retains the existing same-origin configured-gate proxy request', async () => {
    const response = Response.json({ success: true });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);
    const url = '/api/forms/survey/engagement/verify?username=traveller';
    expect(await requestEngagementRead(url, true)).toBe(response);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(url, {
      headers: { 'Content-Type': 'application/json' },
    });
  });
});
