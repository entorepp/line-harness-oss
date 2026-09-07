/* The Google tag runs only inside this empty document after explicit consent.
   Enhanced measurement therefore has no local form inputs or submit events. */
(() => {
  'use strict';
  const origin = 'https://liffform-studio.pages.dev';
  const measurementId = 'G-NJMJ3ZPR24';
  const location = origin + '/public-form?id=9ab583b2-e42e-4ca2-bcb9-13a3c59f5477';
  let sent = false;
  if (window.location.origin !== origin || window.parent === window) return;

  window.addEventListener('message', (event) => {
    if (sent || event.origin !== origin || event.source !== window.parent
      || event.data?.type !== 'liffform:page-view') return;
    const input = event.data;
    let referrer = '';
    try {
      const url = new URL(input.page_referrer);
      if (url.protocol === 'https:' && !url.username && !url.password
        && /^[a-z0-9.-]+$/i.test(url.hostname) && url.hostname.length <= 253) referrer = url.origin + '/';
    } catch { /* No referrer is a valid direct visit. */ }
    const aj = input.campaign_source === 'accessible_japan';
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
      ...(aj ? {
        campaign_source: 'accessible_japan',
        campaign_medium: input.campaign_medium === 'cpc' ? 'cpc' : 'referral',
        campaign_name: 'accessible_japan_forms',
      } : {}),
    };
    sent = true;
    window.dataLayer = [];
    function gtag() { window.dataLayer.push(arguments); }
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
    });
    const script = document.createElement('script');
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
    document.head.appendChild(script);
  });
})();
