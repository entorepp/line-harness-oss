/* The Google tag runs only inside this empty document after explicit consent.
   Enhanced measurement therefore has no local form inputs or submit events. */
(() => {
  'use strict';
  const origin = 'https://liffform-studio.pages.dev';
  // Dedicated liffform-studio.pages.dev web stream in GA4 property 542113884.
  const measurementId = 'G-WNH9JBCLFH';
  const location = origin + '/public-form?id=9ab583b2-e42e-4ca2-bcb9-13a3c59f5477';
  const formId = '9ab583b2-e42e-4ca2-bcb9-13a3c59f5477';
  const allowedFields = new Map([
    ['first_name', 1], ['last_name', 2], ['email', 3], ['hotel_interest', 4],
    ['hotel_match_preference', 5], ['hotel_grade', 6], ['travellers', 7],
    ['room_count', 8], ['bed_type', 9], ['dates_decided', 10],
    ['city_schedule', 11], ['preferred_cities', 12], ['approximate_timing', 13],
    ['approximate_duration', 14], ['notes', 15],
  ]);
  let initialized = false;
  let trafficType = '';
  if (window.location.origin !== origin || window.parent === window) return;

  function gtag() { window.dataLayer.push(arguments); }

  window.addEventListener('message', (event) => {
    if (event.origin !== origin || event.source !== window.parent) return;
    const input = event.data;
    if (input?.type === 'liffform:analytics-event') {
      if (!initialized || !['form_start', 'form_progress', 'generate_lead'].includes(input.event_name)) return;
      const fieldIndex = allowedFields.get(input.field_key);
      if (input.event_name === 'form_progress' && !fieldIndex) return;
      gtag('event', input.event_name, {
        send_to: measurementId,
        form_id: formId,
        ...(trafficType ? { traffic_type: trafficType } : {}),
        ...(fieldIndex ? { field_key: input.field_key, form_step: fieldIndex } : {}),
        transport_type: 'beacon',
      });
      return;
    }
    if (initialized || input?.type !== 'liffform:page-view') return;
    let referrer = '';
    try {
      const url = new URL(input.page_referrer);
      if (url.protocol === 'https:' && !url.username && !url.password
        && /^[a-z0-9.-]+$/i.test(url.hostname) && url.hostname.length <= 253) referrer = url.origin + '/';
    } catch { /* No referrer is a valid direct visit. */ }
    const aj = input.campaign_source === 'accessible_japan';
    trafficType = input.traffic_type === 'internal' ? 'internal' : '';
    const settings = {
      page_location: location,
      page_title: 'Flat Travel Trip Planning Form',
      page_referrer: referrer,
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_prefix: 'liffform',
      cookie_domain: 'liffform-studio.pages.dev',
      cookie_expires: 15552000,
      cookie_flags: 'SameSite=Lax;Secure',
      ...(trafficType ? { traffic_type: trafficType } : {}),
      ...(aj ? {
        campaign_source: 'accessible_japan',
        campaign_medium: ['cpc', 'cta'].includes(input.campaign_medium)
          ? input.campaign_medium
          : 'referral',
        campaign_name: input.campaign_name === 'hotel_detail'
          ? 'hotel_detail'
          : 'accessible_japan_forms',
      } : {}),
    };
    initialized = true;
    window.dataLayer = [];
    gtag('consent', 'default', {
      analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    });
    gtag('set', 'url_passthrough', false);
    gtag('set', 'ads_data_redaction', true);
    gtag('js', new Date());
    gtag('config', measurementId, settings);
    gtag('event', 'page_view', {
      send_to: measurementId,
      page_location: settings.page_location,
      page_title: settings.page_title,
      page_referrer: settings.page_referrer,
      ...(trafficType ? { traffic_type: trafficType } : {}),
    });
    const script = document.createElement('script');
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
    document.head.appendChild(script);
  });
})();
