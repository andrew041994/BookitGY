import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { apiClient, logApiError } from './lib/api';

const DEFAULT_SERVICE_CHARGE = 10;
const SERVICE_CHARGE_STORAGE_KEY = 'bookitgy.service_charge_rate';

const sampleProviders = [
  {
    id: 1,
    userId: 1,
    name: 'Ariana De Freitas',
    accountNumber: 'ACC-0001',
    phoneNumber: '592-600-1001',
    location: 'Georgetown',
    lat: 6.8013,
    long: -58.155,
    outstanding: 32000,
    credit: 5000,
    isSuspended: false,
    autoSuspended: false,
    lastActive: '2024-10-10',
    totalBookings: 42,
    cancellations: 3,
    noShows: 1,
    services: ['Makeup', 'Hair Styling'],
  },
  {
    id: 2,
    userId: 2,
    name: 'Jamall Adams',
    accountNumber: 'ACC-0002',
    phoneNumber: '592-600-1002',
    location: 'East Bank',
    lat: 6.7484,
    long: -58.2439,
    outstanding: 18000,
    credit: 0,
    isSuspended: false,
    autoSuspended: false,
    lastActive: '2024-09-28',
    totalBookings: 18,
    cancellations: 4,
    noShows: 0,
    services: ['Barber', 'Beard Trim'],
  },
  {
    id: 3,
    userId: 3,
    name: 'Kittisha Jones',
    accountNumber: 'ACC-0003',
    phoneNumber: '592-600-1003',
    location: 'Kitty',
    lat: 6.8236,
    long: -58.151,
    outstanding: 52000,
    credit: 15000,
    isSuspended: true,
    autoSuspended: false,
    lastActive: '2024-08-30',
    totalBookings: 7,
    cancellations: 2,
    noShows: 1,
    services: ['Massage'],
  },
  {
    id: 4,
    userId: 4,
    name: 'Linden Collective',
    accountNumber: 'ACC-0004',
    phoneNumber: '592-600-1004',
    location: 'Linden',
    lat: 5.9896,
    long: -58.2705,
    outstanding: 12000,
    credit: 0,
    isSuspended: false,
    autoSuspended: false,
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

const normalizeServiceCharge = (value) => Math.max(0, Math.min(100, Number(value) || 0));

const loadStoredServiceCharge = () => {
  const stored = localStorage.getItem(SERVICE_CHARGE_STORAGE_KEY);
  if (stored === null) return null;

  return normalizeServiceCharge(stored);
};

const persistServiceCharge = (rate) => {
  localStorage.setItem(SERVICE_CHARGE_STORAGE_KEY, String(rate));
};

const getSuspensionCutoffDate = () => {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 15));
};

const isPastSuspensionCutoff = () => {
  const now = new Date();
  const cutoff = getSuspensionCutoffDate();

  return now.getTime() >= cutoff.getTime();
};

