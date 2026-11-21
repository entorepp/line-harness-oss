import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { forms } from './forms.js';
import { getFormById, getForms, getStaffByApiKey, updateForm, deleteForm, createForm } from '@line-crm/db';

vi.mock('@line-crm/db', () => ({
  getFormById: vi.fn(), getForms: vi.fn(), getStaffByApiKey: vi.fn(),
  updateForm: vi.fn(), deleteForm: vi.fn(), createForm: vi.fn(),
  getFormSubmissions: vi.fn(), createFormSubmission: vi.fn(), jstNow: vi.fn(),
  getFriendByLineUserId: vi.fn(), getFriendById: vi.fn(),
  addTagToFriend: vi.fn(), enrollFriendInScenario: vi.fn(),
}));

const fixture = {
  id: 'survey', name: 'Survey', description: 'Tell us about your trip',
  fields: '[{"id":"name","type":"text","label":"Name","required":true}]',
  on_submit_tag_id: 'tag', on_submit_scenario_id: 'scenario',
  on_submit_message_type: 'text' as const, on_submit_message_content: 'Thank you!',
  on_submit_webhook_url: 'https://gate.example/api/engagement-gates/gate-1/verify?key=url-secret',
  on_submit_webhook_headers: '{"Authorization":"Bearer webhook-secret"}',
  on_submit_webhook_fail_message: 'Please check the conditions',
  save_to_metadata: 1, is_active: 1, submit_count: 12, created_at: 'now', updated_at: 'now',
};
const env = { API_KEY: 'owner-key', DB: {} } as Env['Bindings'];
const app = new Hono<Env>();
app.use('*', authMiddleware);
app.route('/', forms);
function request(path = '/api/forms/survey', method = 'GET', token?: string, body?: unknown) {
  return app.request(path, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, env);
}

async function json(response: Response): Promise<{ data: any; success: boolean }> {
  return response.json() as Promise<{ data: any; success: boolean }>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getFormById).mockResolvedValue({ ...fixture });
  vi.mocked(getForms).mockResolvedValue([{ ...fixture }]);
  vi.mocked(getStaffByApiKey).mockResolvedValue(null);
  vi.mocked(updateForm).mockResolvedValue({ ...fixture, name: 'Updated' });
  vi.mocked(createForm).mockResolvedValue({ ...fixture });
});
afterEach(() => vi.unstubAllGlobals());

