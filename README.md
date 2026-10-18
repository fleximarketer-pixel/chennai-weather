# AI Weatherman

Live rain and weather monitoring for Chennai and all 38 districts of Tamil Nadu.

Live site: https://fleximarketer-pixel.github.io/chennai-weather/

## What it shows

**Your area** (default)
- Search any town, village or neighbourhood in Tamil Nadu, or use your phone's location
- A plain-language briefing: what's happening now, when rain is expected in the next 24 hours,
  the IMD warning for your district, what the nearest rain gauge measured, safety tips when it's
  serious, official alerts and local news
- The place is remembered on your device and can be shared as a link

**AI Weatherman briefings**
- A short briefing per district and one for the whole state, in English and Tamil, written by
  MiniMax from the official data and forecasts. Shown in Your area, Districts, Chennai areas and News.
- Rewritten when the warnings, measured rain or forecast change, and at least every 3 hours

**News**
- Rain and weather headlines from the last 48 hours in English and Tamil (Google News), tagged by district

**Districts**
- IMD district warnings (green / yellow / orange / red) for today and the next 4 days, on the map and in the table
- IMD 3-hour nowcast warnings
- Measured rain: IMD district average for the last 24h, the wettest gauge in each district, and month-to-date against normal
- About 340 IMD rain gauges on the map, with 24-hour and 7-day totals
- Model forecast for the next 24h and an hourly chart and 7-day outlook per place

**Chennai areas**
- 14 neighbourhoods with the nearest IMD gauge reading and model forecasts

**Lakes & dams**
- The six Chennai water supply lakes from Chennai Metro Water: storage, level, inflow, outflow, rain at the lake and the same day last year
- Same-day reservoir telemetry from TN WRD, including Mettur

**Alerts**
- Official IMD Chennai alerts published through NDMA Sachet
- Optional browser notifications for new official alerts, IMD orange and red warnings, and model heavy-rain forecasts

## How it works

The page is static. Two kinds of data feed it:

- **Model forecasts** come straight from [Open-Meteo](https://open-meteo.com/) in the browser, every 15 minutes.
- **Official data** (IMD, NDMA, Chennai Metro Water, TN WRD) cannot be fetched from a browser, so
  `scripts/update-data.mjs` collects it into `data/official.json`. A GitHub Action runs the script
  every 30 minutes and redeploys the site to GitHub Pages. If a source fails, its last published
  value is kept and the page footer marks it.

Models smooth out intense local storms. On 17 October 2026, for example, the model put Chennai at
about 75 mm while gauges recorded up to 300 mm, so the gauges and IMD warnings come first.

### AI briefings

After collecting the data, the script sends a compact set of facts per district (IMD warnings and
nowcast, measured rain, month against normal, forecast category, alerts, headlines) to MiniMax
(`MiniMax-M3`, or `MINIMAX_MODEL`) and stores the replies in `official.json` under `ai`. It needs
the `MINIMAX_API_KEY` repository secret:

```sh
gh secret set MINIMAX_API_KEY -R fleximarketer-pixel/chennai-weather
```

Without the key, or if MiniMax fails, the last briefings are kept and the footer marks them stale.

### Lake and dam data

Chennai Metro Water and TN WRD block requests from outside India, including GitHub's servers.
`scripts/push-lakes.sh` runs on a Mac in India at 8 am, 1 pm and 7 pm (launchd job
`scripts/com.tnrainwatch.lakes.plist`), fetches just those two sources and uploads them as
`data/lakes.json`. The upload redeploys the site, and the deploy uses that file when its own fetch
fails. The lake numbers on the live site only update while that Mac is on.

```sh
cp scripts/com.tnrainwatch.lakes.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.tnrainwatch.lakes.plist
tail ~/Library/Logs/tn-rain-watch-lakes.log   # check runs
```

## Run locally

```sh
npm run update   # fetch official data into data/official.json
npm start        # serve on http://localhost:8080
```

Browser notifications need `localhost` or HTTPS.

## Files

- `index.html`, `styles.css`, `app.js`: the page
- `locations.js`: district headquarters, Chennai neighbourhoods and IMD name spellings
- `scripts/update-data.mjs`: collects official data
- `scripts/build-boundaries.mjs`: one-off, builds `data/tn-districts.geojson` from IMD's district map
- `scripts/certs/`: the intermediate certificate IMD's gauge server leaves out of its TLS chain
- `.github/workflows/deploy.yml`: scheduled update and deploy

## Data source notes

- IMD gauge totals cover the 24 hours to 8:30 am IST and are published around 2 pm IST.
- Chennai Metro Water's lake report usually lags by a day or two; the TN WRD telemetry is same-day.
- TN WRD's certificate has expired, so the script skips certificate checks for that host only.
- GitHub turns off scheduled workflows in public repos after 60 days without commits. Re-enable it
  from the Actions tab if the data stops updating.
