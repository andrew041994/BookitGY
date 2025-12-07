import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import axios from 'axios'
import 'os'

const API = 'http://localhost:8000'





function App() {
  const [token, setToken] = React.useState(localStorage.getItem('token') || '')
  const [user, setUser] = React.useState(null)

  // Simple login for demo
  const Login = () => {
    const login = async (e) => {
      e.preventDefault()
      const form = e.target
      try {
        const res = await axios.post(`${API}/auth/login`, new URLSearchParams({
          username: form.email.value,
          password: form.password.value
        }))
        localStorage.setItem('token', res.data.access_token)
        setToken(res.data.access_token)
        alert('Logged in!')
      } catch {
        alert('Wrong credentials – try customer@guyana.com / pass')
      }
    }

    return (
      <form onSubmit={login} className="max-w-md mx-auto mt-20 p-6 border rounded">
        <h1 className="text-3xl mb-6 text-center">Guyana Booker</h1>
        <input name="email" defaultValue="customer@guyana.com" className="block w-full p-2 border mb-4" placeholder="Email" />
        <input name="password" type="password" defaultValue="pass" className="block w-full p-2 border mb-4" placeholder="Password" />
        <button className="w-full bg-blue-600 text-white py-3">Login</button>
      </form>
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
    <div className="text-center mt-20">
      <h1 className="text-6xl font-bold text-green-600 mb-8">Guyana Booker is LIVE!</h1>
      <p className="text-xl">Booksy-style booking app for Guyana</p>
      {token && <Link to="/admin/promotions" className="inline-block mt-10 bg-blue-600 text-white px-8 py-4 rounded text-xl">Go to Admin → Editable Promotions</Link>}
    </div>
  )

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