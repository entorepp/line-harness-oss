import { fileURLToPath } from 'node:url'

export const FORM_ID = '514279b7-3426-43bc-9226-9fcd13113ee7'
const f = (name, label, type = 'text', extra = {}) => ({ name, label, type, required: true, ...extra })
export const payload = {
  id: FORM_ID,
  name: 'Plan Your Japan Trip — Flat Travel',
  description: 'Tell us about your travel plans. You can write “Not decided” where needed. We will use your answers to plan and propose your trip.',
  locale: 'en',
  submitButtonLabel: 'Send my travel preferences',
  successTitle: 'Thank you!',
  successDescription: 'We have received your travel preferences. Our team will review your answers.',
  saveToMetadata: false,
  onSubmitTagId: null,
  onSubmitScenarioId: null,
  fields: [
    f('customer_name', 'Your name (main contact)'),
    f('email', 'Email address', 'email', { placeholder: 'e.g. travel@example.com' }),
    f('total_travelers', 'Total number of travellers', 'text', { digitsOnly: true, placeholder: 'e.g. 4', helperText: 'Include yourself, children, companions and carers.' }),
    f('support_travelers', 'Of these travellers, how many need accessibility support?', 'text', { digitsOnly: true, placeholder: 'e.g. 1', helperText: 'This number is included in the total above. Enter 0 if nobody needs support.' }),
    f('total_budget', 'Total trip budget for your whole group (excluding flights)', 'text', { placeholder: 'e.g. JPY 1,000,000 total / USD 10,000 total / Not decided', helperText: 'Enter the total for everyone, excluding flights, and specify the currency.' }),
    f('travel_period', 'When would you like to travel?', 'text', { placeholder: 'e.g. early April 2027 / 1–10 April 2027 / Not decided' }),
    f('trip_duration', 'How long would you like to travel?', 'text', { placeholder: 'e.g. 10 days (9 nights) / About a week / Not decided' }),
    f('city_stays', 'Cities and planned stays', 'city_dates', { cityOptions: ['Tokyo', 'Kyoto', 'Osaka', 'Hiroshima', 'Mt. Fuji / Lake Kawaguchi', 'Hakone', 'Kanazawa'], cityPlaceholder: 'Select a city', allowOtherOption: true, otherOptionLabel: 'Other city', addItemLabel: 'Add another city', maxItems: 12, helperText: 'Choose each city and enter your dates (e.g. 2026-11-26 to 29), number of nights or “Not decided”.' }),
    f('shower_type', 'Shower / bathroom preference (optional)', 'radio', { required: false, options: ['A shower over a bathtub is fine', 'I need a roll-in shower (step-free access, no bathtub to climb over)', 'I would like advice'], helperText: 'If a shower over a bathtub works for you, more hotel options may be available.' }),
    f('requested_services', 'What would you like us to arrange? (optional — select all that apply)', 'checkbox', { required: false, options: ['Hotels', 'Airport / station transfers', 'Private vehicle charter', 'Shinkansen (bullet train) tickets', 'Guide', 'Mobility and accessibility equipment rental', 'Accessible activities and experiences (things to do)'], helperText: 'Select all the services you would like Flat Travel to arrange. You can leave this blank if undecided.' }),
    f('notes', 'Anything else you would like us to know? (optional)', 'textarea', { required: false, placeholder: 'Tell us about your interests, accessibility needs, questions or concerns.' }),
  ],
}
const q = value => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`
export function buildSql() {
  const now = new Date().toISOString()
  return `INSERT INTO forms (id,name,description,fields,locale,translation_group_id,submit_button_label,success_title,success_description,on_submit_tag_id,on_submit_scenario_id,save_to_metadata,is_active,submit_count,created_at,updated_at) SELECT ${[FORM_ID,payload.name,payload.description,JSON.stringify(payload.fields),payload.locale,null,payload.submitButtonLabel,payload.successTitle,payload.successDescription,null,null,0,1,0,now,now].map(q).join(',')} WHERE NOT EXISTS (SELECT 1 FROM forms WHERE id=${q(FORM_ID)});`
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(process.argv.includes('--sql') ? buildSql() : JSON.stringify(payload, null, 2))
}
