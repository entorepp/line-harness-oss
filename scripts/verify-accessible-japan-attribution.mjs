import assert from 'node:assert/strict';
import {
  accessibleJapanAttributionToSubmissionData,
  buildAccessibleJapanAttributionInput,
  normalizeAccessibleJapanAttribution,
  stripAccessibleJapanAttributionData,
} from '../packages/shared/dist/form-attribution.js';

const explicit = normalizeAccessibleJapanAttribution(buildAccessibleJapanAttributionInput(
  'https://liffform-studio.pages.dev/public-form?id=form-id&hotel_name=Hilton%20Tokyo&hotel_slug=hilton-tokyo&utm_source=accessible-japan&utm_medium=hotel-page&utm_campaign=hotel-referral',
  'https://www.accessible-japan.com/hotels/hilton-tokyo/?private=value#rooms',
));

assert.equal(explicit.sourceHotelName, 'Hilton Tokyo');
assert.equal(explicit.sourceHotelSlug, 'hilton-tokyo');
assert.equal(explicit.sourcePageUrl, 'https://www.accessible-japan.com/hotels/hilton-tokyo/');
assert.equal(explicit.attributionMethod, 'hotel_query');
assert.equal(explicit.attributionConfidence, 'name_and_slug_params');
assert.equal(explicit.utmSource, 'accessible-japan');

const currentAccessibleJapanHiltonLink = normalizeAccessibleJapanAttribution(
  buildAccessibleJapanAttributionInput(
    'https://liffform-studio.pages.dev/public-form?id=form-id&prefill_Hotel+Name=Hilton+Tokyo',
  ),
);
assert.equal(currentAccessibleJapanHiltonLink.sourceHotelName, 'Hilton Tokyo');
assert.equal(currentAccessibleJapanHiltonLink.sourceHotelSlug, '');
assert.equal(currentAccessibleJapanHiltonLink.attributionMethod, 'hotel_query');
assert.equal(currentAccessibleJapanHiltonLink.attributionConfidence, 'single_hotel_param');

const currentAccessibleJapanParkHotelLink = normalizeAccessibleJapanAttribution(
  buildAccessibleJapanAttributionInput(
    'https://liffform-studio.pages.dev/public-form?id=form-id&prefill_Hotel+Name=Park+Hotel+Tokyo',
  ),
);
assert.equal(currentAccessibleJapanParkHotelLink.sourceHotelName, 'Park Hotel Tokyo');
assert.equal(currentAccessibleJapanParkHotelLink.attributionMethod, 'hotel_query');
assert.equal(currentAccessibleJapanParkHotelLink.attributionConfidence, 'single_hotel_param');

const utmOnly = normalizeAccessibleJapanAttribution(buildAccessibleJapanAttributionInput(
  'https://liffform-studio.pages.dev/public-form?id=form-id&utm_source=accessible-japan&utm_content=park-hotel-tokyo',
));
assert.equal(utmOnly.sourceHotelSlug, 'park-hotel-tokyo');
assert.equal(utmOnly.attributionMethod, 'utm_content');
assert.equal(utmOnly.attributionConfidence, 'utm_content_only');

const referrerOnly = normalizeAccessibleJapanAttribution(buildAccessibleJapanAttributionInput(
  'https://liffform-studio.pages.dev/public-form?id=form-id',
  'https://accessible-japan.com/hotels/keio-plaza-hotel-tokyo/?campaign=private#form',
));
assert.equal(referrerOnly.sourceHotelSlug, 'keio-plaza-hotel-tokyo');
assert.equal(referrerOnly.sourcePageUrl, 'https://accessible-japan.com/hotels/keio-plaza-hotel-tokyo/');
assert.equal(referrerOnly.attributionMethod, 'referrer_path');

const rejectedHost = normalizeAccessibleJapanAttribution({
  sourceHotelName: '',
  sourcePageUrl: 'https://example.com/hotels/not-allowed?email=private@example.com',
  referrer: 'javascript:alert(1)',
});
assert.equal(rejectedHost.sourcePageUrl, '');
assert.equal(rejectedHost.sourceHotelSlug, '');
assert.equal(rejectedHost.attributionMethod, 'unknown');

const persisted = accessibleJapanAttributionToSubmissionData(explicit);
assert.equal(persisted.source_partner, 'Accessible Japan');
assert.equal(persisted.source_hotel_name, 'Hilton Tokyo');
assert.equal(persisted.source_hotel_slug, 'hilton-tokyo');

const stripped = stripAccessibleJapanAttributionData({
  first_name: 'Jane',
  source_hotel_name: 'Forged Hotel',
  source_page_url: 'https://example.com/forged',
  utm_source: 'forged',
});
assert.deepEqual(stripped, { first_name: 'Jane' });

process.stdout.write('Accessible Japan attribution verification passed\n');
