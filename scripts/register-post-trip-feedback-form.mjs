import { fileURLToPath } from 'node:url'

export const FORM_ID = '8dc19365-8dd7-49e7-92fb-fdd697572771'
const f = (name, label, type = 'textarea', extra = {}) => ({ name, label, type, required: false, ...extra })
const permission = (name, label, option, helperText) => f(name, label, 'checkbox', { options: [option], helperText })
export const payload = {
  id: FORM_ID,
  name: 'Flat Travel Post-trip Feedback',
  description: 'Thank you for travelling with Flat Travel! Tell us what made your trip special and how we can improve. Written comments, photos, videos and marketing permissions are optional. Declining publication will not affect our service to you.',
  locale: 'en',
  submitButtonLabel: 'Agree and send feedback',
  successTitle: 'Thank you for sharing your journey!',
  successDescription: 'Your feedback has been received. We will use it to improve our service. Marketing use is limited to the permissions you selected.',
  saveToMetadata: false,
  onSubmitTagId: null,
  onSubmitScenarioId: null,
  fields: [
    f('respondent_name', 'Your name (for our internal reference)', 'text', { required: true }),
    f('trip_reference', 'When and where did you travel?', 'text', { placeholder: 'For example: October 2026, Tokyo and Kyoto' }),
    f('contact_email', 'Email address (if you would like a reply)', 'email'),
    f('overall_rating', 'How was your overall experience with Flat Travel?', 'radio', { required: true, options: ['5 — Very satisfied', '4 — Satisfied', '3 — Neutral', '2 — Dissatisfied', '1 — Very dissatisfied'] }),
    f('good_memories', 'Good: What did you enjoy most?'),
    f('good_service', 'Which services or support were especially helpful?', 'textarea', { helperText: 'For example: planning, itinerary, hotels, transport, guides or meal arrangements. We would love to hear about specific moments.' }),
    f('more_improvements', 'More: What could we improve?', 'textarea', { helperText: 'Please be honest, even about small things.' }),
    f('memory_photos', 'Share your photos and videos', 'file', { accept: 'image/*,video/*,.heic,.heif,.mov,.m4v,.mp4,.webm,.mkv,.avi', multiple: true, helperText: 'Share as many photos and videos as you like. Add files again to include more. Large files are automatically uploaded in smaller parts. Please keep this page open until you see the confirmation. Uploading does not give permission to publish. Please avoid files containing private information or people who have not agreed to sharing.' }),
    f('photo_context', 'Tell us about your photos and videos, or identify any files you do not want published'),
    permission('marketing_quote_consent_v1', 'Optional permission: Anonymous feedback', 'I agree to anonymous publication of my written feedback', 'For Flat Travel’s official website, social media, advertisements and sales materials. We may use excerpts and translations that preserve your meaning. Unchecked means no permission.'),
    permission('marketing_photo_consent_v1', 'Optional permission: Photos', 'I agree to publication of my uploaded photos, except any I have excluded', 'For Flat Travel’s official website, social media, advertisements and sales materials, including resizing and cropping. Recognisable faces may be shown. Select only if you have the right to share the photos and permission from everyone identifiable (a guardian for minors).'),
    permission('marketing_video_consent_v1', 'Optional permission: Videos', 'I agree to publication of my uploaded videos, except any I have excluded', 'For Flat Travel’s official website, social media, advertisements and sales materials, including excerpts, resizing and subtitles that preserve the meaning. Recognisable faces and voices may be included. Select only if you have the right to share the footage and permission from everyone identifiable (a guardian for minors), including rights to any music.'),
    permission('marketing_case_contact_consent_v1', 'Optional permission: Your travel story', 'I agree to be contacted about featuring my trip as a customer story', 'We will ask you to approve the story, photos, videos and display name before publication. This choice alone does not approve a story. It does not authorise publication of health, disability, religious or other sensitive details.'),
    permission('marketing_first_name_consent_v1', 'Optional permission: Your first name', 'I agree to use of my first name with comments, photos or videos I have permitted', 'Otherwise we will use no name. We will not publish your surname or contact details.'),
    f('publication_notes', 'Preferred display name, publication restrictions or other comments', 'textarea', { helperText: 'To change or withdraw permission, contact your travel coordinator or our official enquiry channel. We will stop new use and discuss removal from materials we control. Previously distributed print or third-party copies may not be recoverable.' }),
    f('response_processing_consent_v2', 'Consent to handling this response', 'checkbox', { required: true, options: ['I agree that Flat Travel may store and review my answers, photos and videos for service improvement and necessary follow-up. Marketing use is limited to my choices above.'], helperText: 'Consent wording version: post-trip-v2-20261015' }),
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
