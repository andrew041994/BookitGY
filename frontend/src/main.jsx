import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Link, NavLink, useNavigate, Navigate, Outlet, useLocation } from 'react-router-dom'
import axios from 'axios'
import './login.css'

const API = 'http://localhost:8000'
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
      axios.defaults.headers.common.Authorization = `Bearer ${token}`
    } else {
      delete axios.defaults.headers.common.Authorization
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
        const res = await axios.post(`${API}/auth/login`, new URLSearchParams({
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

  const AdminPromotions = () => {
    const [accountNumber, setAccountNumber] = React.useState('ACC-')
    const [credit, setCredit] = React.useState('2000')

    const apply = async () => {
      await axios.put(`${API}/admin/promotions/${accountNumber}`, { credit_gyd: Number(credit) }, {
        headers: { Authorization: `Bearer ${token}` }
      })
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
          const res = await axios.get(`${API}/admin/service-charge`)
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
        const res = await axios.put(`${API}/admin/service-charge`, {
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
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
