import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Link, NavLink, useNavigate, Navigate, Outlet, useLocation } from 'react-router-dom'
import { apiClient, logApiError } from './lib/api'
import ProviderLanding from './ProviderLanding'
import './login.css'

const DEFAULT_SERVICE_CHARGE = 10
const SERVICE_CHARGE_STORAGE_KEY = 'bookitgy.service_charge_rate'
const LEAFLET_CSS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
const LEAFLET_JS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
const LEAFLET_CSS_ID = 'leaflet-css'
const LEAFLET_JS_ID = 'leaflet-js'
const DEFAULT_MAP_CENTER = [5.0, -58.95]
const DEFAULT_MAP_ZOOM = 6
let leafletLoaderPromise

const loadLeaflet = () => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Leaflet requires a browser environment.'))
  }

  if (window.L) {
    return Promise.resolve(window.L)
  }

  if (!leafletLoaderPromise) {
    leafletLoaderPromise = new Promise((resolve, reject) => {
      if (!document.getElementById(LEAFLET_CSS_ID)) {
        const link = document.createElement('link')
        link.id = LEAFLET_CSS_ID
        link.rel = 'stylesheet'
        link.href = LEAFLET_CSS_URL
        link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='
        link.crossOrigin = ''
        document.head.appendChild(link)
      }

      const existingScript = document.getElementById(LEAFLET_JS_ID)
      if (existingScript) {
        if (window.L) {
          resolve(window.L)
          return
        }
        existingScript.addEventListener('load', () => resolve(window.L))
        existingScript.addEventListener('error', () => reject(new Error('Failed to load Leaflet script.')))
        return
      }

      const script = document.createElement('script')
      script.id = LEAFLET_JS_ID
      script.src = LEAFLET_JS_URL
      script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='
      script.crossOrigin = ''
      script.async = true
      script.onload = () => resolve(window.L)
      script.onerror = () => reject(new Error('Failed to load Leaflet script.'))
      document.body.appendChild(script)
    })
  }

  return leafletLoaderPromise
}

const normalizeServiceCharge = (value) => Math.max(0, Math.min(100, Number(value) || 0))