function useBillingCore() {
  const billingCycleStart = useMemo(() => {
    const today = new Date();
    return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);
  }, []);

  const [providers, setProviders] = useState(sampleProviders);
  const [charges, setCharges] = useState(() =>
    sampleCharges.map((charge) => {
      const baseServiceCost = Math.round((charge.amount / DEFAULT_SERVICE_CHARGE) * 100);

      return {
        ...charge,
        baseServiceCost,
        isPaid: charge.month === billingCycleStart ? false : charge.isPaid ?? false,
      };
    }),
  );
  const [selectedChargeIds, setSelectedChargeIds] = useState([]);
  const [creditInputs, setCreditInputs] = useState({});
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [suspensionClock, setSuspensionClock] = useState(() => Date.now());
  const suspensionCutoffLabel = useMemo(() => getSuspensionCutoffDate().toISOString().slice(0, 10), []);

  useEffect(() => {
    const interval = setInterval(() => setSuspensionClock(Date.now()), 1000 * 60 * 30);
    return () => clearInterval(interval);
  }, []);

  const fetchProviders = useCallback(async () => {
    try {
      setLoadingProviders(true);
      const res = await apiClient.get('/providers');
      if (Array.isArray(res.data) && res.data.length) {
        const normalized = res.data.map((p) => ({
          id: p.provider_id || p.id,
          userId: p.user_id || p.userId,
          name: p.name || 'Provider',
          accountNumber: p.account_number || p.accountNumber || '—',
          phoneNumber: p.phone || p.phone_number || '—',
          location: p.location || 'Unknown area',
          lat: p.lat,
          long: p.long,
          outstanding: Math.floor(Math.random() * 40000) + 5000,
          credit: 0,
          isSuspended: p.is_suspended ?? p.isSuspended ?? false,
          autoSuspended: false,
          lastActive: '2024-10-10',
          totalBookings: Math.floor(Math.random() * 40) + 5,
          cancellations: Math.floor(Math.random() * 5),
          noShows: Math.floor(Math.random() * 2),
          services: p.services || [],
        }));
        setProviders(normalized);
      }
    } catch (e) {
      logApiError(e);
      console.log('Using sample providers', e.message);
    } finally {
      setLoadingProviders(false);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  useEffect(() => {
    const fetchBilling = async () => {
      try {
        const res = await apiClient.get('/admin/billing');
        if (!Array.isArray(res.data) || res.data.length === 0) return;

        setCharges(
          res.data.map((row) => {
            const amount = Number(row.amount_due_gyd ?? 0);
            return {
              id: row.provider_id ?? row.id,
              providerId: row.provider_id ?? row.id,
              userId: row.user_id ?? row.userId,
              providerName: row.name || 'Provider',
              accountNumber: row.account_number || row.accountNumber || '—',
              phoneNumber: row.phone || row.phone_number || '—',
              month: billingCycleStart,
              amount: Math.round(amount),
              baseServiceCost: 0,
              isPaid: !!row.is_paid,
              isSuspended: row.is_suspended ?? row.isSuspended ?? false,
            };
          }),
        );
      } catch (e) {
        logApiError(e);
        console.log('Using sample billing data', e.message);
      }
    };

    fetchBilling();
  }, [billingCycleStart]);

  useEffect(() => {
    setCharges((prev) => {
      if (!providers.length) return prev;

      let nextId = prev.reduce((max, c) => Math.max(max, c.id), 0) + 1;
      let updated = [...prev];

      providers.forEach((provider) => {
        const existing = updated.find((c) => c.providerId === provider.id);
        if (!existing) {
          const amount = provider.outstanding || Math.floor(Math.random() * 20000) + 5000;
          updated.push({
            id: nextId++,
            providerId: provider.id,
            month: billingCycleStart,
            amount,
            baseServiceCost: Math.round((amount / DEFAULT_SERVICE_CHARGE) * 100),
            isPaid: false,
          });
        }
      });

      return updated;
    });
  }, [providers, billingCycleStart]);

  useEffect(() => {
    const inSuspensionWindow = isPastSuspensionCutoff();

    setProviders((prev) =>
      prev.map((provider) => {
        const hasUnpaidCurrentCharge = charges.some(
          (charge) => charge.providerId === provider.id && charge.month === billingCycleStart && !charge.isPaid,
        );
        const autoSuspended = inSuspensionWindow && hasUnpaidCurrentCharge;

        if (provider.autoSuspended === autoSuspended) return provider;

        return { ...provider, autoSuspended };
      }),
    );
  }, [billingCycleStart, charges, suspensionClock]);

  const providerById = useMemo(() => {
    const map = {};
    providers.forEach((p) => {
      map[p.id] = p;
    });
    return map;
  }, [providers]);

  const resolvedCharges = useMemo(
    () =>
      charges.map((charge) => ({
        ...charge,
        providerName: providerById[charge.providerId]?.name || charge.providerName || 'Provider',
        accountNumber: providerById[charge.providerId]?.accountNumber || charge.accountNumber || '—',
        phoneNumber: providerById[charge.providerId]?.phoneNumber || charge.phoneNumber || '—',
        userId: providerById[charge.providerId]?.userId || charge.userId,
        isSuspended: providerById[charge.providerId]?.isSuspended ?? charge.isSuspended ?? false,
        autoSuspended: providerById[charge.providerId]?.autoSuspended || false,
        isCurrentCycle: charge.month === billingCycleStart,
      })),
    [charges, providerById, billingCycleStart],
  );

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

  const setProviderSuspensionState = useCallback(
    async (userId, suspended) => {
      if (!userId) return;
      try {
        if (suspended) {
          await apiClient.post(`/admin/users/${userId}/suspend`);
        } else {
          await apiClient.post(`/admin/users/${userId}/unsuspend`);
        }
        await fetchProviders();
      } catch (e) {
        logApiError(e);
      }
    },
    [fetchProviders],
  );

  const toggleChargeSelection = (chargeId) => {
    setSelectedChargeIds((prev) => (prev.includes(chargeId) ? prev.filter((id) => id !== chargeId) : [...prev, chargeId]));
  };

  const toggleAllChargesSelection = (chargeIds = charges.map((c) => c.id)) => {
    const allSelected = chargeIds.length && chargeIds.every((id) => selectedChargeIds.includes(id));

    if (allSelected) {
      setSelectedChargeIds((prev) => prev.filter((id) => !chargeIds.includes(id)));
    } else {
      setSelectedChargeIds((prev) => Array.from(new Set([...prev, ...chargeIds])));
    }
  };

  const setChargesPaidState = (paidState) => {
    setCharges((prev) => prev.map((c) => (selectedChargeIds.includes(c.id) ? { ...c, isPaid: paidState } : c)));
    setSelectedChargeIds([]);
  };

  const updateSingleChargeStatus = (chargeId, paidState) => {
    setCharges((prev) => prev.map((c) => (c.id === chargeId ? { ...c, isPaid: paidState } : c)));
    setSelectedChargeIds((prev) => prev.filter((id) => id !== chargeId));
  };

  return {
    applyCredit,
    billingCycleStart,
    charges,
    creditInputs,
    loadingProviders,
    providers,
    resolvedCharges,
    selectedChargeIds,
    setCharges,
    setCreditInputs,
    setChargesPaidState,
    setProviderSuspensionState,
    suspensionCutoffLabel,
    toggleAllChargesSelection,
    toggleChargeSelection,
    updateSingleChargeStatus,
  };
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('admin@guyana.com');
  const [password, setPassword] = useState('pass');
  const navigate = useNavigate();

  const login = async () => {
    try {
      const res = await apiClient.post('/auth/login', new URLSearchParams({
        username: email,
        password: password,
      }));
      const token = res.data.access_token;
      localStorage.setItem('token', token);
      apiClient.defaults.headers.common.Authorization = `Bearer ${token}`;
      onLogin?.(token);
      navigate('/admin');
    } catch {
      alert('Wrong credentials');
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(circle at 20% 20%, rgba(20, 184, 166, 0.15), transparent 32%), radial-gradient(circle at 80% 0%, rgba(22, 163, 74, 0.2), transparent 38%), linear-gradient(135deg, #0b1021, #0f172a)',
        padding: '24px',
        color: '#e5e7eb',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '24px',
          boxShadow: '0 30px 80px rgba(0,0,0,0.35)',
          backdropFilter: 'blur(8px)',
          padding: '32px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: '-120px',
            background: 'radial-gradient(circle, rgba(22,163,74,0.08), transparent 55%)',
            zIndex: 0,
          }}
        />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '18px' }}>
            <div
              style={{
                height: '96px',
                width: '96px',
                borderRadius: '50%',
                background: 'linear-gradient(145deg, rgba(22,163,74,0.2), rgba(20,184,166,0.18))',
                display: 'grid',
                placeItems: 'center',
                boxShadow: '0 12px 32px rgba(16,185,129,0.25)',
              }}
            >
              <img src="/bookitgy-logo.png" alt="BookitGY" style={{ height: '60px', width: '60px', objectFit: 'contain' }} />
            </div>
          </div>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <p style={{ color: '#9ca3af', letterSpacing: '0.08em', fontSize: '12px', textTransform: 'uppercase' }}>
              Welcome back
            </p>
            <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#f9fafb', margin: '6px 0 8px' }}>Sign in to BookitGY</h1>
            <p style={{ color: '#d1d5db', fontSize: '15px' }}>
              Manage bookings, providers, and insights from one beautiful dashboard.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '18px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', color: '#d1d5db', fontSize: '14px' }}>
              Email
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@email.com"
                style={{
                  padding: '14px 16px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.06)',
                  color: '#f3f4f6',
                  outline: 'none',
                  fontSize: '15px',
                }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', color: '#d1d5db', fontSize: '14px' }}>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{
                  padding: '14px 16px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.06)',
                  color: '#f3f4f6',
                  outline: 'none',
                  fontSize: '15px',
                }}
              />
            </label>
          </div>
          <button
            onClick={login}
            style={{
              width: '100%',
              padding: '14px 18px',
              background: 'linear-gradient(135deg, #16a34a, #10b981)',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              fontWeight: 700,
              fontSize: '16px',
              letterSpacing: '0.02em',
              boxShadow: '0 18px 40px rgba(16,185,129,0.3)',
              cursor: 'pointer',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
            }}
            onMouseDown={(e) => (e.currentTarget.style.transform = 'translateY(1px)')}
            onMouseUp={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
          >
            Continue
          </button>
          <div style={{ textAlign: 'center', marginTop: '14px', color: '#9ca3af', fontSize: '13px' }}>
            Use <strong style={{ color: '#f9fafb' }}>customer@guyana.com</strong> with password{' '}
            <strong style={{ color: '#f9fafb' }}>pass</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

function Home() {
  return (
    <div style={{ textAlign: 'center', marginTop: '100px' }}>
      <h1 style={{ color: '#16a34a' }}>Welcome to BookitGY Web!</h1>
      <p>Your Booksy clone is LIVE on web + mobile</p>
      <div style={{ marginTop: '20px' }}>
        <Link to="/admin" style={{ color: '#16a34a', fontWeight: 'bold' }}>
          Go to Admin Dashboard
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

function ReportSection({ title, children,fullWidth = false }) {
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
            const suspended = provider.isSuspended || provider.autoSuspended;
            const statusLabel = provider.autoSuspended ? 'Suspended (Unpaid)' : suspended ? 'Suspended' : 'Active';
            const marker = window.L.marker([provider.lat, provider.long]).addTo(mapInstance);
            marker.bindPopup(
              `<div style="font-weight:700">${provider.name}</div>` +
                `<div style="color:#6b7280">${provider.location}</div>` +
                `<div style="font-size:12px">Services: ${provider.services?.join(', ') || 'N/A'}</div>` +
                `<div style="font-size:12px; color:${suspended ? '#b91c1c' : '#16a34a'}">${statusLabel}</div>`
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

function BillingActionsPanel({
  resolvedCharges,
  selectedChargeIds,
  toggleAllChargesSelection,
  toggleChargeSelection,
  setChargesPaidState,
  updateSingleChargeStatus,
  billingCycleStart,
  suspensionCutoffLabel,
  setProviderSuspensionState,
}) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredCharges = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return resolvedCharges;

    return resolvedCharges.filter((charge) => {
      const account = (charge.accountNumber || '').toLowerCase();
      const phone = (charge.phoneNumber || '').toLowerCase();
      return account.includes(term) || phone.includes(term);
    });
  }, [resolvedCharges, searchTerm]);

  const filteredChargeIds = filteredCharges.map((c) => c.id);
  const allVisibleSelected =
    filteredCharges.length > 0 && filteredCharges.every((charge) => selectedChargeIds.includes(charge.id));

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search by account # or phone"
          style={{ padding: '10px', borderRadius: '10px', border: '1px solid #d1d5db', minWidth: '260px' }}
        />
      </div>
      <div style={{  width: '100%' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', }}>
          <thead>
            <tr style={{ textAlign: 'left', background: '#f3f4f6' }}>
              <th style={{ padding: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={() => toggleAllChargesSelection(filteredChargeIds)}
                  />
                  <span>Select</span>
                </div>
              </th>
              <th style={{ padding: '10px' }}>Name</th>
              <th style={{ padding: '10px' }}>Account Number</th>
              <th style={{ padding: '10px' }}>Phone Number</th>
              <th style={{ padding: '10px' }}>Amount Due (Platform Fees)</th>
              <th style={{ padding: '10px' }}>Status</th>
              <th style={{ padding: '10px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredCharges.map((charge) => {
              const statusLabel = charge.isPaid ? 'Paid' : charge.isCurrentCycle ? 'Unpaid (current)' : 'Unpaid';
              const badgeBackground = charge.isPaid ? '#dcfce7' : charge.isCurrentCycle ? '#fee2e2' : '#fef9c3';
              const badgeColor = charge.isPaid ? '#15803d' : charge.isCurrentCycle ? '#b91c1c' : '#92400e';
              const suspended = charge.isSuspended || charge.autoSuspended;
              const accountStatusLabel = charge.autoSuspended
                ? 'Suspended (Unpaid)'
                : charge.isSuspended
                  ? 'Suspended by Admin'
                  : 'Active';
              const suspendDisabled = charge.autoSuspended && !charge.isSuspended;

              return (
                <tr key={charge.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '10px' }}>
                    <input
                      type="checkbox"
                      checked={selectedChargeIds.includes(charge.id)}
                      onChange={() => toggleChargeSelection(charge.id)}
                    />
                  </td>
                  <td style={{ padding: '10px' }}>{charge.providerName}</td>
                  <td style={{ padding: '10px' }}>{charge.accountNumber}</td>
                  <td style={{ padding: '10px' }}>{charge.phoneNumber}</td>
                  <td style={{ padding: '10px' }}>GYD {charge.amount.toLocaleString()}</td>
                  <td style={{ padding: '10px' }}>
                    <span
                      style={{
                        padding: '4px 8px',
                        borderRadius: '999px',
                        background: badgeBackground,
                        color: badgeColor,
                        fontWeight: 700,
                        fontSize: '12px',
                      }}
                    >
                      {statusLabel}
                    </span>
                    <div style={{ marginTop: '6px', fontSize: '12px', color: suspended ? '#b91c1c' : '#15803d', fontWeight: 700 }}>
                      {accountStatusLabel}
                    </div>
                    {charge.autoSuspended && (
                      <div style={{ fontSize: '12px', color: '#92400e', marginTop: '2px' }}>
                        Auto-suspended on the 15th when current charges are unpaid.
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '10px' }}>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => updateSingleChargeStatus(charge.id, true)}
                        style={{ padding: '8px 12px', background: '#16a34a', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 700 }}
                      >
                        Mark Paid
                      </button>
                      <button
                        onClick={() => updateSingleChargeStatus(charge.id, false)}
                        style={{ padding: '8px 12px', background: '#f3f4f6', color: '#111827', border: '1px solid #e5e7eb', borderRadius: '8px', fontWeight: 700 }}
                      >
                        Mark Unpaid
                      </button>
                      <button
                        onClick={() => setProviderSuspensionState(charge.userId, !charge.isSuspended)}
                        disabled={suspendDisabled}
                        style={{
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: '1px solid #e5e7eb',
                          background: charge.isSuspended ? '#ecfdf3' : '#fee2e2',
                          color: charge.isSuspended ? '#15803d' : '#b91c1c',
                          fontWeight: 700,
                          opacity: suspendDisabled ? 0.6 : 1,
                          cursor: suspendDisabled ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {charge.isSuspended ? 'Reactivate account' : 'Suspend account'}
                      </button>
                    </div>
                    <div style={{ color: '#6b7280', fontSize: '12px', marginTop: '6px', maxWidth: '320px' }}>
                      Suspended providers are hidden from searches and cannot accept appointments.
                      {suspendDisabled && ' Mark the current cycle as paid to restore automatically.'}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: '10px', marginTop: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
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
        <div style={{ color: '#6b7280', fontSize: '14px' }}>
          Charges default to <strong>Unpaid</strong> on the 1st of each month (current cycle: {billingCycleStart}). Accounts
          automatically suspend at midnight on the 15th ({suspensionCutoffLabel}) if the current cycle remains unpaid.
        </div>
      </div>
    </>
  );
}

function ProviderAccountsTable({ providers, creditInputs, setCreditInputs, applyCredit, setProviderSuspensionState }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '3000px' }}>
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
          {providers.map((provider) => {
            const suspended = provider.isSuspended || provider.autoSuspended;
            const statusLabel = provider.autoSuspended ? 'Suspended (Unpaid)' : provider.isSuspended ? 'Suspended' : 'Active';
            const toggleDisabled = provider.autoSuspended && !provider.isSuspended;

            return (
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
                      style={{
                        background: '#16a34a',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '8px 10px',
                        fontWeight: 700,
                      }}
                    >
                      Apply
                    </button>
                  </div>
                </td>
                <td style={{ padding: '10px' }}>
                  {suspended ? (
                    <div style={{ display: 'grid', gap: '4px' }}>
                      <span style={{ color: '#b91c1c', fontWeight: 700 }}>{statusLabel}</span>
                      {provider.autoSuspended && (
                        <span style={{ color: '#92400e', fontSize: '12px' }}>
                          Auto-suspended on the 15th due to unpaid charges.
                        </span>
                      )}
                    </div>
                  ) : (
                    <span style={{ color: '#15803d', fontWeight: 700 }}>Active</span>
                  )}
                </td>
                <td style={{ padding: '10px' }}>
                  <button
                    onClick={() => setProviderSuspensionState(provider.userId, !provider.isSuspended)}
                    disabled={toggleDisabled}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: 'none',
                      color: suspended ? '#16a34a' : 'white',
                      background: suspended ? '#ecfdf3' : '#b91c1c',
                      fontWeight: 700,
                      opacity: toggleDisabled ? 0.6 : 1,
                      cursor: toggleDisabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {provider.isSuspended ? 'Reactivate' : 'Suspend'}
                  </button>
                  {toggleDisabled && (
                    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                      Set the charge to paid to restore the account.
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AdminDashboard() {
  const {
    applyCredit,
    billingCycleStart,
    charges,
    creditInputs,
    loadingProviders,
    providers,
    resolvedCharges,
    selectedChargeIds,
    setCharges,
    setCreditInputs,
    setChargesPaidState,
    setProviderSuspensionState,
    suspensionCutoffLabel,
    toggleAllChargesSelection,
    toggleChargeSelection,
    updateSingleChargeStatus,
  } = useBillingCore();

  const [serviceCharge, setServiceCharge] = useState(DEFAULT_SERVICE_CHARGE);
  const [serviceChargeDraft, setServiceChargeDraft] = useState(DEFAULT_SERVICE_CHARGE);

  useLeafletMap(providers);

  const recalculateChargesForRate = (rate) => {
    const safeRate = normalizeServiceCharge(rate);
    setCharges((prev) => prev.map((c) => ({ ...c, amount: Math.round(c.baseServiceCost * (safeRate / 100)) })));
    setServiceCharge(safeRate);
    setServiceChargeDraft(safeRate);
  };

  useEffect(() => {
    const storedRate = loadStoredServiceCharge();
    if (storedRate !== null) {
      recalculateChargesForRate(storedRate);
    }
  }, []);

  const saveServiceCharge = () => {
    const safeRate = normalizeServiceCharge(serviceChargeDraft);
    persistServiceCharge(safeRate);
    recalculateChargesForRate(safeRate);
  };

  const resetServiceCharge = () => {
    recalculateChargesForRate(DEFAULT_SERVICE_CHARGE);
    localStorage.removeItem(SERVICE_CHARGE_STORAGE_KEY);
  };

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
                  value={serviceChargeDraft}
                  onChange={(e) => setServiceChargeDraft(Number(e.target.value))}
                  style={{ padding: '10px', borderRadius: '10px', border: '1px solid #d1d5db', maxWidth: '160px' }}
                />
                <span style={{ color: '#6b7280', fontSize: '14px' }}>
                  % of service cost (default {DEFAULT_SERVICE_CHARGE}%). Current billing cycle starts {billingCycleStart}. Saved rate: {serviceCharge}%.
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                style={{ padding: '10px 14px', background: '#16a34a', color: 'white', borderRadius: '10px', border: 'none', fontWeight: 700 }}
                onClick={saveServiceCharge}
              >
                Save Changes
              </button>
              <button
                style={{ padding: '10px 14px', background: '#f3f4f6', color: '#111827', borderRadius: '10px', border: '1px solid #e5e7eb', fontWeight: 700 }}
                onClick={resetServiceCharge}
              >
                Reset to {DEFAULT_SERVICE_CHARGE}%
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

      <ReportSection title="Billing Actions" fullWidth>
        <BillingActionsPanel
          billingCycleStart={billingCycleStart}
          resolvedCharges={resolvedCharges}
          selectedChargeIds={selectedChargeIds}
          setChargesPaidState={setChargesPaidState}
          suspensionCutoffLabel={suspensionCutoffLabel}
          toggleAllChargesSelection={toggleAllChargesSelection}
          toggleChargeSelection={toggleChargeSelection}
          updateSingleChargeStatus={updateSingleChargeStatus}
          setProviderSuspensionState={setProviderSuspensionState}
        />
      </ReportSection>

      <ReportSection title="Provider Accounts">
        <ProviderAccountsTable
          applyCredit={applyCredit}
          creditInputs={creditInputs}
          providers={providers}
          setCreditInputs={setCreditInputs}
          setProviderSuspensionState={setProviderSuspensionState}
        />
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



function BillingManagement() {
  const {
    applyCredit,
    billingCycleStart,
    creditInputs,
    providers,
    resolvedCharges,
    selectedChargeIds,
    setChargesPaidState,
    setProviderSuspensionState,
    suspensionCutoffLabel,
    toggleAllChargesSelection,
    toggleChargeSelection,
    updateSingleChargeStatus,
    setCreditInputs,
  } = useBillingCore();

  const unpaidCharges = resolvedCharges.filter((c) => !c.isPaid);
  const outstandingBalance = providers.reduce((acc, p) => acc + p.outstanding, 0);

  return (
    <div style={{ padding: '28px', background: '#f9fafb', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#111827' }}>Billing Center</h1>
          <p style={{ margin: '4px 0 0', color: '#6b7280' }}>
            Mark charges paid in bulk or individually. New cycles start unpaid on the 1st; unpaid accounts auto-suspend at
            midnight on the 15th.
          </p>
        </div>
        <Link to="/admin" style={{ color: '#16a34a', fontWeight: 700, textDecoration: 'none' }}>
          ← Back to dashboard
        </Link>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        <StatCard label="Billing cycle start" value={billingCycleStart} helper="Unpaid by default on this date" />
        <StatCard label="Auto-suspension" value={suspensionCutoffLabel} helper="Midnight cutoff on the 15th" />
        <StatCard label="Unpaid charges" value={`${unpaidCharges.length}`} helper={`${selectedChargeIds.length} selected`} />
        <StatCard
          label="Outstanding balance"
          value={`GYD ${outstandingBalance.toLocaleString()}`}
          helper="Across all providers"
        />
      </div>

      <ReportSection title="Charge Management">
        <BillingActionsPanel
          billingCycleStart={billingCycleStart}
          resolvedCharges={resolvedCharges}
          selectedChargeIds={selectedChargeIds}
          setChargesPaidState={setChargesPaidState}
          suspensionCutoffLabel={suspensionCutoffLabel}
          toggleAllChargesSelection={toggleAllChargesSelection}
          toggleChargeSelection={toggleChargeSelection}
          updateSingleChargeStatus={updateSingleChargeStatus}
          setProviderSuspensionState={setProviderSuspensionState}
        />
      </ReportSection>

      <ReportSection title="Provider Status & Credits">
        <ProviderAccountsTable
          applyCredit={applyCredit}
          creditInputs={creditInputs}
          providers={providers}
          setCreditInputs={setCreditInputs}
          setProviderSuspensionState={setProviderSuspensionState}
        />
      </ReportSection>
    </div>
  );
}


function AdminLayout() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', minHeight: '100vh', background: '#e5e7eb' }}>
      <aside
        style={{
          background: '#111827',
          color: '#f9fafb',
          padding: '24px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          boxShadow: '4px 0 16px rgba(0,0,0,0.15)',
        }}
      >
        <div style={{ fontWeight: 800, fontSize: '20px', letterSpacing: '0.02em' }}>Admin Panel</div>
        <nav style={{ display: 'grid', gap: '8px' }}>
          <NavLink
            to="/admin"
            end
            style={({ isActive }) => ({
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              padding: '12px',
              borderRadius: '10px',
              textDecoration: 'none',
              color: 'inherit',
              background: isActive ? '#0ea5e9' : 'rgba(255,255,255,0.04)',
              border: isActive ? '1px solid rgba(255,255,255,0.35)' : '1px solid rgba(255,255,255,0.08)',
              fontWeight: 700,
            })}
          >
            <span>Dashboard</span>
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>Overview</span>
          </NavLink>
          <NavLink
            to="/admin/service-charge"
            style={({ isActive }) => ({
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              padding: '12px',
              borderRadius: '10px',
              textDecoration: 'none',
              color: 'inherit',
              background: isActive ? '#16a34a' : 'rgba(255,255,255,0.04)',
              border: isActive ? '1px solid rgba(255,255,255,0.35)' : '1px solid rgba(255,255,255,0.08)',
              fontWeight: 700,
            })}
          >
            <span>Service Charge</span>
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>Adjust admin fee</span>
          </NavLink>
          <NavLink
            to="/admin/billing"
            style={({ isActive }) => ({
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              padding: '12px',
              borderRadius: '10px',
              textDecoration: 'none',
              color: 'inherit',
              background: isActive ? '#10b981' : 'rgba(255,255,255,0.04)',
              border: isActive ? '1px solid rgba(255,255,255,0.35)' : '1px solid rgba(255,255,255,0.08)',
              fontWeight: 700,
            })}
          >
            <span>Billing</span>
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>Mark provider fees paid</span>
          </NavLink>
        </nav>
        <div style={{ marginTop: 'auto', fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>
          Billing settings persist between sessions.
        </div>
      </aside>
      <main style={{ minHeight: '100vh', background: '#f9fafb' }}>
        <Outlet />
      </main>
    </div>
  );
}

function ServiceChargeSettings() {
  const [draft, setDraft] = useState(() => loadStoredServiceCharge() ?? DEFAULT_SERVICE_CHARGE);
  const [savedRate, setSavedRate] = useState(() => loadStoredServiceCharge() ?? DEFAULT_SERVICE_CHARGE);

  const save = () => {
    const normalized = normalizeServiceCharge(draft);
    persistServiceCharge(normalized);
    setSavedRate(normalized);
    setDraft(normalized);
    alert(`Service charge saved at ${normalized}%`);
  };

  const reset = () => {
    persistServiceCharge(DEFAULT_SERVICE_CHARGE);
    setSavedRate(DEFAULT_SERVICE_CHARGE);
    setDraft(DEFAULT_SERVICE_CHARGE);
  };

  return (
    <div style={{ padding: '32px', maxWidth: '720px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#111827' }}>Service Charge</h1>
          <p style={{ margin: '4px 0 0', color: '#6b7280' }}>
            Manage the percentage applied to each service cost. Defaults to {DEFAULT_SERVICE_CHARGE}%.
          </p>
        </div>
        <Link to="/admin" style={{ color: '#16a34a', fontWeight: 700, textDecoration: 'none' }}>
          ← Back to dashboard
        </Link>
      </div>

      <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '20px', boxShadow: '0 10px 30px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', color: '#111827', fontWeight: 700 }}>
            Service charge percentage
            <input
              type="number"
              min="0"
              max="100"
              value={draft}
              onChange={(e) => setDraft(Number(e.target.value))}
              style={{ padding: '12px', borderRadius: '10px', border: '1px solid #d1d5db', maxWidth: '160px' }}
            />
          </label>
          <div style={{ color: '#6b7280', fontSize: '14px' }}>
            Current saved rate: <strong>{savedRate}%</strong>. Values are clamped between 0% and 100%.
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '8px' }}>
            <button
              onClick={save}
              style={{ padding: '10px 14px', background: '#16a34a', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 700 }}
            >
              Save service charge
            </button>
            <button
              onClick={reset}
              style={{ padding: '10px 14px', background: '#f3f4f6', color: '#111827', border: '1px solid #e5e7eb', borderRadius: '10px', fontWeight: 700 }}
            >
              Reset to default ({DEFAULT_SERVICE_CHARGE}%)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));

  useEffect(() => {
    if (token) {
      apiClient.defaults.headers.common.Authorization = `Bearer ${token}`;
    } else {
      delete apiClient.defaults.headers.common.Authorization;
    }
  }, [token]);

  const ProtectedRoute = ({ children }) => {
    const location = useLocation();
    if (!token) {
      return <Navigate to="/login" replace state={{ from: location }} />;
    }
    return children;
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login onLogin={setToken} />} />
        <Route
          path="/admin"
          element={(
            <ProtectedRoute>
              <AdminLayout />
            </ProtectedRoute>
          )}
          >
          <Route index element={<AdminDashboard />} />
          <Route path="billing" element={<BillingManagement />} />
          <Route path="service-charge" element={<ServiceChargeSettings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
