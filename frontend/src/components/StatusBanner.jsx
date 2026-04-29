export function StatusBanner({ banners, onDismissError }) {
  if (!banners.length) return null

  return (
    <div className="status-banner-stack">
      {banners.map((banner, index) => (
        <div key={`${banner.message}-${index}`} className={`status-banner ${banner.tone}`}>
          <div className="row-between">
            <span>{banner.message}</span>
            {banner.tone === 'error' && onDismissError ? (
              <button className="ghost-button" style={{ padding: '6px 10px' }} onClick={onDismissError}>
                Dismiss
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}