const formatDateInput = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const parseDateInput = (value) => {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  const parsed = new Date(year, month - 1, day)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

const loadStoredServiceCharge = () => {
  const stored = localStorage.getItem(SERVICE_CHARGE_STORAGE_KEY)
  if (stored === null) return null
  return normalizeServiceCharge(stored)
}

const persistServiceCharge = (rate) => {
  localStorage.setItem(SERVICE_CHARGE_STORAGE_KEY, String(rate))
}

function App() {
  const [token, setToken] = React.useState(localStorage.getItem('token') || '')

  React.useEffect(() => {
    if (token) {
      apiClient.defaults.headers.common.Authorization = `Bearer ${token}`
    } else {
      delete apiClient.defaults.headers.common.Authorization
    }
  }, [token])

  const Login = () => {
    const [email, setEmail] = React.useState('customer@guyana.com')
    const [password, setPassword] = React.useState('pass')
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState('')
    const navigate = useNavigate()

    React.useEffect(() => {
      if (token) {
        navigate('/admin/promotions', { replace: true })
      }
    }, [token, navigate])

    const login = async (e) => {
      e.preventDefault()
      setError('')
      setLoading(true)
      try {
        const res = await apiClient.post('/auth/login', new URLSearchParams({
          username: email,
          password
        }))
        localStorage.setItem('token', res.data.access_token)
        setToken(res.data.access_token)
        navigate('/admin/promotions', { replace: true })
      } catch {
        setError('Wrong credentials – try customer@guyana.com with password pass')
      } finally {
        setLoading(false)
      }
    }

    return (
      <div className="login-shell">
        <div className="login-glow login-glow-one" />
        <div className="login-glow login-glow-two" />
        <div className="login-card">
          <div className="login-hero">
            <div className="logo-circle">
              <img src="/bookitgy-logo.png" alt="BookitGY" />
            </div>
            <p className="eyebrow">Booking platform for Guyana</p>
            <h1>Welcome back to BookitGY</h1>
            <p className="subtitle">
              Manage appointments, track providers, and keep customers happy from a single, secure dashboard.
            </p>
            <div className="hero-stats">
              <div>
                <span className="stat-value">4.9★</span>
                <span className="stat-label">Average satisfaction</span>
              </div>
              <div>
                <span className="stat-value">8,200+</span>
                <span className="stat-label">Monthly bookings</span>
              </div>
              <div>
                <span className="stat-value">24/7</span>
                <span className="stat-label">Real-time monitoring</span>
              </div>
            </div>
          </div>

          <form className="login-form" onSubmit={login}>
            <div className="form-header">
              <p className="eyebrow">Sign in</p>
              <h2>Access the admin console</h2>
              <p className="form-hint">Use your admin credentials or the demo account below.</p>
            </div>

            <label className="form-field">
              <span>Email</span>
              <input
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>

            <label className="form-field">
              <span>Password</span>
              <input
                type="password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </label>

            {error && <p className="form-error">{error}</p>}

            <button className="primary-btn" disabled={loading}>
              {loading ? 'Signing in…' : 'Continue'}
            </button>

            <p className="credentials-hint">
              Demo login: <strong>customer@guyana.com</strong> / <strong>pass</strong>
            </p>
          </form>
        </div>
      </div>
    )
  }

  const PASSWORD_REQUIREMENTS =
    'Password must be 6–8 characters and include uppercase, lowercase, number, and special character.'

  const meetsPasswordPolicy = (value) => {
    if (value.length < 6 || value.length > 8) return false
    if (!/[A-Z]/.test(value)) return false
    if (!/[a-z]/.test(value)) return false
    if (!/[0-9]/.test(value)) return false
    if (!/[^A-Za-z0-9]/.test(value)) return false
    return true
  }

  const ResetPassword = () => {
    const location = useLocation()
    const navigate = useNavigate()
    const query = new URLSearchParams(location.search)
    const rawToken = query.get('token')
    let resetToken = ''
    if (rawToken) {
      try {
        resetToken = decodeURIComponent(rawToken).trim()
      } catch {
        resetToken = rawToken.trim()
      }
    }
    const tokenMissing = !resetToken
    const [newPassword, setNewPassword] = React.useState('')
    const [confirmPassword, setConfirmPassword] = React.useState('')
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState('')
    const [success, setSuccess] = React.useState(false)

    const submitReset = async (event) => {
      event.preventDefault()
      setError('')

      if (!resetToken) {
        setError('Missing reset token.')
        return
      }

      if (newPassword !== confirmPassword) {
        setError('Passwords do not match.')
        return
      }

      if (!meetsPasswordPolicy(newPassword)) {
        setError(PASSWORD_REQUIREMENTS)
        return
      }

      setLoading(true)
      try {
        if (import.meta.env?.DEV) {
          console.log(`[reset-password] token present: ${resetToken.length > 0}`)
        }
        await apiClient.post('/auth/reset-password', {
          token: resetToken,
          new_password: newPassword
        })
        setSuccess(true)
      } catch (err) {
        const detail = err?.response?.data?.detail
        setError(detail || 'Unable to reset your password. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    return (
      <div className="login-shell">
        <div className="landing-glow landing-glow-one" />
        <div className="landing-glow landing-glow-two" />
        <div className="landing-card reset-card">
          <div className="logo-circle">
            <img src="/bookitgy-logo.png" alt="BookitGY" />
          </div>
          <p className="eyebrow">Reset password</p>
          <h1>Choose a new password</h1>
          <p className="subtitle">
            {success
              ? 'Your password has been updated. You can sign in with your new credentials.'
              : 'Enter a new password that meets the security requirements below.'}
          </p>

          {!success ? (
            <form className="login-form reset-form" onSubmit={submitReset}>
              <label className="form-field">
                <span>New password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </label>

              <label className="form-field">
                <span>Confirm password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </label>

              <p className="muted reset-hint">{PASSWORD_REQUIREMENTS}</p>

              {tokenMissing && (
                <p className="form-error">
                  Missing reset token.{' '}
                  <Link to="/login">Request a new reset link.</Link>
                </p>
              )}

              {error && <p className="form-error">{error}</p>}

              <button className="primary-btn" disabled={loading || tokenMissing}>
                {loading ? 'Resetting…' : 'Reset password'}
              </button>
            </form>
          ) : (
            <div className="reset-success">
              <button
                className="primary-btn"
                onClick={() => navigate('/login')}
              >
                Go to login
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  const AdminPromotions = () => {
    const [accountNumber, setAccountNumber] = React.useState('ACC-')
    const [credit, setCredit] = React.useState('2000')

    const apply = async () => {
      await apiClient.put(`/admin/promotions/${accountNumber}`, { credit_gyd: Number(credit) })
      alert(`Bill credit applied! ${credit} GYD added to ${accountNumber}`)
    }

    return (
      <div className="admin-page">
        <div className="admin-header">
          <div>
            <p className="eyebrow">Marketing</p>
            <h1>Admin – Editable Promotions</h1>
            <p className="header-subtitle">Apply bill credits to provider accounts whenever you need.</p>
          </div>
        </div>
        <div className="admin-card">
          <div className="form-grid">
            <label className="form-field">
              <span>Provider account number</span>
              <input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="Account number" />
            </label>
            <label className="form-field">
              <span>Bill credit (GYD)</span>
              <input value={credit} onChange={e => setCredit(e.target.value)} placeholder="Amount in GYD" />
            </label>
          </div>
          <button onClick={apply} className="primary-btn">Apply Credit</button>
          <p className="muted">Example: Add a $5,000 GYD credit to account ACC-1234 so it reduces their next bill.</p>
        </div>
      </div>
    )
  }

  const ServiceChargeSettings = () => {
    const [draft, setDraft] = React.useState(DEFAULT_SERVICE_CHARGE)
    const [savedRate, setSavedRate] = React.useState(DEFAULT_SERVICE_CHARGE)
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState("")

    const applyRate = (rate) => {
      const normalized = normalizeServiceCharge(rate)
      persistServiceCharge(normalized)
      setSavedRate(normalized)
      setDraft(normalized)
    }

    React.useEffect(() => {
      const fetchRate = async () => {
        try {
          setLoading(true)
          setError("")
          const res = await apiClient.get('/admin/service-charge')
          const rate =
            res.data?.service_charge_percentage ??
            res.data?.service_charge_percent ??
            (res.data?.service_charge_rate ?? 0) * 100
          applyRate(rate)
        } catch (e) {
          console.log("Falling back to cached service charge", e.message)
          const storedRate = loadStoredServiceCharge()
          if (storedRate !== null) {
            applyRate(storedRate)
          }
          setError("Could not load the saved service charge. Showing last known rate.")
        } finally {
          setLoading(false)
        }
      }

      fetchRate()
    }, [])

    const save = async () => {
      const normalized = normalizeServiceCharge(draft)
      try {
        setLoading(true)
        setError("")
        const res = await apiClient.put('/admin/service-charge', {
          service_charge_percentage: normalized,
        })
        const rate =
          res.data?.service_charge_percentage ??
          res.data?.service_charge_percent ??
          (res.data?.service_charge_rate ?? 0) * 100
        applyRate(rate)
        alert(`Service charge saved at ${rate}%`)
      } catch (e) {
        console.error("Failed to save service charge", e.message)
        setError("Could not save the service charge. Please try again.")
      } finally {
        setLoading(false)
      }
    }

    const reset = () => {
      setDraft(DEFAULT_SERVICE_CHARGE)
      save()
    }

    return (
      <div className="admin-page">
        <div className="admin-header">
          <div>
            <p className="eyebrow">Billing</p>
            <h1>Service Charge</h1>
            <p className="header-subtitle">Control the percentage fee applied to each service cost.</p>
          </div>
        </div>

        <div className="admin-card">
          <div className="form-grid single">
            <label className="form-field">
              <span>Service charge percentage</span>
              <input
                type="number"
                min="0"
                max="100"
                value={draft}
                onChange={(e) => setDraft(Number(e.target.value))}
              />
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
          <p className="muted">Current saved rate: <strong>{savedRate}%</strong>. Values are clamped between 0% and 100%.</p>
          {loading && <p className="muted">Loading latest service charge…</p>}
          <div className="button-row">
            <button onClick={save} className="primary-btn">{loading ? 'Saving…' : 'Save service charge'}</button>
            <button onClick={reset} className="ghost-btn">Reset to default ({DEFAULT_SERVICE_CHARGE}%)</button>
          </div>
        </div>
      </div>
    )
  }

  const Home = () => (
    <div className="landing-shell">
      <div className="landing-glow landing-glow-one" />
      <div className="landing-glow landing-glow-two" />
      <div className="landing-card">
        <div className="logo-circle">
          <img src="/bookitgy-logo.png" alt="BookitGY" />
        </div>
        <p className="eyebrow">Booking platform for Guyana</p>
        <h1>BookitGY Admin</h1>
        <p className="subtitle">
          Modern tools for managing providers, bookings, and promotions—protected behind a secure login.
        </p>

        <div className="landing-actions">
          <Link className="primary-btn" to={token ? '/admin/promotions' : '/login'}>
            {token ? 'Go to dashboard' : 'Login'}
          </Link>
          {!token && (
            <p className="credentials-hint">
              Demo login: <strong>customer@guyana.com</strong> / <strong>pass</strong>
            </p>
          )}
        </div>
      </div>
    </div>
  )

  const ProtectedRoute = ({ children }) => {
    const location = useLocation()
    if (!token) {
      return <Navigate to="/login" replace state={{ from: location }} />
    }
    return children
  }

  const toCycleMonth = (year, monthNumber) => {
    const monthValue = String(monthNumber).padStart(2, '0')
    return `${year}-${monthValue}-01`
  }

  const AdminBilling = () => {
    const location = useLocation()
    const navigate = useNavigate()
    const [billingRows, setBillingRows] = React.useState([])
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState('')
    const [hasLoaded, setHasLoaded] = React.useState(false)
    const [searchTerm, setSearchTerm] = React.useState('')
    const parseMonthYearFromSearch = React.useCallback((search) => {
      const params = new URLSearchParams(search)
      const cycleParam = params.get('cycle_month')
      if (cycleParam) {
        const match = cycleParam.match(/^(\d{4})-(\d{2})-01$/)
        if (match) {
          const month = Number(match[2])
          const year = Number(match[1])
          if (month >= 1 && month <= 12) {
            return { month, year }
          }
        }
      }
      const rawYear = params.get('year')
      const rawMonth = params.get('month')
      if (rawYear && rawMonth) {
        const month = Number(rawMonth)
        const year = Number(rawYear)
        if (month >= 1 && month <= 12 && Number.isFinite(year)) {
          return { month, year }
        }
      }
      return null
    }, [])
    const initialMonthYear = React.useMemo(() => {
      const parsed = parseMonthYearFromSearch(location.search)
      if (parsed) return parsed
      const now = new Date()
      return { month: now.getMonth() + 1, year: now.getFullYear() }
    }, [location.search, parseMonthYearFromSearch])
    const [selectedMonth, setSelectedMonth] = React.useState(initialMonthYear.month)
    const [selectedYear, setSelectedYear] = React.useState(initialMonthYear.year)
    const [suspendingByAccountNumber, setSuspendingByAccountNumber] = React.useState({})
    const [payingByAccountNumber, setPayingByAccountNumber] = React.useState({})
    const [markAllLoading, setMarkAllLoading] = React.useState(false)

    const monthOptions = React.useMemo(() => {
      return Array.from({ length: 12 }, (_, index) => {
        const month = index + 1
        const label = new Date(2000, index, 1).toLocaleDateString(undefined, { month: 'long' })
        return { value: month, label }
      })
    }, [])

    const yearOptions = React.useMemo(() => {
      const now = new Date()
      const baseYear = now.getFullYear()
      const years = new Set()
      for (let offset = -3; offset <= 3; offset += 1) {
        years.add(baseYear + offset)
      }
      years.add(selectedYear)
      return Array.from(years).sort((a, b) => a - b)
    }, [selectedYear])

    const selectedMonthLabel = React.useMemo(() => {
      const match = monthOptions.find((option) => option.value === selectedMonth)
      if (match) return match.label
      const parsed = new Date(2000, selectedMonth - 1, 1)
      if (Number.isNaN(parsed.getTime())) return String(selectedMonth)
      return parsed.toLocaleDateString(undefined, { month: 'long' })
    }, [selectedMonth, monthOptions])

    const cycleMonth = React.useMemo(
      () => toCycleMonth(selectedYear, selectedMonth),
      [selectedMonth, selectedYear]
    )

    React.useEffect(() => {
      const parsed = parseMonthYearFromSearch(location.search)
      if (!parsed) return
      setSelectedMonth((prev) => (prev === parsed.month ? prev : parsed.month))
      setSelectedYear((prev) => (prev === parsed.year ? prev : parsed.year))
    }, [location.search, parseMonthYearFromSearch])

    React.useEffect(() => {
      const params = new URLSearchParams(location.search)
      params.set('month', String(selectedMonth))
      params.set('year', String(selectedYear))
      params.delete('cycle_month')
      const nextSearch = params.toString()
      const currentSearch = location.search.replace(/^\?/, '')
      if (nextSearch === currentSearch) return
      navigate({ pathname: location.pathname, search: `?${nextSearch}` }, { replace: true })
    }, [location.pathname, location.search, navigate, selectedMonth, selectedYear])

    const fetchBillingRows = React.useCallback(async (cycleMonthOverride) => {
      const requestedCycleMonth = cycleMonthOverride ?? cycleMonth
      setLoading(true)
      setError('')
      try {
        const res = await apiClient.get('/admin/billing', {
          params: { cycle_month: requestedCycleMonth },
        })
        const responseData = res.data
        const hasValidRows =
          Array.isArray(responseData) ||
          Array.isArray(responseData?.providers) ||
          Array.isArray(responseData?.data)
        const responseRows = Array.isArray(responseData)
          ? responseData
          : Array.isArray(responseData?.providers)
            ? responseData.providers
            : Array.isArray(responseData?.data)
              ? responseData.data
              : []

        if (!hasValidRows) {
          setError('Unable to load provider billing details. Please refresh and try again.')
          setBillingRows([])
          return
        }
        setBillingRows(responseRows)
      } catch (err) {
        logApiError(err)
        setError('Unable to load provider billing details. Please refresh and try again.')
        setBillingRows([])
      } finally {
        setLoading(false)
        setHasLoaded(true)
      }
    }, [cycleMonth])

    React.useEffect(() => {
      fetchBillingRows()
    }, [fetchBillingRows])

    const markProviderPaid = async (accountNumber) => {
      if (!accountNumber) {
        setError('Missing account number for provider; billing rows must include account_number')
        return
      }

      if (payingByAccountNumber[accountNumber]) return

      setPayingByAccountNumber((prev) => ({ ...prev, [accountNumber]: true }))
      setError('')

      try {
        const res = await apiClient.post(
          `/admin/billing/${accountNumber}/mark-paid`,
          { cycle_month: cycleMonth }
        )
        const payload = res?.data
        setBillingRows((prev) =>
          prev.map((row) =>
            row.account_number === accountNumber
              ? {
                ...row,
                is_paid: payload?.is_paid ?? true,
                paid_at: payload?.paid_at ?? row.paid_at,
              }
              : row
          )
        )
        await fetchBillingRows()
      } catch (err) {
        logApiError(err)
        setError("Failed to update provider billing status.")
      } finally {
        setPayingByAccountNumber((prev) => {
          const next = { ...prev }
          delete next[accountNumber]
          return next
        })
      }
    }

    const markAllPaid = async () => {
      if (markAllLoading) return
      setMarkAllLoading(true)
      setError('')
      try {
        await apiClient.post('/admin/billing/mark-all-paid', {
          cycle_month: cycleMonth,
        })
        await fetchBillingRows()
      } catch (err) {
        logApiError(err)
        setError('Failed to update provider billing status.')
      } finally {
        setMarkAllLoading(false)
      }
    }

    const toggleProviderSuspension = async (accountNumber, shouldSuspend) => {
      if (!accountNumber) {
        setError('Missing account number for provider; billing rows must include account_number')
        console.error('Missing account number for provider suspension request.')
        return
      }

      if (suspendingByAccountNumber[accountNumber]) return

      if (import.meta.env?.DEV) {
        console.log('[billing] toggle suspend click', {
          accountNumber,
          currentSuspended: !shouldSuspend,
          nextSuspended: shouldSuspend,
        })
        console.log('[billing] POST', '/admin/providers/suspension')
      }

      setSuspendingByAccountNumber((prev) => ({ ...prev, [accountNumber]: true }))

      try {
        const res = await apiClient.post('/admin/providers/suspension', {
          account_number: accountNumber,
          is_suspended: shouldSuspend,
        })
        const responsePayload = res?.data
        const hasServerSuspensionValue = typeof responsePayload?.is_suspended === 'boolean'
        const nextSuspended = hasServerSuspensionValue ? responsePayload.is_suspended : shouldSuspend

        if (import.meta.env?.DEV) {
          console.log('[billing] OK', res.status, res.data)
        }

        setBillingRows((prev) =>
          prev.map((row) =>
            row.account_number === accountNumber
              ? { ...row, is_suspended: nextSuspended }
              : row
          )
        )

        if (!hasServerSuspensionValue) {
          await fetchBillingRows()
        }
      } catch (err) {
        logApiError(err)
        setError(
          err?.response?.data?.detail
            || err?.response?.data?.message
            || 'Failed to update provider account status.'
        )
      } finally {
        setSuspendingByAccountNumber((prev) => {
          const next = { ...prev }
          delete next[accountNumber]
          return next
        })
      }
    }


    const normalizedSearch = searchTerm.trim().toLowerCase()

    const formatAmount = (value) =>
      Number(value ?? 0).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })

    const hasActiveFilters = Boolean(normalizedSearch)
    const filteredRows = hasActiveFilters
      ? billingRows.filter((row) => {
        const accountNumber = (row.account_number || '').toLowerCase()
        const phone = (row.phone || '').toLowerCase()
        const matchesSearch =
          !normalizedSearch ||
          accountNumber.includes(normalizedSearch) ||
          phone.includes(normalizedSearch)

        return matchesSearch
      })
      : billingRows

    const showEmptyState = hasLoaded && !loading && !error && billingRows.length === 0
    const showNoMatches = hasLoaded && !loading && !error && billingRows.length > 0 && filteredRows.length === 0

    const formatDueDate = (value) => {
      if (!value) return 'No bill yet'
      const parsed = new Date(value)
      if (Number.isNaN(parsed.getTime())) return 'Unknown date'
      return parsed.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    }

    return (
      <div className="admin-page">
        <div className="admin-header">
          <div>
            <p className="eyebrow">Billing</p>
            <h1>{`Provider Billing — ${selectedMonthLabel} ${selectedYear}`}</h1>
            <p className="header-subtitle">Monitor outstanding balances, search by account or phone, and mark charges as paid.</p>
          </div>
        </div>

        <div className="admin-card">
          <div className="billing-toolbar">
            <div className="billing-search">
              <label htmlFor="billing-search-input">Filter by account or phone</label>
              <input
                id="billing-search-input"
                type="search"
                placeholder="e.g. ACC-1234 or +592..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="billing-date-range">
              <label htmlFor="billing-cycle-month">Billing month</label>
              <div className="billing-date-range__inputs">
                <select
                  id="billing-cycle-month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                >
                  {monthOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="billing-date-range">
              <label htmlFor="billing-cycle-year">Year</label>
              <div className="billing-date-range__inputs">
                <select
                  id="billing-cycle-year"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                >
                  {yearOptions.map((yearOption) => (
                    <option key={yearOption} value={yearOption}>
                      {yearOption}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="billing-date-range">
              <label>&nbsp;</label>
              <div className="billing-date-range__inputs">
                <button
                  className="primary-btn"
                  onClick={markAllPaid}
                  disabled={loading || markAllLoading}
                >
                  {markAllLoading ? 'Marking all…' : 'Mark all paid'}
                </button>
              </div>
            </div>
            {loading && <span className="muted">Loading providers…</span>}
          </div>

          {error && <p className="form-error">{error}</p>}

          <div className="billing-table">
            <div className="billing-table__head">
              <span>Name</span>
              <span>Account number</span>
              <span>Phone number</span>
              <span>Amount due (platform fees)</span>
              <span>Bill credits</span>
              <span>Last due date</span>
              <span>Status</span>
              <span>Account status</span>
              <span className="sr-only">Actions</span>
            </div>
            {filteredRows.map((row) => {
              const isSuspended = row.is_suspended ?? row.isSuspended ?? row.is_locked ?? false
              const accountNumber = row.account_number
              const isSuspensionLoading = Boolean(
                accountNumber && suspendingByAccountNumber[accountNumber]
              )
              const isPaying = Boolean(
                accountNumber && payingByAccountNumber[accountNumber]
              )
              return (
              <div key={row.provider_id} className="billing-table__row">
                <div>
                  <p className="billing-provider">{row.name || 'Unnamed provider'}</p>
                  <p className="muted">ID #{row.provider_id}</p>
                </div>
                <strong>{row.account_number || 'N/A'}</strong>
                <span>{row.phone || 'No phone added'}</span>
                <strong>{formatAmount(row.amount_due_gyd)} GYD</strong>
                <strong>{formatAmount(row.bill_credits_gyd)} GYD</strong>
                <span>{formatDueDate(row.last_due_date)}</span>
                <span className={row.is_paid ? 'status-pill paid' : 'status-pill unpaid'}>
                  {row.is_paid ? 'Paid' : 'Unpaid'}
                </span>
                <span className={isSuspended ? 'status-pill unpaid' : 'status-pill paid'}>
                  {isSuspended ? 'Suspended' : 'Active'}
                </span>
                <div className="billing-actions">
                  <button
                    className={row.is_paid ? 'ghost-btn' : 'primary-btn'}
                    onClick={() => markProviderPaid(accountNumber)}
                    disabled={loading || isPaying || row.is_paid}
                  >
                    {row.is_paid ? 'Paid' : 'Mark as paid'}
                  </button>
                  <button
                    className={isSuspended ? 'primary-btn' : 'ghost-btn'}
                    onClick={() => toggleProviderSuspension(accountNumber, !isSuspended)}
                    disabled={isSuspensionLoading}
                  >
                    {isSuspended ? 'Reactivate account' : 'Suspend account'}
                  </button>
                </div>
              </div>
            )})}

            {showNoMatches && (
              <p className="muted">No providers match your current filters.</p>
            )}

            {showEmptyState && (
              <p className="muted">No providers match that account or phone.</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  const AdminProviderLocations = () => {
    const mapRef = React.useRef(null)
    const mapContainerRef = React.useRef(null)
    const markersLayerRef = React.useRef(null)
    const [providers, setProviders] = React.useState([])
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState('')
    const [mapReady, setMapReady] = React.useState(false)

    const normalizeProvider = (provider) => {
      const latitude =
        provider?.lat ??
        provider?.latitude ??
        provider?.location_lat ??
        provider?.location_latitude ??
        provider?.user?.lat ??
        provider?.profile?.lat
      const longitude =
        provider?.long ??
        provider?.lng ??
        provider?.longitude ??
        provider?.location_long ??
        provider?.location_longitude ??
        provider?.user?.long ??
        provider?.profile?.long
      const latValue = latitude === null || latitude === undefined ? null : Number(latitude)
      const longValue = longitude === null || longitude === undefined ? null : Number(longitude)

      return {
        provider_id: provider?.provider_id ?? provider?.id ?? provider?.providerId ?? provider?.providerID ?? null,
        name: provider?.name ?? provider?.provider_name ?? provider?.business_name ?? provider?.businessName ?? '',
        username:
          provider?.username ??
          provider?.user_name ??
          provider?.handle ??
          provider?.profile_username ??
          provider?.user?.username ??
          provider?.owner?.username ??
          provider?.profile?.username ??
          '',
        email:
          provider?.email ??
          provider?.email_address ??
          provider?.contact_email ??
          provider?.user?.email ??
          provider?.owner?.email ??
          provider?.profile?.email ??
          '',
        account_number:
          provider?.account_number ??
          provider?.accountNumber ??
          provider?.account ??
          provider?.provider?.account_number ??
          provider?.provider?.accountNumber ??
          '',
        phone:
          provider?.phone ??
          provider?.phone_number ??
          provider?.phoneNumber ??
          provider?.user?.phone ??
          provider?.owner?.phone ??
          provider?.profile?.phone ??
          provider?.profile?.phone_number ??
          '',
        lat: Number.isFinite(latValue) ? latValue : null,
        long: Number.isFinite(longValue) ? longValue : null,
        location: provider?.location ?? provider?.address ?? provider?.location_name ?? '',
      }
    }

    const extractProviderList = (payload) => {
      if (Array.isArray(payload)) return payload
      if (Array.isArray(payload?.providers)) return payload.providers
      if (Array.isArray(payload?.data)) return payload.data
      return []
    }

    const fetchProviderLocations = React.useCallback(async () => {
      setLoading(true)
      setError('')

      try {
        const res = await apiClient.get('/admin/providers/locations')
        const list = extractProviderList(res.data)
        if (import.meta.env?.DEV && list?.length) {
          console.log('[provider-locations] sample provider', list[0])
        }
        setProviders(list.map(normalizeProvider))
      } catch (err) {
        logApiError(err)
        setError('Unable to load provider locations. Please try again.')
        setProviders([])
      } finally {
        setLoading(false)
      }
    }, [])

    React.useEffect(() => {
      fetchProviderLocations()
    }, [fetchProviderLocations])

    const hasValidCoords = (provider) => Number.isFinite(provider.lat) && Number.isFinite(provider.long)
    const providersWithCoords = React.useMemo(
      () => providers.filter((provider) => hasValidCoords(provider)),
      [providers]
    )
    const providersWithoutCoords = React.useMemo(
      () => providers.filter((provider) => !hasValidCoords(provider)),
      [providers]
    )

    React.useEffect(() => {
      let isActive = true

      const initMap = async () => {
        if (!mapContainerRef.current || mapRef.current) return

        try {
          const L = await loadLeaflet()
          if (!isActive || mapRef.current) return
          const map = L.map(mapContainerRef.current, {
            zoomControl: true,
          }).setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM)

          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19,
          }).addTo(map)

          mapRef.current = map
          markersLayerRef.current = L.layerGroup().addTo(map)
          setMapReady(true)
        } catch (err) {
          if (import.meta.env?.DEV) {
            console.error('[provider-locations] Leaflet load failed', err)
          }
          setError('Unable to load the map at this time.')
        }
      }

      initMap()

      return () => {
        isActive = false
        if (mapRef.current) {
          mapRef.current.remove()
          mapRef.current = null
        }
        markersLayerRef.current = null
        setMapReady(false)
      }
    }, [])

    React.useEffect(() => {
      if (!mapReady || !mapRef.current || !markersLayerRef.current) return
      const L = window.L
      if (!L) return

      markersLayerRef.current.clearLayers()

      const bounds = []
      providersWithCoords.forEach((provider) => {
        const marker = L.marker([provider.lat, provider.long])
        const popupLines = [
          `<strong>${provider.name || 'Unnamed provider'}</strong>`,
          provider.account_number ? `Account: ${provider.account_number}` : null,
          provider.phone ? `Phone: ${provider.phone}` : null,
          provider.location ? provider.location : null,
        ].filter(Boolean)
        marker.bindPopup(popupLines.join('<br/>'))
        marker.addTo(markersLayerRef.current)
        bounds.push([provider.lat, provider.long])
      })

      if (bounds.length > 0) {
        mapRef.current.fitBounds(bounds, { padding: [40, 40] })
      } else {
        mapRef.current.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM)
      }
    }, [mapReady, providersWithCoords])

    const totalProviders = providers.length
    const providersWithPins = providersWithCoords.length
    const providersMissingCoords = providersWithoutCoords.length

    return (
      <div className="admin-page">
        <div className="admin-header">
          <div>
            <p className="eyebrow">Billing</p>
            <h1>Provider Locations</h1>
            <p className="header-subtitle">
              View where providers are located and spot areas with limited coverage.
            </p>
          </div>
        </div>

        <div className="admin-card">
          <div className="provider-location-summary">
            <div>
              <p className="muted">Providers with pins</p>
              <p className="provider-location-value">{providersWithPins}</p>
            </div>
            <div>
              <p className="muted">Total providers</p>
              <p className="provider-location-value">{totalProviders}</p>
            </div>
            <div>
              <p className="muted">Missing coordinates</p>
              <p className="provider-location-value">{providersMissingCoords}</p>
            </div>
          </div>

          {loading && <p className="muted">Loading provider coordinates…</p>}
          {error && <p className="form-error">{error}</p>}

          <div className="provider-map-wrapper">
            <div ref={mapContainerRef} className="provider-map" aria-label="Provider map" />
          </div>

          {providersWithoutCoords.length > 0 && (
            <div className="provider-missing-section">
              <div className="provider-missing-header">
                <h2>Providers missing pinned locations</h2>
                <p className="muted">
                  Contact these providers to add their map location.
                </p>
              </div>
              <div className="provider-missing-table">
                <table>
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Email</th>
                      <th>Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providersWithoutCoords.map((provider) => {
                      const displayUsername = provider.username || provider.name || '—'
                      const displayEmail = provider.email || '—'
                      const displayPhone = provider.phone || '—'

                      return (
                        <tr key={provider.provider_id ?? `${displayUsername}-${displayEmail}-${displayPhone}`}>
                          <td>{displayUsername}</td>
                          <td>{displayEmail}</td>
                          <td>{displayPhone}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  const AdminCancellations = () => {
    const location = useLocation()
    const navigate = useNavigate()
    const [rows, setRows] = React.useState([])
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState('')
    const [hasLoaded, setHasLoaded] = React.useState(false)

    const parseMonthYearFromSearch = React.useCallback((search) => {
      const params = new URLSearchParams(search)
      const rawMonth = params.get('month')
      const rawYear = params.get('year')
      if (!rawMonth || !rawYear) return null
      const month = Number(rawMonth)
      const year = Number(rawYear)
      if (month >= 1 && month <= 12 && Number.isFinite(year)) {
        return { month, year }
      }
      return null
    }, [])

    const initialMonthYear = React.useMemo(() => {
      const parsed = parseMonthYearFromSearch(location.search)
      if (parsed) return parsed
      const now = new Date()
      return { month: now.getMonth() + 1, year: now.getFullYear() }
    }, [location.search, parseMonthYearFromSearch])

    const [selectedMonth, setSelectedMonth] = React.useState(initialMonthYear.month)
    const [selectedYear, setSelectedYear] = React.useState(initialMonthYear.year)

    const monthOptions = React.useMemo(() => {
      return Array.from({ length: 12 }, (_, index) => {
        const month = index + 1
        const label = new Date(2000, index, 1).toLocaleDateString(undefined, { month: 'long' })
        return { value: month, label }
      })
    }, [])

    const yearOptions = React.useMemo(() => {
      const now = new Date()
      const baseYear = now.getFullYear()
      const years = new Set()
      for (let offset = -3; offset <= 3; offset += 1) {
        years.add(baseYear + offset)
      }
      years.add(selectedYear)
      return Array.from(years).sort((a, b) => a - b)
    }, [selectedYear])

    const selectedMonthLabel = React.useMemo(() => {
      const match = monthOptions.find((option) => option.value === selectedMonth)
      if (match) return match.label
      const parsed = new Date(2000, selectedMonth - 1, 1)
      if (Number.isNaN(parsed.getTime())) return String(selectedMonth)
      return parsed.toLocaleDateString(undefined, { month: 'long' })
    }, [selectedMonth, monthOptions])

    React.useEffect(() => {
      const parsed = parseMonthYearFromSearch(location.search)
      if (!parsed) return
      setSelectedMonth((prev) => (prev === parsed.month ? prev : parsed.month))
      setSelectedYear((prev) => (prev === parsed.year ? prev : parsed.year))
    }, [location.search, parseMonthYearFromSearch])

    React.useEffect(() => {
      const params = new URLSearchParams(location.search)
      params.set('month', String(selectedMonth))
      params.set('year', String(selectedYear))
      const nextSearch = params.toString()
      const currentSearch = location.search.replace(/^\?/, '')
      if (nextSearch === currentSearch) return
      navigate({ pathname: location.pathname, search: `?${nextSearch}` }, { replace: true })
    }, [location.pathname, location.search, navigate, selectedMonth, selectedYear])

    const extractRows = (payload) => {
      if (Array.isArray(payload)) return payload
      if (Array.isArray(payload?.data)) return payload.data
      if (Array.isArray(payload?.rows)) return payload.rows
      return []
    }

    const normalizeRow = (row) => {
      const providerCancelled = Number(row?.provider_cancelled_count ?? row?.provider_cancelled ?? 0)
      const customerCancelled = Number(row?.customer_cancelled_count ?? row?.customer_cancelled ?? 0)
      const total = Number(
        row?.total_cancellations ?? row?.total ?? providerCancelled + customerCancelled
      )
      return {
        provider_id: row?.provider_id ?? row?.providerId ?? row?.id ?? null,
        username: row?.username ?? row?.provider_username ?? row?.provider_name ?? '',
        email: row?.email ?? null,
        phone: row?.phone ?? null,
        provider_cancelled_count: Number.isFinite(providerCancelled) ? providerCancelled : 0,
        customer_cancelled_count: Number.isFinite(customerCancelled) ? customerCancelled : 0,
        total_cancellations: Number.isFinite(total) ? total : providerCancelled + customerCancelled,
      }
    }

    const fetchCancellations = React.useCallback(async () => {
      setLoading(true)
      setError('')
      try {
        const res = await apiClient.get('/admin/cancellations', {
          params: { month: selectedMonth, year: selectedYear },
        })
        const list = extractRows(res.data)
        setRows(list.map(normalizeRow))
      } catch (err) {
        logApiError(err)
        setError('Unable to load cancellation stats. Please try again.')
        setRows([])
      } finally {
        setLoading(false)
        setHasLoaded(true)
      }
    }, [selectedMonth, selectedYear])

    React.useEffect(() => {
      fetchCancellations()
    }, [fetchCancellations])

    const sortedRows = React.useMemo(() => {
      return [...rows].sort((a, b) => (b.total_cancellations ?? 0) - (a.total_cancellations ?? 0))
    }, [rows])

    const showEmptyState = hasLoaded && !loading && !error && sortedRows.length === 0

    return (
      <div className="admin-page">
        <div className="admin-header">
          <div>
            <p className="eyebrow">Provider Operations</p>
            <h1>{`Cancellations — ${selectedMonthLabel} ${selectedYear}`}</h1>
            <p className="header-subtitle">
              Review monthly cancellations to spot providers canceling on customers.
            </p>
          </div>
        </div>

        <div className="admin-card">
          <div className="billing-toolbar">
            <div className="billing-date-range">
              <label htmlFor="cancellations-month">Month</label>
              <div className="billing-date-range__inputs">
                <select
                  id="cancellations-month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                >
                  {monthOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="billing-date-range">
              <label htmlFor="cancellations-year">Year</label>
              <div className="billing-date-range__inputs">
                <select
                  id="cancellations-year"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                >
                  {yearOptions.map((yearOption) => (
                    <option key={yearOption} value={yearOption}>
                      {yearOption}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {loading && <span className="muted">Loading cancellations…</span>}
          </div>

          {error && <p className="form-error">{error}</p>}

          <div className="cancellations-table">
            <div className="cancellations-table__head">
              <span>Provider</span>
              <span>Email</span>
              <span>Phone</span>
              <span>Provider cancelled</span>
              <span>Customer cancelled</span>
              <span>Total</span>
            </div>
            {sortedRows.map((row) => {
              const displayEmail = row.email || '—'
              const displayPhone = row.phone || '—'
              return (
                <div
                  key={row.provider_id ?? `${row.username}-${row.email}-${row.phone}`}
                  className="cancellations-table__row"
                >
                  <strong>{row.username || '—'}</strong>
                  <span>{displayEmail}</span>
                  <span>{displayPhone}</span>
                  <span>{row.provider_cancelled_count}</span>
                  <span>{row.customer_cancelled_count}</span>
                  <strong>{row.total_cancellations}</strong>
                </div>
              )
            })}
          </div>

          {showEmptyState && (
            <p className="muted">No cancellations found for this month.</p>
          )}
        </div>
      </div>
    )
  }

  const AdminSignupReport = () => {
    const [startDate, setStartDate] = React.useState(() => {
      const today = new Date()
      const start = new Date()
      start.setDate(today.getDate() - 6)
      return formatDateInput(start)
    })
    const [endDate, setEndDate] = React.useState(() => formatDateInput(new Date()))
    const [report, setReport] = React.useState(null)
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState('')

    const runReport = React.useCallback(async () => {
      const parsedStart = parseDateInput(startDate)
      const parsedEnd = parseDateInput(endDate)

      if (!parsedStart || !parsedEnd) {
        setError('Start and end dates are required.')
        return
      }

      if (parsedStart > parsedEnd) {
        setError('Start date must be on or before end date.')
        return
      }

      setLoading(true)
      setError('')
      try {
        const res = await apiClient.get('/admin/reports/signups', {
          params: { start: startDate, end: endDate },
        })
        setReport(res.data)
      } catch (err) {
        logApiError(err)
        setError('Unable to load signup counts. Please try again.')
        setReport(null)
      } finally {
        setLoading(false)
      }
    }, [endDate, startDate])

    React.useEffect(() => {
      runReport()
    }, [runReport])

    return (
      <div className="admin-page">
        <div className="admin-header">
          <div>
            <p className="eyebrow">Reports</p>
            <h1>Signups Report</h1>
            <p className="header-subtitle">Track new provider and client signups over a selected date range.</p>
          </div>
        </div>

        <div className="admin-card">
          <div className="form-grid">
            <label className="form-field">
              <span>Start date</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="form-field">
              <span>End date</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          </div>
          <div className="button-row">
            <button
              className="primary-btn"
              onClick={runReport}
              disabled={loading}
            >
              {loading ? 'Running…' : 'Run report'}
            </button>
            <span className="muted">Default: last 7 days</span>
          </div>

          {error && <p className="form-error">{error}</p>}
          {loading && !error && <p className="muted">Loading signups…</p>}

          <div className="provider-location-summary">
            <div>
              <p className="muted">New provider signups</p>
              <p className="provider-location-value">{report ? report.providers : '—'}</p>
            </div>
            <div>
              <p className="muted">New client signups</p>
              <p className="provider-location-value">{report ? report.clients : '—'}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const AdminLayout = () => {
    const location = useLocation()
    return (
      <div className="admin-shell">
        <aside className="admin-sidebar">
          <nav className="sidebar-nav">
            <NavLink to="/admin/promotions" className={({ isActive }) => isActive ? 'sidebar-link active' : 'sidebar-link'}>
              Promotions
            </NavLink>
            <NavLink to="/admin/service-charge" className={({ isActive }) => isActive ? 'sidebar-link active' : 'sidebar-link'}>
              Service Charge
            </NavLink>
            <NavLink to="/admin/billing" className={({ isActive }) => isActive ? 'sidebar-link active' : 'sidebar-link'}>
              Billing
            </NavLink>
            <NavLink
              to="/admin/provider-locations"
              className={({ isActive }) => isActive ? 'sidebar-link active' : 'sidebar-link'}
            >
              Provider Locations
            </NavLink>
            <NavLink
              to="/admin/cancellations"
              className={({ isActive }) => isActive ? 'sidebar-link active' : 'sidebar-link'}
            >
              Cancellations
            </NavLink>
            <NavLink
              to="/admin/signups"
              className={({ isActive }) => isActive ? 'sidebar-link active' : 'sidebar-link'}
            >
              Signups Report
            </NavLink>
          </nav>
          <div className="sidebar-footer">
            Logged in · {token ? 'Authenticated' : 'Guest'}
          </div>
        </aside>
        <main className="admin-main" key={location.pathname}>
          <Outlet />
        </main>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <nav className="app-nav">
        <div className="nav-inner">
          <Link to="/" className="nav-brand" aria-label="BookitGY home">
            <img src="/bookitgy-logo.png" alt="BookitGY" />
            <div className="brand-text">
              <span className="brand-name">BookitGY</span>
              <span className="brand-subtitle">BookitGY</span>
            </div>
          </Link>
          <div className="nav-actions">
            {token ? (
              <button
                className="nav-button danger"
                onClick={() => {
                  localStorage.removeItem('token')
                  setToken('')
                }}
              >
                Logout
              </button>
            ) : (
              <Link className="nav-button" to="/login">
                Login
              </Link>
            )}
          </div>
        </div>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/p/:username" element={<ProviderLanding />} />
        <Route
          path="/admin"
          element={(
            <ProtectedRoute>
              <AdminLayout />
            </ProtectedRoute>
          )}
        >
          <Route index element={<Navigate to="/admin/promotions" replace />} />
          <Route path="promotions" element={<AdminPromotions />} />
          <Route path="service-charge" element={<ServiceChargeSettings />} />
          <Route path="billing" element={<AdminBilling />} />
          <Route path="provider-locations" element={<AdminProviderLocations />} />
          <Route path="cancellations" element={<AdminCancellations />} />
          <Route path="signups" element={<AdminSignupReport />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
