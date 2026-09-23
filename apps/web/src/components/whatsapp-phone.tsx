export default function WhatsAppPhone({ channelType, phone }: {
  channelType?: string
  phone?: string | null
}) {
  if (channelType !== 'whatsapp') return null

  // Preserve the provider's existing international or domestic display format.
  // Never interpret another channel's numeric ID or infer a country code.
  const value = phone?.trim()
  const valid = value && /^\+?[\d ()-]+$/.test(value) && /^\d{7,15}$/.test(value.replace(/\D/g, ''))

  return (
    <p className="mt-0.5 break-all text-xs text-gray-500" aria-label="WhatsApp電話番号">
      {valid ? <bdi className="select-text tabular-nums">{value}</bdi> : '電話番号を取得できません'}
    </p>
  )
}
