import { fileURLToPath } from 'node:url'

export const FORM_ID = '8dc19365-8dd7-49e7-92fb-fdd697572771'
const f = (name, label, type = 'textarea', extra = {}) => ({ name, label, type, required: false, ...extra })
export const payload = {
  id: FORM_ID,
  name: 'Flat Travel Post-trip Feedback',
  description: 'Thank you for travelling with Flat Travel! Tell us what made your trip special and how we can improve. Comments, photos, videos and publication permission are optional. We store and review your response to improve our service. Declining publication will not affect our service to you.',
  locale: 'en',
  submitButtonLabel: 'Send feedback',
  successTitle: 'Thank you for sharing your journey!',
  successDescription: 'Your feedback has been received. We will use it to improve our service. We will only publish your feedback, media or trip details if you selected Yes.',
  saveToMetadata: false,
  onSubmitTagId: null,
  onSubmitScenarioId: null,
  fields: [
    f('respondent_name', 'Your name', 'text', { required: true, helperText: 'For our internal reference only. Your name will not be published.' }),
    f('overall_rating', 'How was your overall experience with Flat Travel?', 'radio', { required: true, options: ['5 — Very satisfied', '4 — Satisfied', '3 — Neutral', '2 — Dissatisfied', '1 — Very dissatisfied'] }),
    f('good_memories', 'What did you enjoy most, or what was your most memorable moment?'),
    f('good_service', 'Which services or support were especially helpful?', 'checkbox', { options: ['Trip planning and communication', 'Itinerary and pace', 'Hotels', 'Transport and transfers', 'Guides', 'Meal arrangements', 'Accessibility and individual support', 'Other'], helperText: 'Select all that apply.' }),
    f('more_improvements', 'What could we improve?', 'textarea', { helperText: 'Please be honest, even about small things.' }),
    f('memory_photos', 'Share your photos and videos', 'file', { accept: 'image/*,video/*,.heic,.heif,.mov,.m4v,.mp4,.webm,.mkv,.avi', multiple: true, helperText: 'Share as many photos and videos as you like. Add files again to include more. Please keep this page open until you see the confirmation. Uploading does not give permission to publish. Please avoid files containing private information or people who have not agreed to sharing.' }),
    f('marketing_publication_consent_v3', 'Optional permission: May we publicly share your feedback, photos, videos and trip itinerary?', 'radio', { options: ['Yes', 'No'], helperText: 'For Flat Travel’s website, social media, advertisements and sales materials, without your name or contact details. We may use excerpts, translations and edited media; faces and voices may be recognisable. Choose Yes only if you have the rights and permission of everyone identifiable, including a guardian for minors. Sensitive personal details are excluded. No or no selection means no permission. To change your choice, contact your travel coordinator.' }),
  ],
}
const q = value => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`
export function buildSql() {
  const now = new Date().toISOString()
  return `INSERT INTO forms (id,name,description,fields,locale,translation_group_id,submit_button_label,success_title,success_description,on_submit_tag_id,on_submit_scenario_id,save_to_metadata,is_active,submit_count,created_at,updated_at) SELECT ${[FORM_ID,payload.name,payload.description,JSON.stringify(payload.fields),payload.locale,null,payload.submitButtonLabel,payload.successTitle,payload.successDescription,null,null,0,0,0,now,now].map(q).join(',')} WHERE NOT EXISTS (SELECT 1 FROM forms WHERE id=${q(FORM_ID)});`
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--sql')) console.log(buildSql())
  else console.log(JSON.stringify(payload, null, 2))
}