describe('public and administrative form authorization', () => {
  it('keeps anonymous GET usable with fields and public display data only', async () => {
    const res = await request();
    expect(res.status).toBe(200);
    const { data } = await json(res);
    expect(data).toEqual({
      id: 'survey', name: 'Survey', description: fixture.description,
      fields: JSON.parse(fixture.fields), isActive: true,
      hasSubmitWebhook: true, hasEngagementGate: true,
      onSubmitMessageContent: 'Thank you!', onSubmitWebhookFailMessage: fixture.on_submit_webhook_fail_message,
    });
    expect(JSON.stringify(data)).not.toMatch(/webhook-secret|url-secret|onSubmitWebhookHeaders|onSubmitWebhookUrl|onSubmitTagId|onSubmitScenarioId/);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(res.headers.get('Vary')).toContain('Authorization');
    expect(getStaffByApiKey).not.toHaveBeenCalled();
  });
  it.each(['PUT', 'DELETE', 'POST', 'PATCH'])('rejects anonymous %s before reading or writing the form', async method => {
    expect((await request(undefined, method, undefined, { name: 'Attack' })).status).toBe(401);
    expect(getFormById).not.toHaveBeenCalled();
    expect(updateForm).not.toHaveBeenCalled();
    expect(deleteForm).not.toHaveBeenCalled();
  });
  it('rejects invalid credentials even on GET', async () => {
    expect((await request(undefined, 'GET', 'wrong')).status).toBe(401);
    expect((await request(undefined, 'PUT', 'wrong', { name: 'Attack' })).status).toBe(401);
  });
  it('retains the full owner GET and list serializer without caching secrets', async () => {
    const res = await request(undefined, 'GET', 'owner-key');
    const { data } = await json(res);
    expect(data.onSubmitWebhookHeaders).toBe(fixture.on_submit_webhook_headers);
    expect(data.onSubmitWebhookUrl).toBe(fixture.on_submit_webhook_url);
    expect(data.onSubmitScenarioId).toBe('scenario');
    expect(data.saveToMetadata).toBe(true);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect((await json(await request('/api/forms', 'GET', 'owner-key'))).data[0]).toEqual(data);
    expect((await request('/api/forms')).status).toBe(401);
  });
  it('preserves owner edits including every automation field', async () => {
    const changes = {
      name: 'Updated', description: 'Updated description', fields: [{ id: 'email' }],
      onSubmitTagId: 'new-tag', onSubmitScenarioId: 'new-scenario',
      onSubmitMessageType: 'flex', onSubmitMessageContent: '{"type":"bubble"}',
      onSubmitWebhookUrl: 'https://gate.example/new', onSubmitWebhookHeaders: '{"X-Key":"new-secret"}',
      onSubmitWebhookFailMessage: 'Try again', saveToMetadata: false, isActive: false,
    };
    const res = await request(undefined, 'PUT', 'owner-key', changes);
    expect(res.status).toBe(200);
    expect(updateForm).toHaveBeenCalledWith(env.DB, 'survey', { ...changes, fields: JSON.stringify(changes.fields) });
    expect((await json(res)).data.onSubmitWebhookHeaders).toBe(fixture.on_submit_webhook_headers);
  });
  it('preserves staff-key access and authenticated delete/create', async () => {
    vi.mocked(getStaffByApiKey).mockResolvedValue({ id: 'staff', name: 'Staff', role: 'staff' } as never);
    expect((await request(undefined, 'PUT', 'staff-key', { name: 'Updated' })).status).toBe(200);
    expect((await request(undefined, 'DELETE', 'staff-key')).status).toBe(200);
    expect(deleteForm).toHaveBeenCalledWith(env.DB, 'survey');
    const res = await request('/api/forms', 'POST', 'staff-key', { name: 'New', onSubmitWebhookHeaders: fixture.on_submit_webhook_headers });
    expect(res.status).toBe(201);
    expect((await json(res)).data.onSubmitWebhookHeaders).toBe(fixture.on_submit_webhook_headers);
  });
  it('keeps missing public forms as 404 and ordinary forms without a gate usable', async () => {
    vi.mocked(getFormById).mockResolvedValueOnce(null);
    expect((await request()).status).toBe(404);
    vi.mocked(getFormById).mockResolvedValueOnce({ ...fixture, on_submit_webhook_url: null });
    expect((await json(await request())).data.hasSubmitWebhook).toBe(false);
  });
});

describe('credential-free browser engagement reads', () => {
  it.each(['verify?username=traveller', 'repliers'])('proxies %s only to the stored gate with server-side credentials', async action => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ success: true, data: { passed: true } }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await request(`/api/forms/survey/engagement/${action}`);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ success: true, data: { passed: true } });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url.origin).toBe('https://gate.example');
    expect(url.pathname).toBe(`/api/engagement-gates/gate-1/${action.split('?')[0]}`);
    expect(options.headers.Authorization).toBe('Bearer webhook-secret');
    expect(options.redirect).toBe('error');
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });
  it('does not accept a caller-controlled host, gate, or credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ success: true, data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await request('/api/forms/survey/engagement/repliers?url=https://evil.example&gate=other&Authorization=evil');
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://gate.example/api/engagement-gates/gate-1/repliers?key=url-secret');
  });
  it('rejects mutations, unknown actions, invalid usernames, and inactive/unconfigured forms without fetching', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect((await request('/api/forms/survey/engagement/repliers', 'PUT')).status).toBe(401);
    expect((await request('/api/forms/survey/engagement/delete')).status).toBe(401);
    expect((await request('/api/forms/survey/engagement/verify?username=bad%20name')).status).toBe(400);
    vi.mocked(getFormById).mockResolvedValueOnce({ ...fixture, is_active: 0 });
    expect((await request('/api/forms/survey/engagement/repliers')).status).toBe(404);
    vi.mocked(getFormById).mockResolvedValueOnce({ ...fixture, on_submit_webhook_url: 'https://gate.example/arbitrary' });
    expect((await request('/api/forms/survey/engagement/repliers')).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('returns a generic error without leaking upstream errors or secrets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('webhook-secret')));
    const res = await request('/api/forms/survey/engagement/repliers');
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('webhook-secret');
  });
});
