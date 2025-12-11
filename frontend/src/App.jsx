import React, { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import axios from 'axios';

const API = 'http://localhost:8000';

const sampleProviders = [
  {
    id: 1,
    name: 'Ariana De Freitas',
    location: 'Georgetown',
    lat: 6.8013,
    long: -58.155,
    outstanding: 32000,
    credit: 5000,
    isLocked: false,
    lastActive: '2024-10-10',
    totalBookings: 42,
    cancellations: 3,
    noShows: 1,
    services: ['Makeup', 'Hair Styling'],
  },
  {
    id: 2,
    name: 'Jamall Adams',
    location: 'East Bank',
    lat: 6.7484,
    long: -58.2439,
    outstanding: 18000,
    credit: 0,
    isLocked: false,
    lastActive: '2024-09-28',
    totalBookings: 18,
    cancellations: 4,
    noShows: 0,
    services: ['Barber', 'Beard Trim'],
  },
  {
    id: 3,
    name: 'Kittisha Jones',
    location: 'Kitty',
    lat: 6.8236,
    long: -58.151,
    outstanding: 52000,
    credit: 15000,
    isLocked: true,
    lastActive: '2024-08-30',
    totalBookings: 7,
    cancellations: 2,
    noShows: 1,
    services: ['Massage'],
  },
  {
    id: 4,
    name: 'Linden Collective',
    location: 'Linden',
    lat: 5.9896,
    long: -58.2705,
    outstanding: 12000,
    credit: 0,
    isLocked: false,
    lastActive: '2024-10-11',
    totalBookings: 26,
    cancellations: 1,
    noShows: 0,
    services: ['Spa', 'Nails'],
  },
];

const sampleCharges = [
  { id: 101, providerId: 1, month: '2024-10-01', amount: 26000, isPaid: false },
  { id: 102, providerId: 1, month: '2024-09-01', amount: 15000, isPaid: true },
  { id: 103, providerId: 2, month: '2024-10-01', amount: 9000, isPaid: false },
  { id: 104, providerId: 3, month: '2024-10-01', amount: 22000, isPaid: false },
  { id: 105, providerId: 4, month: '2024-10-01', amount: 12000, isPaid: true },
];

const sampleBookings = [
  { id: 1, providerId: 1, clientId: 10, status: 'completed', startTime: '2024-10-12T12:00:00Z' },
  { id: 2, providerId: 1, clientId: 11, status: 'cancelled', startTime: '2024-10-12T15:00:00Z' },
  { id: 3, providerId: 2, clientId: 12, status: 'completed', startTime: '2024-10-11T16:00:00Z' },
  { id: 4, providerId: 2, clientId: 13, status: 'pending', startTime: '2024-10-10T10:00:00Z' },
  { id: 5, providerId: 3, clientId: 14, status: 'no-show', startTime: '2024-10-01T10:00:00Z' },
  { id: 6, providerId: 4, clientId: 10, status: 'completed', startTime: '2024-10-12T09:00:00Z' },
  { id: 7, providerId: 4, clientId: 16, status: 'cancelled', startTime: '2024-09-15T09:00:00Z' },
  { id: 8, providerId: 1, clientId: 15, status: 'completed', startTime: '2024-10-10T09:00:00Z' },
];

const signupHistory = [
  { month: 'Jun', providers: 10, clients: 54 },
  { month: 'Jul', providers: 14, clients: 62 },
  { month: 'Aug', providers: 21, clients: 70 },
  { month: 'Sep', providers: 33, clients: 82 },
  { month: 'Oct', providers: 40, clients: 95 },
];

function Login() {
  const [email, setEmail] = useState('customer@guyana.com');
  const [password, setPassword] = useState('pass');

  const login = async () => {
    try {
      const res = await axios.post(`${API}/auth/login`, new URLSearchParams({
        username: email,
        password: password,
      }));
      localStorage.setItem('token', res.data.access_token);
      alert('Logged in! Refresh page');
    } catch {
      alert('Wrong credentials');
    }
  };

  return (
    <div style={{ textAlign: 'center', marginTop: '100px' }}>
      <h1 style={{ color: '#16a34a' }}>Guyana Booker Web</h1>
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        style={{ display: 'block', margin: '10px auto', padding: '10px', width: '300px' }}
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        style={{ display: 'block', margin: '10px auto', padding: '10px', width: '300px' }}
      />
      <button onClick={login} style={{ padding: '10px 20px', background: '#16a34a', color: 'white', border: 'none' }}>
        Login
      </button>
      <p>Use customer@guyana.com / pass</p>
    </div>
  );
}

function AdminSignup() {
  const [fullName, setFullName] = useState('Admin User');
  const [email, setEmail] = useState('admin@guyana.com');
  const [password, setPassword] = useState('changeMe123!');
  const [phone, setPhone] = useState('+5926000000');
  const [location, setLocation] = useState('Georgetown');
  const [status, setStatus] = useState(null);

  const signup = async () => {
    setStatus(null);
    try {
      await axios.post(`${API}/auth/signup`, {
        email,
        password,
        full_name: fullName,
        phone,
        location,
        is_admin: true,
      });
      setStatus({ type: 'success', message: 'Admin account created! You can now log in.' });
    } catch (err) {
      const detail = err?.response?.data?.detail || 'Unable to create admin user';
      setStatus({ type: 'error', message: detail });
    }
  };

  return (
    <div style={{ maxWidth: '480px', margin: '80px auto', padding: '20px', border: '1px solid #e5e7eb', borderRadius: '12px', background: 'white' }}>
      <h1 style={{ color: '#16a34a', textAlign: 'center' }}>Create Admin Account</h1>
      <p style={{ color: '#6b7280', textAlign: 'center' }}>
        This will register an admin user who can access the dashboard and manage providers.
      </p>
      <label style={{ display: 'block', marginTop: '12px', fontWeight: 600 }}>Full name</label>
      <input
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        placeholder="Full name"
        style={{ display: 'block', width: '100%', padding: '10px', borderRadius: '10px', border: '1px solid #d1d5db' }}
      />

      <label style={{ display: 'block', marginTop: '12px', fontWeight: 600 }}>Email</label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        style={{ display: 'block', width: '100%', padding: '10px', borderRadius: '10px', border: '1px solid #d1d5db' }}
      />

      <label style={{ display: 'block', marginTop: '12px', fontWeight: 600 }}>Password</label>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        style={{ display: 'block', width: '100%', padding: '10px', borderRadius: '10px', border: '1px solid #d1d5db' }}
      />

      <label style={{ display: 'block', marginTop: '12px', fontWeight: 600 }}>Phone</label>
      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Phone number"
        style={{ display: 'block', width: '100%', padding: '10px', borderRadius: '10px', border: '1px solid #d1d5db' }}
      />

      <label style={{ display: 'block', marginTop: '12px', fontWeight: 600 }}>Location</label>
      <input
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder="Location"
        style={{ display: 'block', width: '100%', padding: '10px', borderRadius: '10px', border: '1px solid #d1d5db' }}
      />

      <button
        onClick={signup}
        style={{ width: '100%', marginTop: '18px', padding: '12px', background: '#16a34a', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 700 }}
      >
        Create Admin
      </button>

      {status && (
        <div
          style={{
            marginTop: '12px',
            padding: '10px',
            borderRadius: '10px',
            color: status.type === 'success' ? '#166534' : '#991b1b',
            background: status.type === 'success' ? '#dcfce7' : '#fee2e2',
          }}
        >
          {status.message}
        </div>
      )}

      <div style={{ marginTop: '14px', textAlign: 'center' }}>
        <Link to="/login" style={{ color: '#16a34a', fontWeight: 600 }}>Back to login</Link>
      </div>
    </div>
  );
}

function Home() {
  return (
    <div style={{ textAlign: 'center', marginTop: '100px' }}>
      <h1 style={{ color: '#16a34a' }}>Welcome to Guyana Booker Web!</h1>
      <p>Your Booksy clone is LIVE on web + mobile</p>
      <div style={{ marginTop: '20px' }}>
        <Link to="/admin" style={{ color: '#16a34a', fontWeight: 'bold' }}>
          Go to Admin Dashboard
        </Link>
      </div>
      <div style={{ marginTop: '12px' }}>
        <Link to="/admin/signup" style={{ color: '#16a34a', fontWeight: 'bold' }}>
          Create an Admin Account
        </Link>
      </div>
    </div>
  );
}

function StatCard({ label, value, helper }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px', background: 'white' }}>
      <div style={{ fontSize: '12px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827', margin: '4px 0' }}>{value}</div>
      {helper && <div style={{ fontSize: '12px', color: '#9ca3af' }}>{helper}</div>}
    </div>
  );
}

