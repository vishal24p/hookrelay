export function StatusBanner({ banners, onDismissError }) {
  if (!banners.length) return null

  const banner = banners.find((item) => item.tone === 'error') || banners[0]
  const extraCount = banners.length - 1
  const action = banner.action || (banner.tone === 'error' && onDismissError
    ? { label: 'Dismiss', onClick: onDismissError }
    : null)

  return (
    <div className="status-banner-stack">
      <div className={`status-banner ${banner.tone}`}>
        <div className="row-between">
          <span>
            {banner.message}
            {extraCount > 0 ? ` (${extraCount} more)` : ''}
          </span>
          {action ? (
            <button className="ghost-button compact-button" onClick={action.onClick}>
              {action.label}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
