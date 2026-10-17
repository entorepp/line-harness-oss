import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from '../index.js';
import { contextForCall, validateRequestId, type CallRow } from '../services/whatsapp-calling.js';
import { audioKey, textKey, summaryKey, loadRecordingBytes, MAX_RECORDING_PART_BYTES, MAX_RECORDING_PARTS, NOTICE_VERSION, recordingAllowed, recordingHash, recordingRetentionDays, storeRecordingBytes, type RecordingRow, type RecordingPart } from '../services/whatsapp-recording-storage.js';

export const whatsappRecordings=new Hono<Env>();
const ROOT='/api/whatsapp/calling/calls/:callId/recording';
whatsappRecordings.use(`${ROOT}/*`,bodyLimit({maxSize:MAX_RECORDING_PART_BYTES,onError:c=>c.json({success:false,error:'録音ファイルが上限を超えています'},413)}));
whatsappRecordings.use(`${ROOT}/*`,async(c,next)=>{c.header('Cache-Control','private, no-store');await next()});
whatsappRecordings.onError((_,c)=>c.json({success:false,error:'録音処理に失敗しました。録音状態を確認してください。'},502));
async function call(env:Env['Bindings'],id:string) {
 validateRequestId(id);
 const row=await env.DB.prepare('SELECT * FROM whatsapp_calls WHERE id=?').bind(id).first<CallRow>();
 if(!row)return null;
 const ctx=await contextForCall(env,row);
 if(!ctx.enabled || !await recordingAllowed(env,row.recipient))return null;
 return row;
}
async function record(env:Env['Bindings'],id:string) {
 return env.DB.prepare('SELECT * FROM whatsapp_call_recordings WHERE call_id=? AND expires_at>?').bind(id,Date.now()).first<RecordingRow>();
}
const publicRow=(r:RecordingRow|null)=>r?{state:r.state,partCount:r.part_count,expiresAt:r.expires_at,errorCode:r.error_code}:null;

