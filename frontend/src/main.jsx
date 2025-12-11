import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom'
import axios from 'axios'
import './login.css'

const API = 'http://localhost:8000'

function App() {
  const [token, setToken] = React.useState(localStorage.getItem('token') || '')
  const [user, setUser] = React.useState(null)

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
    const [providerId, setProviderId] = React.useState('1')
    const [free, setFree] = React.useState('20')

    const apply = async () => {
      await axios.put(`${API}/admin/promotions/${providerId}`, { free_bookings_total: Number(free) }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      alert(`Promotion applied! Provider ${providerId} now has ${free} free bookings`)
    }

    return (
      <div className="p-10">
        <h1 className="text-4xl mb-8">Admin – Editable Promotions</h1>
        <div className="bg-gray-100 p-8 rounded max-w-lg">
          <input value={providerId} onChange={e => setProviderId(e.target.value)} className="border p-3 mr-4" placeholder="Provider ID" />
          <input value={free} onChange={e => setFree(e.target.value)} className="border p-3 mr-4" placeholder="Free bookings" />
          <button onClick={apply} className="bg-green-600 text-white px-6 py-3 rounded">Apply Promotion</button>
        </div>
        <p className="mt-6 text-gray-600">Example: Give provider ID 1 → 50 free bookings anytime!</p>
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
        <h1>Guyana Booker Admin</h1>
        <p className="subtitle">
          Modern tools for managing providers, bookings, and promotions—protected behind a secure login.
        </p>

        <div className="landing-actions">
          <Link className="primary-btn" to={token ? '/admin/promotions' : '/login'}>
            {token ? 'Go to dashboard' : 'Login'}

          </Link>
        {/* STOP */}
          {!token && (
            <p className="credentials-hint">
              Demo login: <strong>customer@guyana.com</strong> / <strong>pass</strong>
            </p>
       
          )}
        </div>
      </div>
    </div>
  )

  return (
    <BrowserRouter>
      <nav className="app-nav">
        <div className="nav-inner">
          <Link to="/" className="nav-brand" aria-label="BookitGY home">
            <img src="/bookitgy-logo.png" alt="BookitGY" />
            <div className="brand-text">
              <span className="brand-name">BookitGY</span>
              <span className="brand-subtitle">Guyana Booker</span>
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
        <Route path="/admin/promotions" element={token ? <AdminPromotions /> : <Login />} />
      </Routes>
    </BrowserRouter>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)