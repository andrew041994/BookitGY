import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiClient, logApiError } from './lib/api'

const DOWNLOAD_LINKS = {
  ios: 'https://apps.apple.com',
  android: 'https://play.google.com',
}

const ProviderLanding = () => {
  const { username = '' } = useParams()
  const [loading, setLoading] = useState(true)
  const [provider, setProvider] = useState(null)
  const [error, setError] = useState('')

  const normalizedUsername = username?.trim()

  useEffect(() => {
    const fetchProvider = async () => {
      if (!normalizedUsername) {
        setError('Missing provider username')
        setLoading(false)
        return
      }
      try {
        setLoading(true)
        setError('')
        const res = await apiClient.get(
          `/public/providers/by-username/${encodeURIComponent(normalizedUsername)}`
        )
        setProvider(res.data)
      } catch (err) {
        const detail =
          err?.response?.data?.detail ||
          err?.response?.data?.message ||
          'Provider not found'
        setError(detail)
        logApiError(err)
      } finally {
        setLoading(false)
      }
    }

    fetchProvider()
  }, [normalizedUsername])

  const avatarUrl = useMemo(() => {
    const url = provider?.avatar_url
    if (!url) return null
    if (url.startsWith('http')) return url
    if (url.startsWith('//')) return `https:${url}`
    return `/api${url.startsWith('/') ? url : `/${url}`}`
  }, [provider])

  return (
    <div className="landing-shell">
      <div className="landing-card">
        <header className="landing-header">
          <div className="avatar">
            {avatarUrl ? (
              <img src={avatarUrl} alt={provider?.display_name || normalizedUsername} />
            ) : (
              <div className="avatar-fallback">
                {(provider?.display_name || normalizedUsername || '?')
                  .charAt(0)
                  .toUpperCase()}
              </div>
            )}
          </div>
          <div>
            <p className="eyebrow">BookitGY</p>
            <h1>
              {loading
                ? 'Loading provider…'
                : provider?.display_name || 'Provider not found'}
            </h1>
            {provider && <p className="muted">@{provider.username}</p>}
            {error && <p className="error-text">{error}</p>}
          </div>
        </header>

        <div className="landing-actions">
          <a className="primary-btn" href={DOWNLOAD_LINKS.ios}>
            Download for iPhone
          </a>
          <a className="secondary-btn" href={DOWNLOAD_LINKS.android}>
            Download for Android
          </a>
          <a className="ghost-btn" href={`https://bookitgy.com/p/${normalizedUsername}`}>
            Open in app
          </a>
        </div>
      </div>
    </div>
  )
}

export default ProviderLanding
