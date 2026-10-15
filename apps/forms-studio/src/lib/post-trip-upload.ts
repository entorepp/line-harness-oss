export const POST_TRIP_FEEDBACK_FORM_ID = '8dc19365-8dd7-49e7-92fb-fdd697572771'

export function appendPostTripUploadScope(body: FormData, formId: string, fieldName: string) {
  if (formId !== POST_TRIP_FEEDBACK_FORM_ID) return false
  body.append('access', 'form-private')
  body.append('formId', formId)
  body.append('fieldName', fieldName)
  return true
}

export function validatePostTripUpload(data: { access?: string; expiresAt?: string; url?: string } | undefined) {
  if (data?.access !== 'form-private' || !data.expiresAt || !data.url || !new URL(data.url).pathname.startsWith('/api/form-files/')) {
    throw new Error('写真を保護された経路で保存できませんでした。再試行してください。 / A protected photo upload could not be confirmed. Please try again.')
  }
}
