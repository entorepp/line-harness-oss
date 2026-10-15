import { fileURLToPath } from 'node:url'

export const FORM_ID = '8dc19365-8dd7-49e7-92fb-fdd697572771'
const f = (name, label, type = 'textarea', extra = {}) => ({ name, label, type, required: false, ...extra })
const permission = (name, label, option, helperText) => f(name, label, 'checkbox', { options: [option], helperText })
export const payload = {
  id: FORM_ID,
  name: '旅行後アンケート / Flat Travel Post-trip Feedback',
  description: 'ご旅行ありがとうございました。約3〜5分で、旅の思い出と率直なご感想をお聞かせください。日本語・英語どちらでも回答できます。写真・自由記述・掲載許可は任意です。掲載に同意しなくても回答でき、今後のサービスに影響はありません。 / Thank you for travelling with Flat Travel! Please share your memories and honest feedback (about 3–5 minutes). You may answer in English or Japanese. Photos, written comments and marketing permissions are optional. Declining publication will not affect our service to you.',
  locale: 'en',
  submitButtonLabel: '同意して回答を送信 / Agree and send feedback',
  successTitle: 'ありがとうございました / Thank you!',
  successDescription: 'ご感想を受け付けました。今後のサービス改善に活用します。掲載は選択いただいた許可範囲に限ります。 / Your feedback has been received and will help improve our service. Marketing use is limited to the permissions you selected.',
  saveToMetadata: false,
  onSubmitTagId: null,
  onSubmitScenarioId: null,
  fields: [
    f('respondent_name', 'お名前（社内での回答確認用） / Your name (for our internal reference)', 'text', { required: true }),
    f('trip_reference', '旅行時期・訪問先 / When and where did you travel?', 'text', { placeholder: '例 / e.g. October 2026, Tokyo & Kyoto' }),
    f('contact_email', 'メールアドレス（ご連絡を希望する場合） / Email (if you would like a reply)', 'email'),
    f('overall_rating', 'フラットトラベルのサービスはいかがでしたか？ / How was your overall experience with Flat Travel?', 'radio', { required: true, options: ['5 とても満足 / Very satisfied', '4 満足 / Satisfied', '3 どちらともいえない / Neutral', '2 不満 / Dissatisfied', '1 とても不満 / Very dissatisfied'] }),
    f('good_memories', 'Good：一番楽しかったこと・思い出に残ったことは？ / Good: What did you enjoy most?'),
    f('good_service', '良かったサービス・助かったサポートは？ / Which services or support were especially helpful?', 'textarea', { helperText: '相談・旅程・ホテル・移動・ガイド・お食事への配慮など、具体的な場面をぜひ教えてください。 / For example: planning, itinerary, hotels, transport, guides or meal arrangements. Specific moments are welcome.' }),
    f('more_improvements', 'More：改善してほしいこと・困ったことは？ / More: What could we improve?', 'textarea', { helperText: '小さなことでも、率直にお聞かせください。 / Please be honest, even about small things.' }),
    f('memory_photos', '思い出に残った写真（任意・5枚まで） / Memorable photos (optional, up to 5)', 'file', { accept: 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif', multiple: true, maxFiles: 5, helperText: '1枚25 MiBまで。写真を送るだけでは掲載許可になりません。掲載しない写真も送れます。他の方の許可がない写真や個人情報が写った写真は避けてください。 / Up to 25 MiB per photo. Uploading does not grant publication permission. You may share photos for internal viewing only. Avoid photos without the permission of other people shown, or containing private information.' }),
    f('photo_context', '写真の場所・エピソード、掲載から除きたい写真 / Photo locations, stories, or photos to exclude from publication'),
    permission('marketing_quote_consent_v1', '任意の掲載許可①：匿名コメント / Optional permission 1: Anonymous feedback', '回答文を匿名で紹介することに同意します / I agree to anonymous publication of my written feedback', 'Flat Travelの公式ウェブサイト・SNS・広告・営業資料で、意味を変えない抜粋・翻訳に利用できます。未選択は許可なし。 / For Flat Travel’s official website, social media, advertisements and sales materials; excerpts and translations may preserve your meaning. Unchecked means no permission.'),
    permission('marketing_photo_consent_v1', '任意の掲載許可②：写真 / Optional permission 2: Photos', 'アップロードした写真（除外指定を除く）の掲載に同意します / I agree to publication of uploaded photos, except any I have excluded', '公式ウェブサイト・SNS・広告・営業資料での利用、サイズ調整・切り抜きを含みます。顔が分かる写真は顔も掲載される場合があります。写っている方全員の許可（未成年は保護者の許可）と、写真を提供する権限がある場合のみ選択してください。 / Includes Flat Travel’s website, social media, ads and sales materials, resizing and cropping. Recognisable faces may be shown. Select only if you have the right to share the photos and permission from everyone identifiable (a guardian for minors).'),
    permission('marketing_case_contact_consent_v1', '任意の掲載許可③：顧客事例 / Optional permission 3: Your travel story', '旅行を顧客事例として紹介するための連絡に同意します / I agree to be contacted about featuring my trip as a customer story', '事例の原稿・写真・掲載名は、公開前に別途ご確認いただきます。この選択だけで事例を公開しません。健康・障害・宗教等の情報はこの同意では公開しません。 / We will ask you to approve the story, photos and display name before publication. This choice alone does not approve a story. It does not authorise publication of health, disability, religious or other sensitive details.'),
    permission('marketing_first_name_consent_v1', '任意の掲載許可④：お名前 / Optional permission 4: Your first name', '許可したコメント・写真にファーストネームを添えることに同意します / I agree to use of my first name with comments or photos I have permitted', '未選択の場合は匿名。姓・連絡先は掲載しません。 / Otherwise we will use no name. We will not publish your surname or contact details.'),
    f('publication_notes', '掲載名の希望・掲載条件・その他のご意見 / Preferred display name, publication restrictions or other comments', 'textarea', { helperText: '掲載許可の変更・撤回は、これまでの担当者または公式のお問い合わせ窓口へご連絡ください。新たな利用を停止し、当社が管理する掲載物の対応を相談します。配布済み印刷物や第三者の転載は回収できない場合があります。 / To change or withdraw permission, contact your travel coordinator or our official enquiry channel. We will stop new use and discuss removal from materials we control. Previously distributed print or third-party copies may not be recoverable.' }),
    f('response_processing_consent_v1', '回答の取り扱いへの同意 / Consent to handling this response', 'checkbox', { required: true, options: ['回答・写真をサービス改善と必要なご連絡のために保存・確認することに同意します。マーケティング利用は上で選んだ範囲のみです。 / I agree that Flat Travel may store and review my answers and photos for service improvement and necessary follow-up. Marketing use is limited to my choices above.'], helperText: '同意文面バージョン / Consent wording version: post-trip-v1-20261015' }),
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
