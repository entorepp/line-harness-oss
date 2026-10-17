import type { Env } from '../index.js';

export const MAX_RECORDING_PART_BYTES = 24 * 1024 * 1024;
export const MAX_RECORDING_PARTS = 96;
export const NOTICE_VERSION = 'wa-recording-v1';
export type RecordingRow = {call_id:string;owner_id:string;channel_id:string;consent_method:string;notice_version:string;state:string;part_count:number|null;slack_ts:string|null;error_code:string|null;created_at:number;updated_at:number;expires_at:number};
export type RecordingPart = {call_id:string;part_index:number;content_hash:string;content_type:string;byte_size:number;state:string;slack_file_id:string|null;error_code:string|null};
export const audioKey = (id:string,index:number) => `wa-recording-v1:${id}:audio:${index}`;
export const textKey = (id:string,index:number) => `wa-recording-v1:${id}:text:${index}`;
export const summaryKey = (id:string) => `wa-recording-v1:${id}:summary`;

async function key(env:Env['Bindings']) {
 const secret=env.FORM_RESPONSE_EMAIL_ENCRYPTION_KEY || '';
 if(secret.length<24)throw Error('recording_encryption_unconfigured');
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`whatsapp-call-recording-v1:${secret}`));
 return crypto.subtle.importKey('raw',digest,'AES-GCM',false,['encrypt','decrypt']);
}
export async function storeRecordingBytes(env:Env['Bindings'],name:string,bytes:ArrayBuffer,expiresAt:number) {
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(name)},await key(env),bytes);
 const result=new Uint8Array(12+encrypted.byteLength);result.set(iv);result.set(new Uint8Array(encrypted),12);
 const expiration=Math.floor(expiresAt/1000);
 if(expiration<=Math.floor(Date.now()/1000)+60)throw Error('recording_expired');
 await env.UPLOADS.put(name,result,{expiration});
}
export async function loadRecordingBytes(env:Env['Bindings'],name:string) {
 const value=await env.UPLOADS.get(name,'arrayBuffer');
 if(!value)throw Error('recording_part_unavailable');
 const iv=new Uint8Array(value.slice(0,12));
 return crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(name)},await key(env),value.slice(12));
}
export async function recordingHash(bytes:ArrayBuffer) {
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function recordingRetentionDays(env:Env['Bindings']) {
 return env.WHATSAPP_CALL_RECORDING_RETENTION_DAYS==='90'?90:30;
}
export async function recordingAllowed(env:Env['Bindings'],recipient:string) {
 if(!env.FORM_RESPONSE_EMAIL_ENCRYPTION_KEY || !env.WHATSAPP_CALL_RECORDING_OPENAI_KEY || !env.SLACK_BOT_TOKEN)return false;
 if(env.WHATSAPP_CALL_RECORDING_MODE==='live')return true;
 if(env.WHATSAPP_CALL_RECORDING_MODE!=='test')return false;
 const hash=await recordingHash(new TextEncoder().encode(recipient).buffer as ArrayBuffer);
 return (env.WHATSAPP_CALL_RECORDING_TEST_PHONE_HASHES||'').split(',').includes(hash);
}
