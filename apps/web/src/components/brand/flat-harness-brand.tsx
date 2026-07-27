type FlatHarnessBrandProps = {
  size?: number
  subtitle?: string | null
  centered?: boolean
}

/**
 * Product wordmark used in operator-facing brand positions only.
 * Internal package names and URLs intentionally remain unchanged.
 */
export default function FlatHarnessBrand({
  size = 34,
  subtitle = null,
  centered = false,
}: FlatHarnessBrandProps) {
  return (
    <div
      className={`flex ${centered ? 'flex-col text-center' : 'items-center'} gap-2.5`}
      aria-label="Flat Harness"
    >
      <div
        className="relative shrink-0 overflow-hidden rounded-[28%] shadow-sm ring-1 ring-black/5"
        style={{
          width: size,
          height: size,
          background: 'linear-gradient(135deg, #10b981 0%, #0d9488 52%, #0284c7 100%)',
        }}
        aria-hidden="true"
      >
        <span className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-white/20" />
        <svg viewBox="0 0 32 32" className="absolute inset-0 h-full w-full" fill="none">
          <path
            d="M9.5 24V8.5H22.5M9.5 16H19"
            stroke="white"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="22.5" cy="8.5" r="2.15" fill="white" />
          <circle cx="19" cy="16" r="2.15" fill="white" />
          <circle cx="9.5" cy="24" r="2.15" fill="white" />
        </svg>
      </div>

      <div>
        <p className={`${size >= 44 ? 'text-xl' : 'text-sm'} font-bold leading-tight tracking-[-0.03em] text-gray-900`}>
          Flat <span className="text-teal-600">Harness</span>
        </p>
        {subtitle && <p className="mt-0.5 text-xs text-gray-400">{subtitle}</p>}
      </div>
    </div>
  )
}