whatsappRecordings.get(`${ROOT}/status`,async c=>{
 const current=await call(c.env,c.req.param('callId'));
 if(!current)return c.json({success:true,data:{enabled:false,recording:null}});
 const friend=current.friend_id?await c.env.DB.prepare('SELECT slack_channel_id FROM friends WHERE id=?').bind(current.friend_id).first<{slack_channel_id:string|null}>():null;
 const channel=c.env.WHATSAPP_CALL_RECORDING_CHANNEL || friend?.slack_channel_id;
 return c.json({success:true,data:{enabled:Boolean(channel && /^[CG][A-Z0-9]{8,}$/.test(channel)),recording:publicRow(await record(c.env,current.id)),noticeVersion:NOTICE_VERSION,noticeMode:c.env.WHATSAPP_CALL_RECORDING_NOTICE_MODE==='announced'?'announced':'staff_confirmed',retentionDays:recordingRetentionDays(c.env)}});
});
whatsappRecordings.post(`${ROOT}/start`,async c=>{
 const body=await c.req.json<{ownerId:string;consentConfirmed:boolean;noticeVersion:string;consentMethod:string}>();
 validateRequestId(body.ownerId);
 const current=await call(c.env,c.req.param('callId'));
 if(!current || !['accepted','connecting','ringing'].includes(current.state))return c.json({success:false,error:'接続中の本人の通話でのみ録音できます'},403);
 if(current.direction==='inbound' && current.owner_id!==body.ownerId)return c.json({success:false,error:'別の担当者の通話は録音できません'},403);
 if(body.consentConfirmed!==true || body.noticeVersion!==NOTICE_VERSION || body.consentMethod!==(c.env.WHATSAPP_CALL_RECORDING_NOTICE_MODE==='announced'?'announced':'staff_confirmed'))return c.json({success:false,error:'録音と要約・Slack共有の案内を確認してください'},400);
 const friend=current.friend_id?await c.env.DB.prepare('SELECT slack_channel_id FROM friends WHERE id=?').bind(current.friend_id).first<{slack_channel_id:string|null}>():null;
 const channel=c.env.WHATSAPP_CALL_RECORDING_CHANNEL || friend?.slack_channel_id;
 if(!channel || !/^[CG][A-Z0-9]{8,}$/.test(channel))return c.json({success:false,error:'この通話の保存先Slackチャンネルが未設定です'},403);
 const now=Date.now();
 await c.env.DB.prepare("INSERT OR IGNORE INTO whatsapp_call_recordings (call_id,owner_id,channel_id,consent_method,notice_version,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?)")
  .bind(current.id,body.ownerId,channel,body.consentMethod,NOTICE_VERSION,now,now,now+recordingRetentionDays(c.env)*86400000).run();
 const saved=await record(c.env,current.id);
 if(saved?.owner_id!==body.ownerId || saved.state!=='recording')return c.json({success:false,error:'この通話は既に録音済みか別の担当者が録音中です'},409);
 return c.json({success:true,data:publicRow(saved)});
});
whatsappRecordings.put(`${ROOT}/parts/:index`,async c=>{
 const saved=await record(c.env,c.req.param('callId'));
 if(!saved || !await call(c.env,saved.call_id))return c.json({success:false,error:'録音が見つかりません'},404);
 if(c.req.header('X-Recording-Owner')!==saved.owner_id)return c.json({success:false,error:'録音の担当者が一致しません'},403);
 const index=Number(c.req.param('index')),type=(c.req.header('Content-Type')||'').split(';')[0];
 if(!Number.isInteger(index)||index<0||index>=MAX_RECORDING_PARTS||!['audio/webm','audio/mp4'].includes(type))return c.json({success:false,error:'録音形式が無効です'},400);
 const bytes=await c.req.arrayBuffer();
 if(!bytes.byteLength || bytes.byteLength>MAX_RECORDING_PART_BYTES)return c.json({success:false,error:'録音サイズが無効です'},400);
 const hash=await recordingHash(bytes);
 const prior=await c.env.DB.prepare('SELECT * FROM whatsapp_call_recording_parts WHERE call_id=? AND part_index=?').bind(saved.call_id,index).first<RecordingPart>();
 if(prior){
  if(prior.content_hash!==hash)return c.json({success:false,error:'同じ録音番号に異なる音声が指定されています'},409);
  if(prior.state!=='uploading')return c.json({success:true,data:{index,stored:true}});
  if(saved.state!=='recording')return c.json({success:false,error:'録音状態の確認が必要です'},409);
  await storeRecordingBytes(c.env,audioKey(saved.call_id,index),bytes,saved.expires_at);
  await c.env.DB.prepare("UPDATE whatsapp_call_recording_parts SET state='stored',updated_at=? WHERE call_id=? AND part_index=? AND state='uploading'").bind(Date.now(),saved.call_id,index).run();
  return c.json({success:true,data:{index,stored:true}});
 }
 if(saved.state!=='recording')return c.json({success:false,error:'この録音は終了済みです'},409);
 const claimed=await c.env.DB.prepare("INSERT OR IGNORE INTO whatsapp_call_recording_parts (call_id,part_index,content_hash,content_type,byte_size,updated_at) VALUES (?,?,?,?,?,?)")
  .bind(saved.call_id,index,hash,type,bytes.byteLength,Date.now()).run();
 if(claimed.meta.changes!==1)return c.json({success:false,error:'録音を保存処理中です'},409);
 await storeRecordingBytes(c.env,audioKey(saved.call_id,index),bytes,saved.expires_at);
 await c.env.DB.prepare("UPDATE whatsapp_call_recording_parts SET state='stored',updated_at=? WHERE call_id=? AND part_index=? AND state='uploading'").bind(Date.now(),saved.call_id,index).run();
 return c.json({success:true,data:{index,stored:true}});
});
whatsappRecordings.post(`${ROOT}/complete`,async c=>{
 const body=await c.req.json<{ownerId:string;partCount:number}>();
 const saved=await record(c.env,c.req.param('callId'));
 if(!saved || !await call(c.env,saved.call_id))return c.json({success:false,error:'録音が見つかりません'},404);
 if(saved.owner_id!==body.ownerId)return c.json({success:false,error:'録音の担当者が一致しません'},403);
 if(saved.state!=='recording')return c.json({success:saved.part_count===body.partCount,data:publicRow(saved)},saved.part_count===body.partCount?200:409);
 if(!Number.isInteger(body.partCount)||body.partCount<1||body.partCount>MAX_RECORDING_PARTS)return c.json({success:false,error:'録音数が無効です'},400);
 const parts=await c.env.DB.prepare('SELECT part_index,state FROM whatsapp_call_recording_parts WHERE call_id=? ORDER BY part_index').bind(saved.call_id).all<{part_index:number;state:string}>();
 if(parts.results.length!==body.partCount || parts.results.some((p,i)=>p.part_index!==i || p.state!=='stored'))return c.json({success:false,error:'一部の録音が保存されていません。自動投稿は開始しません。'},409);
 await c.env.DB.prepare("UPDATE whatsapp_call_recordings SET state='queued',part_count=?,updated_at=? WHERE call_id=? AND state='recording'").bind(body.partCount,Date.now(),saved.call_id).run();
 return c.json({success:true,data:publicRow(await record(c.env,saved.call_id))});
});
whatsappRecordings.post(`${ROOT}/discard`,async c=>{
 const body=await c.req.json<{ownerId:string}>();
 const saved=await record(c.env,c.req.param('callId'));
 if(!saved || saved.owner_id!==body.ownerId)return c.json({success:false,error:'録音が見つかりません'},404);
 const result=await c.env.DB.prepare("UPDATE whatsapp_call_recordings SET state='cancelled',updated_at=? WHERE call_id=? AND state IN ('recording','queued','cancelled')").bind(Date.now(),saved.call_id).run();
 if(result.meta.changes!==1)return c.json({success:false,error:'共有処理が始まっています。Slackへの共有状態を確認してください。'},409);
 const parts=(await c.env.DB.prepare('SELECT part_index FROM whatsapp_call_recording_parts WHERE call_id=?').bind(saved.call_id).all<{part_index:number}>()).results;
 for(const part of parts){await c.env.UPLOADS.delete(audioKey(saved.call_id,part.part_index));await c.env.UPLOADS.delete(textKey(saved.call_id,part.part_index))}
 await c.env.UPLOADS.delete(summaryKey(saved.call_id));
 return c.json({success:true,data:{state:'cancelled'}});
});
whatsappRecordings.get(`${ROOT}/parts/:index`,async c=>{
 const saved=await record(c.env,c.req.param('callId'));
 if(!saved || saved.state==='cancelled' || !await call(c.env,saved.call_id))return c.json({success:false,error:'録音が見つかりません'},404);
 const part=await c.env.DB.prepare('SELECT * FROM whatsapp_call_recording_parts WHERE call_id=? AND part_index=?').bind(saved.call_id,Number(c.req.param('index'))).first<RecordingPart>();
 if(!part || part.state==='uploading')return c.json({success:false,error:'録音が見つかりません'},404);
 const bytes=await loadRecordingBytes(c.env,audioKey(saved.call_id,part.part_index));
 c.header('Cache-Control','private, no-store');c.header('X-Content-Type-Options','nosniff');
 return new Response(bytes,{headers:{'Content-Type':part.content_type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
});
