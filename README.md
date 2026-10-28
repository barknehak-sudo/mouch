# Mouch!

A private, mobile-first migraine diary. *Mouch it out!*

- **Every evening:** rate the day 1–10 with one tap.
- **Bad and great days:** a guided check-in covering sleep, stress, meals (with dishes from Ethiopian, American, Mexican, Italian, Asian and Middle Eastern menus), caffeine, water, exercise, screens, alcohol, early signs and what's going on.
- **When pain starts:** tap **Ouch!**. A dim attack log opens with a timer, a head map, symptoms, painkillers and a red-flag check.
- **Painkiller log:** Gofen (ibuprofen 400 mg) and Volt Fast (diclofenac potassium 50 mg). It counts painkiller days against the medication-overuse line, warns when you've already taken an NSAID today, and compares which one works better for you, using your own "did it help?" answers.
- **Forecast:** a migraine risk score built from your latest check-in and the pressure change, weighted by your own pain-day vs great-day history. It comes with eat, drink and avoid suggestions.
- **Monthly loop:** export the month as JSON for Claude, then paste back a plan with findings, experiments, food rules and nudges.

Mouch! is a diary, not medical advice, and never suggests a dose.

## Stack

One static `index.html` (vanilla JS, no build step), a web manifest and a service worker for offline use. Data lives in the browser's `localStorage`. Deployed on Vercel as a static site.

## Run locally

Open `index.html` in a browser, or serve the folder:

```sh
npx serve .
```

## Not built yet

- Push notifications (late work, screen breaks, the 9 PM reminder) only show inside the app for now. Real push needs a small backend.
- Mac/PC screen time needs a desktop helper app.
- Weather pressure uses sample values. Wire up a live forecast (for example Open-Meteo) for Addis Ababa.
