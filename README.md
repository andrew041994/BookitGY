# guyana-booker
Guyana booker app
# Guyana Booker – Booksy Clone for Guyana

## Features
- Customer & Provider booking
- WhatsApp notifications & billing (Twilio)
- 10% fee + auto-lock unpaid accounts
- Fully editable promotions (e.g. first 20 free)
- Google Maps directions (lat/long)
- Web + Native Mobile (Expo)

## Quick Start
```bash
docker-compose up -d
# Web: http://localhost:5173
# API docs: http://localhost:8000/docs
```

## Backend tests
Run the backend test suite from the `backend/` directory with:

```bash
cd backend
pytest -q
```

## Mobile crash reporting
- The mobile app initializes Sentry via `sentry-expo`; set `SENTRY_DSN` (or `EXPO_PUBLIC_SENTRY_DSN`) in your build environment so release builds can report JavaScript errors.
- EAS builds automatically upload source maps through the `sentry-expo` plugin configured in `app.config.js`, so TestFlight crashes include readable stack traces.