function ReportSection({ title, children }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px', background: 'white', marginBottom: '16px' }}>
      <div style={{ fontWeight: 700, marginBottom: '12px', color: '#111827' }}>{title}</div>
      {children}
    </div>
  );
}

function ProgressRow({ label, value, total, accent }) {
  const percent = total ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '4px' }}>
        <span>{label}</span>
        <span style={{ color: '#6b7280' }}>{value}</span>
      </div>
      <div style={{ background: '#e5e7eb', borderRadius: '999px', height: '8px' }}>
        <div
          style={{
            width: `${percent}%`,
            background: accent || '#16a34a',
            height: '8px',
            borderRadius: '999px',
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}

function useLeafletMap(providers) {
  useEffect(() => {
    const ensureLeaflet = () => {
      const existingScript = document.querySelector('script[data-leaflet]');
      const existingLink = document.querySelector('link[data-leaflet]');
      if (!existingLink) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        link.dataset.leaflet = 'true';
        document.head.appendChild(link);
      }
      if (!existingScript) {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.async = true;
        script.dataset.leaflet = 'true';
        script.onload = initMap;
        document.body.appendChild(script);
      } else {
        initMap();
      }
    };

    let mapInstance;

    const initMap = () => {
      if (!window.L || document.getElementById('provider-map')?.dataset.ready === 'true') return;
      const mapElement = document.getElementById('provider-map');
      if (!mapElement) return;
      mapElement.dataset.ready = 'true';
      mapInstance = window.L.map('provider-map').setView([6.8013, -58.155], 11);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(mapInstance);

      providers
        .filter((p) => p.lat && p.long)
        .forEach((provider) => {
          const marker = window.L.marker([provider.lat, provider.long]).addTo(mapInstance);
          marker.bindPopup(
            `<div style="font-weight:700">${provider.name}</div>` +
              `<div style="color:#6b7280">${provider.location}</div>` +
              `<div style="font-size:12px">Services: ${provider.services?.join(', ') || 'N/A'}</div>` +
              `<div style="font-size:12px; color:${provider.isLocked ? '#b91c1c' : '#16a34a'}">${provider.isLocked ? 'Suspended' : 'Active'}</div>`
          );
        });
    };

    ensureLeaflet();

    return () => {
      if (mapInstance) {
        mapInstance.remove();
      }
      const mapElement = document.getElementById('provider-map');
      if (mapElement) {
        mapElement.dataset.ready = 'false';
        mapElement.innerHTML = '';
      }
    };
  }, [providers]);
}

