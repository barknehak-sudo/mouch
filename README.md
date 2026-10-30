# Mouch!

A private, mobile-first migraine diary. *Mouch it out!*

- **Passcode:** set on first open; asked every launch and after 5 minutes away (salted PBKDF2 hash, never stored as typed).
- **Through the day:** morning (05:00), midday (12:00) and evening (18:00) logs unlock with the clock, one question per screen. Today and the 3 days before stay editable; older days are read-only.
- **Every evening:** rate the day 1–10. A tap shows what the number means; Save commits it.
- **The logs cover** sleep, stress, meals (with dishes from Ethiopian, American, Mexican, Italian, Asian and Middle Eastern menus), caffeine, water, exercise, screens, alcohol, early signs and what's going on.
- **When pain starts:** tap **Ouch!**. A dim attack log opens with a timer, a head map, symptoms, painkillers and a red-flag check.
- **Painkiller log:** Gofen (ibuprofen 400 mg) and Volt Fast (diclofenac potassium 50 mg). It counts painkiller days against the medication-overuse line, warns when you've already taken an NSAID today, and compares which one works better for you, using your own "did it help?" answers.
- **Forecast:** a migraine risk score built from your latest check-in and the pressure change, weighted by your own pain-day vs great-day history. It comes with eat, drink and avoid suggestions.
- **Monthly loop:** export the month as JSON for Claude, then paste back a plan with findings, experiments, food rules and nudges.

Mouch! is a diary, not medical advice, and never suggests a dose.

## Stack

One static `index.html` (vanilla JS, no build step), a web manifest and a service worker. Diary data lives in the browser's `localStorage`.

Small Vercel functions in `api/` (state in a private Vercel Blob store, `mouch-store`):

- `push-config`, `subscribe`, `push-schedule` — Web Push. The cron runs every 15 minutes and sends the morning, midday, water, evening and rating reminders in the phone's own time zone, plus "did it help?", "is it over?" and tomorrow's weather warning. The server only knows times and done/not-done flags, never diary entries.
- `health-pair`, `health` — Apple Health inbox. An iPhone Shortcut posts sleep, steps, exercise, heart rate and cycle with a pairing token; Mouch! pulls and the server deletes. Setup steps are in Settings → Apple Health.

Weather, air quality and UV come from Open-Meteo (no key). Phone Screen Time can't be read by any app on iPhone, so it's asked in the evening log.

Env vars on Vercel: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`.

## Run locally

```sh
npx vercel dev
```

`npm run typecheck` checks the functions.
