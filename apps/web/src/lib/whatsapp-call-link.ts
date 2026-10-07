const CALL_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
export function validCallId(value: string | null): value is string { return Boolean(value && CALL_ID.test(value)) }
// Only this fixed internal route can survive login; never accept external next URLs.
export function callingReturnPath(pathname: string, search: string): string | null {
  const id = new URLSearchParams(search).get('wa_call')
  return pathname === '/calls' && validCallId(id) ? `/calls?wa_call=${id}` : null
}
export function callingLoginDestination(search: string): string {
  const next = new URLSearchParams(search).get('next') || ''
  if (!next.startsWith('/calls?')) return '/'
  return callingReturnPath('/calls', next.slice('/calls'.length)) || '/'
}
