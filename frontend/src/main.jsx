import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom'
import axios from 'axios'
import 'os'
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

  // Simple login for demo
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
            <h1>Welcome back to Guyana Booker</h1>
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
const distanceBetween = (coordA, coordB) => {
    // Haversine formula
    const toRad = (deg) => (deg * Math.PI) / 180
    const R = 6371 // Earth radius in km
    const dLat = toRad(coordB.lat - coordA.lat)
    const dLon = toRad(coordB.long - coordA.long)

    const lat1 = toRad(coordA.lat)
    const lat2 = toRad(coordB.lat)

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

    return R * c
  }

  const Home = () => {
    const [providers, setProviders] = React.useState([])
    const [nearbyProviders, setNearbyProviders] = React.useState([])
    const [locationError, setLocationError] = React.useState('')
    const [clientCoords, setClientCoords] = React.useState(null)
    const [currentIndex, setCurrentIndex] = React.useState(0)

    React.useEffect(() => {
      axios
        .get(`${API}/providers`)
        .then((res) => setProviders(res.data || []))
        .catch(() => setProviders([]))
    }, [])

    React.useEffect(() => {
      if (!('geolocation' in navigator)) {
        setLocationError('Geolocation is not supported on this device.')
        return
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setClientCoords({ lat: pos.coords.latitude, long: pos.coords.longitude })
          setLocationError('')
        },
        (err) => {
          console.error('Location error', err)
          setLocationError('We could not access your location. Please enable location services.')
        },
        { enableHighAccuracy: true, maximumAge: 300000, timeout: 10000 }
      )
    }, [])

    React.useEffect(() => {
      if (!clientCoords || !providers.length) return

      const nearby = providers
        .filter((p) => p.lat !== null && p.lat !== undefined && p.long !== null && p.long !== undefined)
        .map((p) => ({ ...p, distanceKm: distanceBetween(clientCoords, { lat: p.lat, long: p.long }) }))
        .filter((p) => p.distanceKm <= 15)
        .sort((a, b) => a.distanceKm - b.distanceKm)

      setNearbyProviders(nearby)
      setCurrentIndex(0)
    }, [clientCoords, providers])

    const visibleProviders = React.useMemo(() => {
      if (!nearbyProviders.length) return []
      const slots = Math.min(3, nearbyProviders.length)
      return Array.from({ length: slots }, (_, idx) => nearbyProviders[(currentIndex + idx) % nearbyProviders.length])
    }, [currentIndex, nearbyProviders])

    const next = () => {
      if (!nearbyProviders.length) return
      setCurrentIndex((prev) => (prev + 1) % nearbyProviders.length)
    }

    const prev = () => {
      if (!nearbyProviders.length) return
      setCurrentIndex((prev) => (prev - 1 + nearbyProviders.length) % nearbyProviders.length)
    }

    return (
      <div className="text-center mt-20 px-4">
        <h1 className="text-6xl font-bold text-green-600 mb-4">Guyana Booker is LIVE!</h1>
        <p className="text-xl mb-12">booking app for Guyana</p>
        {token && (
          <Link
            to="/admin/promotions"
            className="inline-block bg-blue-600 text-white px-8 py-4 rounded text-xl"
          >
            Go to Admin → Editable Promotions
          </Link>
        )}

        <div className="max-w-6xl mx-auto mt-16">
          <div className="flex items-center justify-between mb-6">
            <div className="text-left">
              <h2 className="text-3xl font-semibold">Nearby providers</h2>
              <p className="text-gray-600">Showing options within a 15 km radius of you.</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={prev}
                className="bg-gray-200 px-4 py-2 rounded disabled:opacity-50"
                disabled={!nearbyProviders.length}
              >
                ‹ Prev
              </button>
              <button
                onClick={next}
                className="bg-gray-200 px-4 py-2 rounded disabled:opacity-50"
                disabled={!nearbyProviders.length}
              >
                Next ›
              </button>
            </div>
          </div>

          {locationError && <p className="text-red-600 mb-4">{locationError}</p>}
          {!locationError && !clientCoords && <p className="text-gray-500 mb-4">Requesting your location…</p>}

          {nearbyProviders.length === 0 && clientCoords && (
            <div className="text-left bg-yellow-50 border border-yellow-200 p-6 rounded">
              <p className="font-semibold mb-2">No providers within 15 km yet.</p>
              <p className="text-gray-700">Try widening your search area or checking back soon.</p>
            </div>
          )}

          {visibleProviders.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {visibleProviders.map((provider) => (
                <div
                  key={provider.provider_id}
                  className="border rounded-lg shadow-sm p-6 text-left bg-white"
                  style={{ minHeight: '230px' }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xl font-semibold">{provider.name}</h3>
                    <span className="text-sm bg-green-100 text-green-800 px-3 py-1 rounded-full">
                      {provider.distanceKm.toFixed(1)} km away
                    </span>
                  </div>
                  <p className="text-gray-700 mb-3">{provider.location || 'Location not provided'}</p>
                  {provider.professions?.length ? (
                    <p className="text-gray-600 mb-4">{provider.professions.join(' • ')}</p>
                  ) : (
                    <p className="text-gray-500 mb-4">Profession details coming soon.</p>
                  )}
                  <p className="text-gray-600 text-sm">{provider.bio || 'No bio yet.'}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }


  return (
    <BrowserRouter>
      <nav className="bg-blue-800 text-white p-6">
        <div className="max-w-6xl mx-auto flex justify-between">
           <Link to="/" className="flex items-center gap-3">
            <img
              src="/bookitgy-logo.png"   // or .png / .jpg
              alt="BookitGY"
              className="h-9 w-auto"
            />
            {/* keep text only for accessibility, not visually */}
          </Link>
          {token ? <button onClick={() => { localStorage.removeItem('token'); setToken('') }} className="bg-red-600 px-6 py-2 rounded">Logout</button> : <Link to="/login">Login</Link>}
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