function AdminDashboard() {
  const [serviceCharge, setServiceCharge] = useState(10);
  const [providers, setProviders] = useState(sampleProviders);
  const [charges, setCharges] = useState(sampleCharges);
  const [selectedChargeIds, setSelectedChargeIds] = useState([]);
  const [creditInputs, setCreditInputs] = useState({});
  const [loadingProviders, setLoadingProviders] = useState(false);

  useLeafletMap(providers);

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        setLoadingProviders(true);
        const res = await axios.get(`${API}/providers`);
        if (Array.isArray(res.data) && res.data.length) {
          const normalized = res.data.map((p) => ({
            id: p.provider_id || p.id,
            name: p.name || 'Provider',
            location: p.location || 'Unknown area',
            lat: p.lat,
            long: p.long,
            outstanding: Math.floor(Math.random() * 40000) + 5000,
            credit: 0,
            isLocked: false,
            lastActive: '2024-10-10',
            totalBookings: Math.floor(Math.random() * 40) + 5,
            cancellations: Math.floor(Math.random() * 5),
            noShows: Math.floor(Math.random() * 2),
            services: p.services || [],
          }));
          setProviders(normalized);
        }
      } catch (e) {
        console.log('Using sample providers', e.message);
      } finally {
        setLoadingProviders(false);
      }
    };

    fetchProviders();
  }, []);

  const totalProviders = providers.length;
  const totalActiveProviders = providers.filter((p) => {
    const lastActiveDate = new Date(p.lastActive);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return lastActiveDate >= thirtyDaysAgo;
  }).length;

  const bookingStats = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const today = sampleBookings.filter((b) => new Date(b.startTime) >= startOfDay).length;
    const thisWeek = sampleBookings.filter((b) => new Date(b.startTime) >= startOfWeek).length;
    const thisMonth = sampleBookings.filter((b) => new Date(b.startTime) >= startOfMonth).length;

    const total = sampleBookings.length;
    const completed = sampleBookings.filter((b) => b.status === 'completed').length;
    const cancelled = sampleBookings.filter((b) => b.status === 'cancelled').length;
    const noShows = sampleBookings.filter((b) => b.status === 'no-show').length;

    return {
      today,
      thisWeek,
      thisMonth,
      completionRate: total ? Math.round((completed / total) * 100) : 0,
      cancellationRate: total ? Math.round((cancelled / total) * 100) : 0,
      noShowRate: total ? Math.round((noShows / total) * 100) : 0,
    };
  }, []);

  const bookingCountsByProvider = useMemo(() => {
    const counts = {};
    sampleBookings.forEach((b) => {
      counts[b.providerId] = (counts[b.providerId] || 0) + 1;
    });
    return counts;
  }, []);

  const providerById = useMemo(() => {
    const map = {};
    providers.forEach((p) => {
      map[p.id] = p;
    });
    return map;
  }, [providers]);

  const topProviders = Object.entries(bookingCountsByProvider)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([providerId, count]) => ({
      name: providerById[providerId]?.name || `Provider ${providerId}`,
      bookings: count,
    }));

  const applyCredit = (providerId) => {
    const creditValue = Number(creditInputs[providerId] || 0);
    if (!creditValue) return;
    setProviders((prev) =>
      prev.map((p) =>
        p.id === providerId ? { ...p, credit: p.credit + creditValue, outstanding: Math.max(0, p.outstanding - creditValue) } : p,
      ),
    );
    setCreditInputs((prev) => ({ ...prev, [providerId]: '' }));
  };

  const toggleLock = (providerId) => {
    setProviders((prev) => prev.map((p) => (p.id === providerId ? { ...p, isLocked: !p.isLocked } : p)));
  };

  const toggleChargeSelection = (chargeId) => {
    setSelectedChargeIds((prev) => (prev.includes(chargeId) ? prev.filter((id) => id !== chargeId) : [...prev, chargeId]));
  };

  const setChargesPaidState = (paidState) => {
    setCharges((prev) => prev.map((c) => (selectedChargeIds.includes(c.id) ? { ...c, isPaid: paidState } : c)));
    setSelectedChargeIds([]);
  };

  const resolvedCharges = charges.map((charge) => ({
    ...charge,
    providerName: providerById[charge.providerId]?.name || 'Provider',
  }));

  const dau = 48;
  const mau = 620;
  const revenueTotal = charges.reduce((acc, c) => acc + c.amount, 0);
  const averageBookingsPerProvider = providers.length ? (sampleBookings.length / providers.length).toFixed(1) : 0;

  return (
    <div style={{ background: '#f9fafb', minHeight: '100vh', padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#111827' }}>Admin Dashboard</h1>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <Link to="/" style={{ color: '#16a34a', fontWeight: 600 }}>Home</Link>
          <Link to="/login" style={{ color: '#16a34a', fontWeight: 600 }}>Login</Link>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard label="Total Providers" value={totalProviders} helper="Across all regions" />
        <StatCard label="Active Providers (30d)" value={totalActiveProviders} helper="Visited in last 30 days" />
        <StatCard label="Total Clients" value={420} helper="Includes mobile + web" />
        <StatCard label="DAU / MAU" value={`${dau} / ${mau}`} helper={`${Math.round((dau / mau) * 100)}% engagement`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '16px' }}>
        <ReportSection title="Service Charge & Billing Controls">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'center' }}>
            <div>
              <div style={{ color: '#6b7280', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Service Charge</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={serviceCharge}
                  onChange={(e) => setServiceCharge(Number(e.target.value))}
                  style={{ padding: '10px', borderRadius: '8px', border: '1px solid #d1d5db', width: '120px' }}
                />
                <span style={{ color: '#9ca3af' }}>% of service cost (default 10%)</span>
              </div>
            </div>
            <div>
              <button
                style={{ padding: '10px 14px', background: '#16a34a', color: 'white', borderRadius: '10px', border: 'none', fontWeight: 700 }}
                onClick={() => alert(`Service charge updated to ${serviceCharge}%`)}
              >
                Save Changes
              </button>
            </div>
          </div>
        </ReportSection>

        <ReportSection title="Booking Health">
          <div style={{ display: 'grid', gap: '8px' }}>
            <StatCard label="Bookings Today" value={bookingStats.today} />
            <StatCard label="Bookings This Week" value={bookingStats.thisWeek} />
            <StatCard label="Bookings This Month" value={bookingStats.thisMonth} />
          </div>
        </ReportSection>
      </div>

      <ReportSection title="Billing Actions">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '720px' }}>
            <thead>
              <tr style={{ textAlign: 'left', background: '#f3f4f6' }}>
                <th style={{ padding: '10px' }}>Select</th>
                <th style={{ padding: '10px' }}>Provider</th>
                <th style={{ padding: '10px' }}>Month</th>
                <th style={{ padding: '10px' }}>Amount (GYD)</th>
                <th style={{ padding: '10px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {resolvedCharges.map((charge) => (
                <tr key={charge.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '10px' }}>
                    <input
                      type="checkbox"
                      checked={selectedChargeIds.includes(charge.id)}
                      onChange={() => toggleChargeSelection(charge.id)}
                    />
                  </td>
                  <td style={{ padding: '10px' }}>{charge.providerName}</td>
                  <td style={{ padding: '10px' }}>{charge.month}</td>
                  <td style={{ padding: '10px' }}>{charge.amount.toLocaleString()}</td>
                  <td style={{ padding: '10px' }}>
                    <span style={{
                      padding: '4px 8px',
                      borderRadius: '999px',
                      background: charge.isPaid ? '#dcfce7' : '#fef9c3',
                      color: charge.isPaid ? '#15803d' : '#92400e',
                      fontWeight: 700,
                      fontSize: '12px',
                    }}>
                      {charge.isPaid ? 'Paid' : 'Unpaid'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
          <button
            onClick={() => setChargesPaidState(true)}
            style={{ padding: '10px 14px', background: '#16a34a', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 700 }}
          >
            Mark Paid
          </button>
          <button
            onClick={() => setChargesPaidState(false)}
            style={{ padding: '10px 14px', background: '#f3f4f6', color: '#111827', border: '1px solid #e5e7eb', borderRadius: '10px', fontWeight: 700 }}
          >
            Mark Unpaid
          </button>
        </div>
      </ReportSection>

      <ReportSection title="Provider Accounts">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '920px' }}>
            <thead>
              <tr style={{ background: '#f3f4f6', textAlign: 'left' }}>
                <th style={{ padding: '10px' }}>Provider</th>
                <th style={{ padding: '10px' }}>Outstanding</th>
                <th style={{ padding: '10px' }}>Credit</th>
                <th style={{ padding: '10px' }}>Apply Credit</th>
                <th style={{ padding: '10px' }}>Status</th>
                <th style={{ padding: '10px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '10px' }}>
                    <div style={{ fontWeight: 700 }}>{provider.name}</div>
                    <div style={{ color: '#6b7280' }}>{provider.location}</div>
                  </td>
                  <td style={{ padding: '10px' }}>GYD {provider.outstanding.toLocaleString()}</td>
                  <td style={{ padding: '10px' }}>GYD {provider.credit.toLocaleString()}</td>
                  <td style={{ padding: '10px' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="number"
                        placeholder="Amount"
                        value={creditInputs[provider.id] || ''}
                        onChange={(e) => setCreditInputs((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                        style={{ padding: '8px', borderRadius: '8px', border: '1px solid #d1d5db', width: '120px' }}
                      />
                      <button
                        onClick={() => applyCredit(provider.id)}
                        style={{ background: '#16a34a', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 10px', fontWeight: 700 }}
                      >
                        Apply
                      </button>
                    </div>
                  </td>
                  <td style={{ padding: '10px' }}>
                    {provider.isLocked ? (
                      <span style={{ color: '#b91c1c', fontWeight: 700 }}>Suspended</span>
                    ) : (
                      <span style={{ color: '#15803d', fontWeight: 700 }}>Active</span>
                    )}
                  </td>
                  <td style={{ padding: '10px' }}>
                    <button
                      onClick={() => toggleLock(provider.id)}
                      style={{
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: 'none',
                        color: provider.isLocked ? '#16a34a' : 'white',
                        background: provider.isLocked ? '#ecfdf3' : '#b91c1c',
                        fontWeight: 700,
                      }}
                    >
                      {provider.isLocked ? 'Unlock' : 'Lock'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ReportSection>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '16px' }}>
        <ReportSection title="Signups Over Time">
          <div style={{ display: 'grid', gap: '8px' }}>
            {signupHistory.map((item) => (
              <div key={item.month} style={{ border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px', background: '#f9fafb' }}>
                <div style={{ fontWeight: 700 }}>{item.month}</div>
                <ProgressRow label="Providers" value={item.providers} total={50} accent="#16a34a" />
                <ProgressRow label="Clients" value={item.clients} total={120} accent="#0ea5e9" />
              </div>
            ))}
          </div>
        </ReportSection>

        <ReportSection title="Bookings & Revenue">
          <div style={{ display: 'grid', gap: '8px' }}>
            <StatCard label="Completion Rate" value={`${bookingStats.completionRate}%`} />
            <StatCard label="Cancellation Rate" value={`${bookingStats.cancellationRate}%`} />
            <StatCard label="No-show Rate" value={`${bookingStats.noShowRate}%`} />
            <StatCard label="Revenue to Date" value={`GYD ${revenueTotal.toLocaleString()}`} />
          </div>
        </ReportSection>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '16px', marginBottom: '16px' }}>
        <ReportSection title="Provider Performance">
          <div style={{ display: 'grid', gap: '8px' }}>
            {topProviders.map((p) => (
              <div key={p.name} style={{ border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px', background: '#f9fafb' }}>
                <div style={{ fontWeight: 700 }}>{p.name}</div>
                <ProgressRow label="Bookings" value={p.bookings} total={50} accent="#16a34a" />
              </div>
            ))}
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px', background: '#f9fafb' }}>
              <div style={{ fontWeight: 700 }}>Low Activity Providers</div>
              <div style={{ fontSize: '14px', color: '#6b7280' }}>Providers with 0–3 bookings this month: 2</div>
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px', background: '#f9fafb' }}>
              <div style={{ fontWeight: 700 }}>Onboarding Gaps</div>
              <div style={{ fontSize: '14px', color: '#6b7280' }}>Providers missing onboarding steps: 1</div>
            </div>
          </div>
        </ReportSection>

        <ReportSection title="Operations Snapshot">
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '10px' }}>
            <li><strong>Peak hours:</strong> 9am - 1pm</li>
            <li><strong>Popular day:</strong> Saturday spike</li>
            <li><strong>Most booked services:</strong> Hair Styling, Nails, Massage</li>
            <li><strong>Auto-cancellations:</strong> 2 this month</li>
            <li><strong>Providers with high cancellation:</strong> Jamall Adams, Kittisha Jones</li>
            <li><strong>Average bookings/provider:</strong> {averageBookingsPerProvider}</li>
          </ul>
        </ReportSection>
      </div>

      <ReportSection title="Marketplace Balance">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <h4 style={{ marginTop: 0 }}>Demand vs Supply</h4>
            <ul style={{ paddingLeft: '16px', color: '#111827' }}>
              <li>Nail techs are fully booked for 20 days — add more supply.</li>
              <li>High massage demand in Georgetown with limited providers.</li>
              <li>East Bank showing search results with no barbers on weekdays.</li>
            </ul>
          </div>
          <div>
            <h4 style={{ marginTop: 0 }}>Financial Health</h4>
            <ul style={{ paddingLeft: '16px', color: '#111827' }}>
              <li>Revenue per provider trending at GYD 12,500 monthly average.</li>
              <li>Credit balances outstanding: GYD {(providers.reduce((acc, p) => acc + p.credit, 0)).toLocaleString()}.</li>
              <li>Failed subscription payments: 1 in the last 30 days.</li>
              <li>Referral payouts pending: GYD 8,000.</li>
            </ul>
          </div>
        </div>
      </ReportSection>

      <ReportSection title="Provider Map">
        <div style={{ height: '420px', borderRadius: '12px', overflow: 'hidden', border: '1px solid #e5e7eb', background: '#f3f4f6' }}>
          <div id="provider-map" style={{ height: '100%', width: '100%' }}></div>
        </div>
        {loadingProviders && <div style={{ marginTop: '8px', color: '#6b7280' }}>Loading provider pins…</div>}
      </ReportSection>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/admin/signup" element={<AdminSignup />} />
        <Route path="/admin" element={<AdminDashboard />} />
      </Routes>
    </BrowserRouter>
  );
}
