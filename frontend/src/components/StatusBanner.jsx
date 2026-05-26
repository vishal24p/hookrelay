export function StatusBanner({ banners, onDismissError }) {
  if (!banners.length) return null

  const banner = banners.find((item) => item.tone === 'error') || banners[0]
  const extraCount = banners.length - 1

  return (
    <div className="status-banner-stack">
      <div className={`status-banner ${banner.tone}`}>
        <div className="row-between">
          <span>{banner.message}{extraCount > 0 ? ` (${extraCount} more)` : ''}</span>
          {banner.tone === 'error' && onDismissError ? (
            <button className="ghost-button compact-button" onClick={onDismissError}>
              Dismiss
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
