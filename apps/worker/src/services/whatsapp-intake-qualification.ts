import type { Env } from '../index.js';
import { readWhatsappIdentity } from './whatsapp-identity.js';

/** These signals stop hearing; they never prove identity or authorize quote disclosure. */
export function submittedEnquirySignal(text: string): boolean {
  text = text.normalize('NFKC');
  if (/\b(?:FTQ|FT|FTR|FTH)-/iu.test(text)) return true;
  const submitted = /\b(?:submitted|completed|answered|filled(?: (?:in|out))?|applied|booked|booking confirmation|reservation confirmation|already (?:sent|requested))\b|回答済|回答しました|回答した|送信済|申込済|申し込みました|申し込んだ|予約(?:を)?(?:済|しました|した)|預訂完成|预订完成|已填|已經填|已经填|填寫完成|填写完成|已提交|已送出|已申請|已申请|已預訂|已预订|작성했|제출했|예약했|예약 완료/iu.test(text);
  const form = /accessible\s*japan|\bAJ\b|アクセシブル[・\s]?ジャパン|無障礙日本|无障碍日本|액세서블\s*재팬/iu.test(text) && /questionnaire|survey|form|アンケート|問卷|问卷|表單|表单|설문|양식/iu.test(text);
  const converted = /tailor[ -]?made|テーラーメイド|客製|定制|맞춤|package\s*(?:tour|trip|enquiry|inquiry)|パッケージ|套裝|套餐|패키지/iu.test(text);
  return form || (submitted && converted);
}
export async function intakeQualification(env: Env['Bindings'], friendId: string): Promise<'unqualified' | 'registered' | 'uncertain'> {
  const routing = await env.DB.prepare(`SELECT f.slack_channel_id,la.default_slack_channel FROM friends f JOIN line_accounts la ON la.id=f.line_account_id WHERE f.id=?`)
    .bind(friendId).first<{ slack_channel_id: string | null; default_slack_channel: string | null }>();
  if (routing?.slack_channel_id && routing.slack_channel_id !== routing.default_slack_channel) return 'registered';
  // Reuse the existing exact friend/account identity read. Project only this decision;
  // names, email, contact and case pointers never enter state, Slack or the model.
  const result = await readWhatsappIdentity(env, friendId);
  if (result.status === 'linked' || result.status === 'review_required' || (Array.isArray(result.cases) && result.cases.length)) return 'registered';
  return result.status === 'unlinked' ? 'unqualified' : 'uncertain';
}
