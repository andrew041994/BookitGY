import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Link, NavLink, useNavigate, Navigate, Outlet, useLocation } from 'react-router-dom'
import { apiClient, logApiError } from './lib/api'
import ProviderLanding from './ProviderLanding'
import './login.css'

const DEFAULT_SERVICE_CHARGE = 10
const SERVICE_CHARGE_STORAGE_KEY = 'bookitgy.service_charge_rate'

const normalizeServiceCharge = (value) => Math.max(0, Math.min(100, Number(value) || 0))

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

  const AdminBilling = () => {
    const [billingRows, setBillingRows] = React.useState([])
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState('')
    const [hasLoaded, setHasLoaded] = React.useState(false)
    const [searchTerm, setSearchTerm] = React.useState('')
    const [startDate, setStartDate] = React.useState('')
    const [endDate, setEndDate] = React.useState('')
    const [bulkUpdating, setBulkUpdating] = React.useState(false)

    const fetchBillingRows = React.useCallback(async () => {
      setLoading(true)
      setError('')
      try {
        const res = await apiClient.get('/admin/billing')
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
    }, [])

    React.useEffect(() => {
      fetchBillingRows()
    }, [fetchBillingRows])

    const updateProviderStatus = async (providerId, isPaid) => {
      // optimistic update (UI changes instantly)
      setBillingRows((prev) =>
        prev.map((row) =>
          row.provider_id === providerId ? { ...row, is_paid: isPaid } : row
        )
      )

      try {
        await apiClient.put(
          `/admin/billing/${providerId}/status`,
          { is_paid: isPaid }
        )

        // OPTIONAL: if you want truth from server, refetch after success
        // await fetchBillingRows()
      } catch (err) {
        logApiError(err)
        setError("Failed to update provider billing status.")
        // rollback safely
        fetchBillingRows()
      }
    }


    const toggleProviderLock = async (providerId, shouldLock) => {
      setBillingRows((prev) =>
        prev.map((row) =>
          row.provider_id === providerId ? { ...row, is_locked: shouldLock } : row
        )
      )

      try {
        await apiClient.put(
          `/admin/billing/${providerId}/lock`,
          { is_locked: shouldLock }
        )

        await fetchBillingRows()
      } catch (err) {
        logApiError(err)
        setError('Failed to update provider account status.')
        fetchBillingRows()
      }
    }


    const markAll = async (isPaid) => {
      if (!billingRows.length) return
      setBulkUpdating(true)
      setError('')

      // Optimistic UI update
      setBillingRows((prev) => prev.map((row) => ({ ...row, is_paid: isPaid })))

      try {
        await Promise.all(
          billingRows.map((row) =>
            apiClient.put(
              `/admin/billing/${row.provider_id}/status`,
              { is_paid: isPaid }
            )
          )
        )

        // Single refetch = clean + guaranteed correct
        await fetchBillingRows()
      } catch (err) {
        logApiError(err)
        setError('Failed to update all provider statuses.')
        await fetchBillingRows()
      } finally {
        setBulkUpdating(false)
      }
    }



    const normalizedSearch = searchTerm.trim().toLowerCase()

    const formatAmount = (value) =>
      Number(value ?? 0).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })
    const isWithinDateRange = (row) => {
      if (!startDate && !endDate) return true
      if (!row.last_due_date) return false

      const dueDate = new Date(row.last_due_date)
      if (Number.isNaN(dueDate.getTime())) return false

      if (startDate) {
        const start = new Date(startDate)
        start.setHours(0, 0, 0, 0)
        if (dueDate < start) return false
      }

      if (endDate) {
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999)
        if (dueDate > end) return false
      }

      return true
    }

    const hasActiveFilters = Boolean(normalizedSearch || startDate || endDate)
    const filteredRows = hasActiveFilters
      ? billingRows.filter((row) => {
        const accountNumber = (row.account_number || '').toLowerCase()
        const phone = (row.phone || '').toLowerCase()
        const matchesSearch =
          !normalizedSearch ||
          accountNumber.includes(normalizedSearch) ||
          phone.includes(normalizedSearch)

        return matchesSearch && isWithinDateRange(row)
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
            <h1>Provider Billing</h1>
            <p className="header-subtitle">Monitor outstanding balances, search by account or phone, and mark charges as paid.</p>
          </div>
          <div className="button-row">
            <button className="ghost-btn" onClick={() => markAll(false)} disabled={bulkUpdating || loading}>Mark all unpaid</button>
            <button className="primary-btn" onClick={() => markAll(true)} disabled={bulkUpdating || loading}>Mark all paid</button>
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
              <label>Date range (last due date)</label>
              <div className="billing-date-range__inputs">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  aria-label="Start date"
                />
                <span aria-hidden="true">—</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  aria-label="End date"
                />
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
              <span>Last due date</span>
              <span>Status</span>
              <span>Account status</span>
              <span className="sr-only">Actions</span>
            </div>
            {filteredRows.map((row) => (
              <div key={row.provider_id} className="billing-table__row">
                <div>
                  <p className="billing-provider">{row.name || 'Unnamed provider'}</p>
                  <p className="muted">ID #{row.provider_id}</p>
                </div>
                <strong>{row.account_number || 'N/A'}</strong>
                <span>{row.phone || 'No phone added'}</span>
                <strong>{formatAmount(row.amount_due_gyd)} GYD</strong>
                <span>{formatDueDate(row.last_due_date)}</span>
                <span className={row.is_paid ? 'status-pill paid' : 'status-pill unpaid'}>
                  {row.is_paid ? 'Paid' : 'Unpaid'}
                </span>
                <span className={row.is_locked ? 'status-pill unpaid' : 'status-pill paid'}>
                  {row.is_locked ? 'Suspended' : 'Active'}
                </span>
                <div className="billing-actions">
                  <button className="ghost-btn" onClick={() => updateProviderStatus(row.provider_id, false)} disabled={loading}>
                    Unpaid
                  </button>
                  <button className="primary-btn" onClick={() => updateProviderStatus(row.provider_id, true)} disabled={loading}>
                    Paid
                  </button>
                  <button
                    className={row.is_locked ? 'primary-btn' : 'ghost-btn'}
                    onClick={() => toggleProviderLock(row.provider_id, !row.is_locked)}
                    disabled={loading}
                  >
                    {row.is_locked ? 'Restore account' : 'Suspend account'}
                  </button>
                </div>
              </div>
            ))}

            {showNoMatches && (
              <p className="muted">No providers match your current filters.</p>
            )}

            {showEmptyState && (
              <p className="muted">No providers match that account, phone, or date range.</p>
            )}
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
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
