import { Hono } from 'hono';
import {
  getEntryRoutes,
  createEntryRoute,
  updateEntryRoute,
  deleteEntryRoute,
} from '@line-crm/db';
import type { Env } from '../index.js';

const entryRoutes = new Hono<Env>();

// GET /api/entry-routes
entryRoutes.get('/api/entry-routes', async (c) => {
  try {
    const items = await getEntryRoutes(c.env.DB);
    return c.json({
      success: true,
      data: items.map((r) => ({
        id: r.id,
        refCode: r.ref_code,
        name: r.name,
        tagId: r.tag_id,
        scenarioId: r.scenario_id,
        redirectUrl: r.redirect_url,
        isActive: Boolean(r.is_active),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        // Build the tracking URL
        trackingUrl: `${new URL(c.req.url).origin}/r/${encodeURIComponent(r.ref_code)}`,
      })),
    });
  } catch (err) {
    console.error('GET /api/entry-routes error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/entry-routes
entryRoutes.post('/api/entry-routes', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      refCode?: string;
      tagId?: string;
      scenarioId?: string;
      redirectUrl?: string;
      lineAccountId?: string;
    }>();

    if (!body.name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }

    // Auto-generate refCode from name if not provided
    const refCode = body.refCode || crypto.randomUUID().slice(0, 8);

    const route = await createEntryRoute(c.env.DB, {
      refCode,
      name: body.name,
      tagId: body.tagId,
      scenarioId: body.scenarioId,
      redirectUrl: body.redirectUrl,
    });

    // Save line_account_id if provided
    if (body.lineAccountId) {
      await c.env.DB.prepare('UPDATE entry_routes SET line_account_id = ? WHERE id = ?')
        .bind(body.lineAccountId, route.id).run();
    }

    return c.json({
      success: true,
      data: {
        id: route.id,
        refCode: route.ref_code,
        name: route.name,
        tagId: route.tag_id,
        scenarioId: route.scenario_id,
        redirectUrl: route.redirect_url,
        isActive: Boolean(route.is_active),
        trackingUrl: `${new URL(c.req.url).origin}/r/${encodeURIComponent(route.ref_code)}`,
        createdAt: route.created_at,
        updatedAt: route.updated_at,
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/entry-routes error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/entry-routes/analytics/clicks
// Returns click tracking data grouped by source_url (referrer) and UTM params
entryRoutes.get('/api/entry-routes/analytics/clicks', async (c) => {
  try {
    const refCode = c.req.query('refCode');
    const days = parseInt(c.req.query('days') || '30');

    // Clicks by source (referrer page)
    let sourceQuery = `
      SELECT
        source_url,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        COUNT(*) as click_count,
        MIN(created_at) as first_click,
        MAX(created_at) as last_click
      FROM ref_tracking
      WHERE event_type = 'click'
        AND created_at >= datetime('now', '-${days} days')
    `;
    const bindings: string[] = [];
    if (refCode) {
      sourceQuery += ' AND ref_code = ?';
      bindings.push(refCode);
    }
    sourceQuery += `
      GROUP BY source_url, utm_source, utm_medium, utm_campaign, utm_content
      ORDER BY click_count DESC
      LIMIT 100
    `;

    const sources = await c.env.DB.prepare(sourceQuery).bind(...bindings).all();

    // Daily click counts
    let dailyQuery = `
      SELECT
        date(created_at) as date,
        ref_code,
        COUNT(*) as click_count
      FROM ref_tracking
      WHERE event_type = 'click'
        AND created_at >= datetime('now', '-${days} days')
    `;
    const dailyBindings: string[] = [];
    if (refCode) {
      dailyQuery += ' AND ref_code = ?';
      dailyBindings.push(refCode);
    }
    dailyQuery += `
      GROUP BY date(created_at), ref_code
      ORDER BY date DESC
    `;

    const daily = await c.env.DB.prepare(dailyQuery).bind(...dailyBindings).all();

    // Total clicks per ref_code
    let totalQuery = `
      SELECT
        ref_code,
        COUNT(*) as total_clicks,
        COUNT(CASE WHEN source_url != '' AND source_url IS NOT NULL THEN 1 END) as clicks_with_referrer
      FROM ref_tracking
      WHERE event_type = 'click'
        AND created_at >= datetime('now', '-${days} days')
    `;
    const totalBindings: string[] = [];
    if (refCode) {
      totalQuery += ' AND ref_code = ?';
      totalBindings.push(refCode);
    }
    totalQuery += ' GROUP BY ref_code ORDER BY total_clicks DESC';

    const totals = await c.env.DB.prepare(totalQuery).bind(...totalBindings).all();

    return c.json({
      success: true,
      data: {
        sources: sources.results,
        daily: daily.results,
        totals: totals.results,
      },
    });
  } catch (err) {
    console.error('GET /api/entry-routes/analytics/clicks error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/entry-routes/:id
entryRoutes.put('/api/entry-routes/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      refCode?: string;
      tagId?: string;
      scenarioId?: string;
      redirectUrl?: string;
      isActive?: boolean;
    }>();

    const updated = await updateEntryRoute(c.env.DB, id, body);
    if (!updated) {
      return c.json({ success: false, error: 'Entry route not found' }, 404);
    }

    return c.json({ success: true, data: updated });
  } catch (err) {
    console.error('PUT /api/entry-routes/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/entry-routes/:id
entryRoutes.delete('/api/entry-routes/:id', async (c) => {
  try {
    await deleteEntryRoute(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/entry-routes/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { entryRoutes };
