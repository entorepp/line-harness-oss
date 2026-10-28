# Choice-first WhatsApp travel planning

Owner-approved sequence: understand the desired trip, show a grounded travel vision, then choose a starting point. No nationality/residence or initial YES gate. Qualified AJ/form/package/tailor-made customers retain the existing exclusion; only the allowlisted pilot recipient is enabled (`WHATSAPP_INTAKE_MODE=test`).

Native single-select buttons (at most three) or lists gather wishes, destinations, optional Japan experience and planning help, timing, duration ranges, total party, explicitly labelled JPY party-total budget bands excluding international flights, and primary support. Unknown is a valid answer; Other opens a short typed exception. Existing grounded extraction handles multi-field free text, while normal choices require zero model calls. A detailed enquiry skips supplied questions. Generic people counts are not adult counts; ranges never become a fabricated midpoint.

A current published model is shown as a reference before the hotels-first / whole-trip / recommend choice. Actual route and localized title are checked. Published discovery data does not establish numeric prices, personal fit, pace or accessible-room inventory. References may differ; unsupported major route/length/pace changes go to individual review. Independent planning plus a relaxed stay can justify hotels first; experience alone never classifies the customer as a hotel-only buyer.

Hotel-first collects a starting city, dates or undecided, rooms and primary room feature. The feature-filtered public city collection is a research list: dates, total party and room counts are retained, not falsely claimed applied to that list. Native follow-up can expand to whole-trip help. Exact quotation/booking and specialist care retain human ownership.

## Delivery contract

Opaque `wi:<outgoing turn UUID>:<index>` IDs contain no answers or customer identifiers. Only signed native webhook inputs are journaled. A choice must refer to the same session/flow, latest accepted outgoing prompt and unchanged revision/question. Stale or foreign choices repeat the current prompt with zero model calls. Provider titles are not authority for a selected value.

The encrypted outbox contains both visible text and prompt/vision metadata. Legacy strings remain recoverable. Only an accepted outbox receipt can acknowledge a vision; rendering, saving state, suppressing a queued reply or an unknown send outcome cannot. Existing one-attempt sending, 24-hour checks, staff takeover, opt-out and qualified-customer guards remain. Migration032 adds only turn-owned opaque choice IDs.

## Attribution

Every generated proposal link uses:

- `utm_source=whatsapp`
- `utm_medium=messaging`
- `utm_campaign=wa_travel_scenario_v2`
- `utm_content=travel_vision`, `whole_trip`, `hotel_first` or `tailor_made`

No phone, session ID, support condition, traveller name or arbitrary query enters UTM. Existing consent-gated website first/last-touch capture preserves the stage across internal navigation and sends the snapshot with the enquiry. Harness normalizes and forwards it into FlatWorker's existing `_source.attribution`; existing fields and manually maintained acquisition channel are preserved. FlatWorker presents the stage separately. GA4 receives the existing campaign projection; report source/medium and manual ad content. URL/HTML/test success does not establish an actual GA4 receipt, real conversion or recipient delivery.

## Validation

Four-language native limits and deterministic policy, signed webhook lifecycle, suppression/unknown/stale choice handling, reversible hotel-first, protected customer exclusions and the actual quote relay are tested. The public site's served attribution script is also exercised with synthetic storage, internal navigation, new stage and no-consent cases. No synthetic production customer record or GA4 event is inserted.
