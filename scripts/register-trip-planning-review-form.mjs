import { fileURLToPath } from 'node:url'

export const FORM_ID = '514279b7-3426-43bc-9226-9fcd13113ee7'
const f = (name, label, type = 'text', extra = {}) => ({ name, label, type, required: true, ...extra })
export const payload = {
  id: FORM_ID,
  name: 'Flat Travel 旅行相談アンケート（新規確認用）',
  description: 'ご旅行の希望をお聞かせください。未定の項目は「未定」とご記入いただけます。ご回答は旅行相談・ご提案のために利用します。',
  locale: 'ja',
  submitButtonLabel: '回答を送信する',
  successTitle: 'ご回答ありがとうございます',
  successDescription: 'ご旅行のご希望を受け付けました。担当者が内容を確認します。',
  saveToMetadata: false,
  onSubmitTagId: null,
  onSubmitScenarioId: null,
  fields: [
    f('customer_name', 'お名前（代表者）'),
    f('email', 'メールアドレス', 'email', { placeholder: '例：travel@example.com' }),
    f('total_travelers', '旅行に参加する合計人数（ご本人・同行者を含む）', 'text', { digitsOnly: true, placeholder: '例：4', helperText: 'お子様や介助者も含めた、旅行者全員の人数をご記入ください。' }),
    f('support_travelers', '合計人数のうち、配慮・サポートが必要な方の人数', 'text', { digitsOnly: true, placeholder: '例：1', helperText: '上の合計人数の内数です。該当する方がいない場合は0をご記入ください。' }),
    f('total_budget', '旅行全体のご予算（参加者全員分・航空券を除く）', 'text', { placeholder: '例：全員で100万円／全員で10,000 USD／未定', helperText: '航空券を除いた、参加者全員分の総額と通貨をご記入ください。' }),
    f('travel_period', 'ご希望の旅行時期', 'text', { placeholder: '例：2027年4月上旬／2027年4月1日〜10日／未定' }),
    f('trip_duration', 'ご希望の旅行日数', 'text', { placeholder: '例：10日間（9泊）／1週間程度／未定' }),
    f('city_stays', '訪問したい都市と、都市ごとの滞在予定', 'city_dates', { cityOptions: ['東京', '京都', '大阪', '広島', '富士山・河口湖', '箱根', '金沢'], cityPlaceholder: '都市を選択', allowOtherOption: true, otherOptionLabel: 'その他の都市', addItemLabel: '都市を追加', maxItems: 12, helperText: '都市を選び、日程（例：2026-11-26〜29）または泊数をご記入ください。未定でも大丈夫です。' }),
    f('shower_type', 'ご希望のシャワー・浴室タイプ（任意）', 'radio', { required: false, options: ['浴槽内でシャワーを使うタイプ（shower over bathtub）でも大丈夫', 'ロールインシャワー（roll-in shower：浴槽をまたがず、段差なく入れるシャワー）が必要', '相談して決めたい'], helperText: '浴槽内シャワーでも大丈夫なら、選べるホテルが広がります。' }),
    f('requested_services', 'ご希望のサービス（任意・複数選択可）', 'checkbox', { required: false, options: ['まずはホテルのみ決めたい', '空港・駅の送迎', 'チャーター（貸切車両）', '新幹線チケット', 'ガイド', '福祉用具レンタル', 'アクセシブルな観光・体験（Things to do）'], helperText: 'ご希望や気になるサービスをお選びください。未定の場合は空欄で大丈夫です。' }),
    f('notes', 'その他のご希望・ご相談（自由記述）', 'textarea', { required: false, placeholder: '旅行で楽しみたいこと、配慮が必要なこと、ご不安な点など、自由にご記入ください。' }),
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
