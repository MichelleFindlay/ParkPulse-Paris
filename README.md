# Park Pulse

**Version 1.0.0** — see [CHANGELOG.md](CHANGELOG.md).

Live wait times, shows and park hours for **Disneyland Paris** (Disneyland Park +
Disney Adventure World, formerly Walt Disney Studios Park), built for the trip window
**4–6 November 2026**. Plain PHP + SQLite + vanilla JS, mobile-first, with every control
in the bottom thumb zone so it works one-handed in a queue.

## Run locally

```sh
php -S localhost:8000 -t public
```

Open http://localhost:8000. The SQLite file is created at `data/parkpulse.sqlite` on the
first request. Composer is optional (`composer install` only swaps in its autoloader);
`composer serve` runs the same server with `public/index.php` as the router.

Requirements: PHP 8.2+, `pdo_sqlite`. Recommended: `curl` (parallel fetches), `mbstring`.

## Deploy via FTP to a subdomain folder

1. In the hosting panel, set the subdomain's PHP version to **8.2 or newer**.
2. Upload the **whole project folder's contents** into the subdomain's folder, so that
   `.htaccess`, `public/`, `src/`, `data/` and `config.php` sit directly inside it.
   - Turn on "show hidden files" in your FTP client (FileZilla: *Server → Force showing
     hidden files*). The `.htaccess` files start with a dot and are easy to miss.
     Without the root one, the site won't work and `data/` won't be protected.
   - Use binary/auto transfer mode.
3. Set `data/` to permissions **755** (try **775** if the health check says it isn't writable).
4. Open `https://your-subdomain/api/health`. Every required check should be `"ok": true`.
5. Open `https://your-subdomain/`.

The root `.htaccess` sends every request into `public/` and returns 403 for `data/`,
`src/`, the config files and dotfiles. It leaves `/.well-known/` alone so the host's
free SSL keeps renewing. It needs Apache or LiteSpeed with mod_rewrite, which almost
every shared host has.

**Updating later:** re-upload changed files, but **never upload over or delete `data/`
on the server**. It holds the live database (ride log, must-dos, wait history).

If the host lets you point the subdomain's docroot at `public/` directly, that's
better still; nothing else changes.

On nginx, send everything that isn't a file to `public/index.php`
(`try_files $uri /index.php?$query_string;`) and deny `/data`.

## Install on phones

**Android (Chrome):** open the site → ⋮ menu → **Install app** (older versions: *Add to Home screen*) → Install. On Android, Chrome also offers an **📲 Install Park Pulse** button under **ℹ️ About** when the site qualifies. Samsung Internet: ≡ → *Add page to* → *Home screen*. Firefox: ⋮ → *Install*. Notifications work in the browser too; installing gives a full-screen app with its own icon.

**iPhone / iPad (Safari):** Share → **Add to Home Screen** → Add, then open it from that icon. Push notifications only work from the Home Screen app (iOS 16.4+).

After installing: sign in, turn on notifications (Mine → Notifications) and tap 📦 *Download for the trip*. The same steps are in the app under **ℹ️ About → 📲 Install as an app**.

## What it does

| Tab | |
|---|---|
| **Waits** | Every attraction, colour-coded by standby wait, with single-rider, Premier Access price/return window, a trend arrow (vs. 30–60 min ago), "usually X" for this hour from earlier days, and ✓ for rides you've logged. Tap a ride to see a sparkline of today's waits, add it to your must-do list, or log "I rode it" (actual queue time, queue type, note). Filter Open / ★ / All, sort by wait, land or A–Z, and search. |
| **Shows** | Today's shows and character meets with the next time and a countdown. Reserved viewing area sessions are hidden by default. |
| **Map** | Live map of both parks and Disney Village with your GPS position (blue dot + accuracy ring). Markers: rides show their wait (colour-coded, ! = down), ✨ shows, 🍴 restaurants (faded when closed), 🛍 shops. Toggle each type, tap a marker for status, walking distance, ★, walking directions, or "Details" (jumps to its tab). Below the map is a **Near you** list (within 700 m, nearest first). Drag, pinch, double-tap or +/− to zoom, ◎ to follow yourself. Any ride, restaurant or shop has a 📍 button to find it on the map. Location needs https and your permission. |
| **Eat & shop** | 🍴 **Food:** every restaurant, snack spot and bar in both parks: open now / opens at / closed, today's hours, area, ★ must-do, and a map link. A **Village** switch lists Disney Village restaurants, bars, cinema and shops from the hand-maintained [`disney-village.php`](disney-village.php). Neither live API covers the Village, so edit that file over FTP to add places or fill in hours. 🛍 **Shops:** every shop, photo point and kiosk OpenStreetMap knows in each park and the Village, grouped by land, with "near Big Thunder Mountain" hints. |
| **Live extras** | **Weather** chip in the header (tap for hourly + trip-day forecast), rain/wind/storm heads-ups. **Crowd meter** on Waits: average standby across open rides, level 1–5, vs. usual and today's curve. **Downtime**: "down since 14:05 (25 min)", "back up 5 min ago", breakdowns per ride today. **Alerts** (🔔 on any ride): when it reopens, when the wait drops to your target, or if it goes down. |
| **Trip** | Countdown, then for each day 4–6 Nov: hours for both parks, Extra Magic Hours, and every show/meet-and-greet time, grouped by park. |
| **Mine** | Must-do progress with live waits, ride log by day (with delete), totals, and a JSON export. |

The header shows today's hours, an EMH / Open / Closed badge, and how fresh the data is.
The app auto-refreshes every 30–60 s while visible. A service worker plus localStorage keeps
the last data on screen when signal drops.

## Planning, notifications & party features

| Feature | Where | How it works |
|---|---|---|
| **Plan my day** | Trip tab | Pick a day, park, rides and shows. A greedy planner orders rides by *walk + predicted wait + how close each ride is to its best time of day*. It works around starred shows (arrive 15 min early) and your bookings, and Premier Access bookings cover their ride. Save it, and a **Next up** card appears on Waits. **Re-plan** reruns it from now, skipping what you've already logged. |
| **Daily park check** | automatic | Once every 24 hours the collector (`src/Catalog.php`) records new rides, shows and restaurants (tagged NEW for 14 days) and each show's running days, because ThemeParks.wiki drops past dates and only publishes to the end of next month. A show that has run with nothing left in that window is marked completed, and returns if dates reappear. A failed fetch never completes a show. |
| **Push notifications** | Mine → Notifications | Standard **Web Push** (VAPID + aes128gcm, implemented in `src/WebPush.php` with openssl; no third-party service). The cron collector (`src/Notifier.php`) sends ride alerts, reminders 5–20 min before ★ shows, reminders 30 min before bookings, and a **morning brief** at `brief_time` on trip days (hours, EMH, weather, RER A, today's bookings). It works with the app closed. Ride alerts, plan warnings, show reminders and last chance only go out between `trip.start` and `trip.end`; the ride status is still tracked silently so the first trip day doesn't send stale alerts. On iPhone it needs Add to Home Screen first (iOS 16.4+). |
| **Bookings** | Trip tab | Restaurants, Premier Access return windows, shows, anything else. Shared with the party, feed the planner, and trigger reminders. |
| **Rain plan** | Waits → ☔ | Shows only indoor/covered rides (from [`ride-info.php`](ride-info.php)), offered automatically when rain is forecast. Ride cards also show indoor/outdoor, minimum height, intensity and ride length. |
| **Wait predictions** | Ride card | "Likely later: 17:00 ~25 · 18:00 ~20…" from hourly history for that ride (or a typical-day curve while history builds), scaled by how today compares so far. |
| **Single rider / Premier Access hints** | Waits | "Single rider saves 35 min"; PA return times tracked every 5 min ("+40 min/h"), with an estimated **sell-out time** (when returns reach an hour before closing). |
| **Party map** | Map → 👥 Share me / 📌 | Opt-in location sharing (updates every minute while the app is open, hidden after 30 min), plus one shared **meet-up pin** ("📌 Meet here" on any place, or "Pin me"). |
| **what3words** | Map card, Map → /// Me | Optional, and needs a **paid** what3words API key (`w3w_api_key` in `config.local.php`); the free plan can't convert coordinates. Every place, the meet-up pin and your own position get a ///three.word.address with Copy, Share and Open (the what3words app/site, which can navigate there). Looked up only when you tap, never stored on the server (the licence restricts storing them); remembered only while the app is open. Hidden when no key is set. |
| **Live navigation** | Map card → 🧭 Go | Turn-by-turn walking directions inside the resort, routed on your phone over OpenStreetMap's footpaths (backstage paths excluded; ~17k junctions, refreshed fortnightly by cron, ~160 KB gzipped, cached for offline use). Shows the route, remaining distance and minutes, the next turn ("Turn left in 40 m"), and follows your GPS. Re-routes automatically if you go off route, announces arrival, optional 🔊 voice for real turns, and keeps the screen awake. Outside the resort it points you to Google/Apple Maps instead (also one tap away on every map card). |
| **🎯 What now?** | Header button | One tap: your best 3 options right now. Rides near you ranked by wait + walk, "unusually quiet" (vs usual or later today), single-rider savings, must-dos and last chances. Also shows you should leave for soon ("starts 17:30 · leave in 8 min") and bookings coming up, each with 🧭 Go. Plus "nearest" shortcuts: 🚻 toilet, 👶 baby change, 🚰 water, ⛑ first aid, 🏧 cash. Respects the child height set in the Guide. |
| **Essentials on the map** | Map → 🚻 Essentials / 🚻 Nearest | From OpenStreetMap (refreshed fortnightly): 30 toilets (baby-changing and wheelchair flags), 32 water fountains, first-aid points (both parks + Village), defibrillators, cash machines, lockers. Tap for 🧭 Go. |
| **More map layers** | Map → ☂️ Shelter · 🪑 Seats · 🚬 Smoking · 📸 Views | From OpenStreetMap: 22 rain shelters + 149 covered walkways, 135 benches + 13 picnic tables, 10 designated smoking areas, 7 viewpoints. Each has its own toggle (so benches don't clutter the map), 🧭 Go, and "nearest" shortcuts in 🎯 What now?. A rain or storm warning offers **☂️ Nearest shelter**. |
| **Diet tags** | Eat & shop | Vegetarian / vegan / gluten-free / lactose-free / halal / kosher badges from OpenStreetMap (21 restaurants tagged as of Nov 2026, e.g. Bistrot Chez Rémy, Royal Banquet, PYM Kitchen, Silver Spur, the Hotel New York restaurants), plus a **🥗 diet filter** (tap to cycle). Clearly marked as partial; always check allergens with staff. |
| **Step-free routing** | Navigation panel → ♿ | Avoids steps for pushchairs and wheelchairs (falls back to a route with steps if there's no step-free way, and says so). In step-free mode, "nearest toilet" prefers wheelchair-accessible ones. |
| **Leave alerts for shows** | Shows → 🚶 Leave alert (also in What now?) | Works out your walk to the show and alerts you when it's time to go, arriving 25 min early for parades and night shows, 10 min for others. Checked on the phone while the app is open or in the background. |
| **Last chance** | automatic | About 45 min before each park closes: your must-dos there that you haven't ridden today and that are running, shortest wait first. Sent as a push notification by the cron job (per person with single sign-on), or as an in-app alert when push is off. |
| **📦 Trip pack** | Trip tab (top) | "Download for the trip" fetches everything in one go: live waits/shows/restaurants for both parks, trip-day hours and show times, restaurant schedules, Village & hotels, shops, menus, essentials, the walking network, guide, crowd calendar, touring plans, best times, weather, trains, bookings, must-dos and ratings, plus the current app files. It asks the browser for **persistent storage** (iOS otherwise clears site data after about a week unused), shows progress and any gaps, and refreshes itself in the background when the pack is over 12 h old and there's signal. API data lives in its own cache (`park-pulse-data-v1`), so app updates don't wipe it. |
| **Offline map** | Map → ⬇ Offline | Tiles you view are kept (up to 1,500) so the map works without signal. Bulk "save the whole resort" is offered only for tile servers that allow it (OSM's don't). |
| **Crowd calendar** | Trip tab | Predicted crowd level (1–10) per park per day, for 2 weeks back and 2 months ahead, with park hours, EMH, events and the reasons behind each figure (school holidays in FR/BE/NL/UK, public holidays and bridge days, weekday, season, park-hours length). Data and weights are in [`crowd-calendar.php`](crowd-calendar.php). Days with enough history also show the level actually **measured**. Pin dates to track them (per phone). |
| **Touring plans** | Trip → Plan my day | Ready-made Disneyland Paris templates for small kids, older kids, adults, seniors and mixed groups, for each park ([`touring-plans.php`](touring-plans.php)). A template pre-selects rides and shows; the planner then orders them for that specific day. |
| **Real-time re-optimisation** | automatic | After each live refresh, today's saved plan re-runs from now if one of the next rides is down, is 20+ min longer than planned, or you're 25+ min behind. With notifications on, the server also pushes a warning when a planned ride stops while the app is closed. |
| **Later view** | Waits → 🔮 Later | Current wait plus predicted waits for the next 4 hours on every ride. Hours at least 10 min better than now are highlighted. |
| **Rope drop** | Trip tab, and on Waits before opening | Per-park first-hour order, the usual EMT rides, tips with sources, and **queues that build fastest after opening** measured from your history. |
| **I ate here / I shopped here / I perused here** | Eat & shop cards | Log a restaurant or shop with its trip day, time, a note and an optional amount (none for perusing, `kind` `browse`). Listed on Mine, stored in `place_log` (`POST /api/places`), separate from the ride log. |
| **Spend tracker** | Mine | Totals `place_log.amount_cents` by type, day and person. One optional party budget per visit in `visits.budget_cents` (`POST /api/visits/{id}/budget`). Euros only. |
| **Queue timer** | Ride cards, with a bar on every tab | Runs on the phone (`pp:queueTimer` in localStorage) and is dropped if left over from another day. Saving stores the sign's wait in `ride_log.posted_wait`, which badges prefer to the snapshot estimate. |
| **Character collection** | Mine, and meet-and-greets on Shows | Checklist from [`characters.php`](characters.php) plus names people add, logged in `character_log` with a `kind` of `met` or `seen` (only `met` earns badges). Photos are shrunk on the phone and stored in `character_photos`, apart from the log, because `/api/me` is cached in localStorage; they're served from `GET /api/characters/{id}/photo` to signed-in users. |
| **Compare visits** | Mine → Visits | Worked out in `app.js` from the logs, plus `added` from `GET /api/catalog`. |
| **I watched it** | Shows tab | Log a show with its trip day, time and a note. Listed on Mine, stored in `show_log`, separate from the ride log. |
| **Map history** | Mine, or the end of Wrapped | Numbered stops per person and day from the ride log and ride positions, with a replay and party ride counts. Location sharing stores only each phone's latest position (deleted after 6 hours), so these aren't GPS tracks. |
| **Trip Wrapped** | Opens first once the trip has ended; replay from Mine or Trip | Full-screen story for each person (rider type, top rides, biggest day, obsession, thrill score, wettest ride count, darkest day, land loyalty, shows watched, places eaten at, shops, characters) with party totals, party slides for each of those and awards; tap a name to watch theirs. 39 badges computed in `app.js` from the ride log and `GET /api/wrapped` (`src/Wrapped.php`), each saveable as a PNG. 30 roast badges play last, with a per-person opt-out kept in `meta` (`POST /api/wrapped/roasts`). Walking and park time are estimates from ride-to-ride data; plan badges use the last saved plan. Mine also shows the summary card: rides, unique rides, time queued, average and longest wait, most-ridden ride, best day, earliest/latest ride, single-rider/PA counts, and a party leaderboard. |

### 📖 Guide (header button)

Content lives in [`guide.php`](guide.php), researched 2 Nov 2026 with sources listed in the app.

| Section | Contents |
|---|---|
| 🏨 Hotels | **Room finder** for the 7 Disney hotels (budget, pool, walk ≤15 min, no car, 5+ people, small kids), partner hotels with their shuttle stations, Disney-hotel benefits, an **Extra Magic Time** guide, and a **room-request builder** that writes a polite EN/FR message to copy into the app chat or an email. Photos: link to the official room pages. |
| 🍽 Dining | **Reservation finder**: bookable restaurants with today's status, party rating, when each trip day's booking window opens, a link to official booking, and "+ Add" into Bookings. **Party ratings** (★ + notes, per phone, everyone sees averages; also on Eat & shop cards). Dining plan and meal-voucher guide. |
| ⚡ Skip line | **"Is it worth it?"** for every Premier Access ride, from live data: minutes saved at your return time (predicted standby − ~10 min PA line) against the live price, compared with what you say an hour of queuing is worth (default €15). Verdicts: Worth it / Maybe / Probably not, **Use single rider** (when it's ≤15 min and saves 15+), or **Wait instead** (a quieter hour later today). Also: an **Ultimate break-even** calculator (your must-dos' One prices vs the Ultimate price you enter), live single-rider savings, Premier Access One/Ultimate explainers, and a **virtual queue** guide (e.g. the Anna & Elsa Royal Encounter). Verdicts also appear on each ride card. |
| 🎢 Park info | Attraction directory by land with height, indoor/outdoor, intensity and live status, plus a **child-height filter**. Refurbishments (live + scheduled, flagged when they overlap your trip). Today's parades, night shows and **character meets** from live data. Rider Switch. |
| ♿ Access | Priority Card and Easy Access Card: who qualifies, proof, companions, where to get them. |
| 🚆 Transport | Eurostar (no direct train since 2023: via Lille or Paris), RER A (€2.55 since the 2026 fare reform), Magical Shuttle (€24/€11, card only since 19 Oct 2026), resort shuttles, plus the live RER card. |
| 🎉 Events | Halloween, Christmas, New Year's Eve, Lunar New Year, the 35th anniversary and Pride, with "on now" / "during your trip" flags. |

Not included, and why: **live table availability** (Disney's booking API needs a login and is disallowed in robots.txt), **third-party ratings** (paid APIs or scraping), **menus** (no readable source), **room photos** (copyright, so we link instead), and a **room-request *service*** (needs people; the app writes the request for you).

Push needs the PHP **openssl** extension (`/api/health` → `push_notifications`). The VAPID keys are created automatically and stored in the database. Set `push_subject` in `config.local.php` to your site URL or a `mailto:` address if you like.

## Keep history building (cron)

Trends, best times, the crowd meter, "usually X" and downtime all come from snapshots
taken every 5 minutes. Without a scheduled job they're only recorded while someone has the
app open. Set up **one** of these:

**A. cPanel → Cron Jobs (best).** Add a job for every 5 minutes (*/5 in the minute field,
`*` in the others):

```
/usr/local/bin/php /home/USER/PATH/TO/SUBDOMAIN/bin/collect.php >/dev/null 2>&1
```

- `/home/USER/PATH/TO/SUBDOMAIN` is the folder you uploaded to (cPanel's File Manager shows it).
- Use a PHP 8.2+ binary. On cPanel it's often `/usr/local/bin/ea-php82` or `/opt/cpanel/ea-php82/root/usr/bin/php`.

**B. Web cron (if your host has no cron).** `config.local.php` contains a random `cron_key`.
Point any web-cron service at this URL every 5 minutes:

```
https://<your-subdomain>/api/cron?key=<cron_key>
```

**What a run does:** fetches live data for each park (only from an hour before opening, EMH
included, to an hour after closing), stores a snapshot and status changes, refreshes
restaurant schedules, shops and weather, and records the time it ran. Runs never overlap
(file lock), and the web URL runs at most once every 4 minutes. Snapshots are skipped while
every ride is closed, so the database stays small (a few MB for the whole trip).

Check it's working: `/api/health` → `history_collector` shows "cron last ran N min ago".

## Trains (optional)

Live RER A departures from Marne-la-Vallée–Chessy towards Paris, plus disruption messages,
on the Trip tab. Get a free key at https://prim.iledefrance-mobilites.fr (create an account,
then "Mon jeton") and set `'prim_api_key' => '…'` in `config.local.php`. The station and line
IDs come from IDFM open data and are in `config.php` under `transit`. TGV/Eurostar aren't
included because SNCF has no free live API.

## Alerts: what to expect

Alerts are checked every time waits refresh while Park Pulse is open, or in a background tab
on Android/desktop (the browser polls about once a minute). Allow notifications when asked.
On iPhone, notifications only work if you **Add to Home Screen** and open it from there, and
iOS pauses background tabs, so keep the app on screen when waiting for an alert. Truly
closed-app push would need a web-push server, which isn't included.

## Shops & map data

Shops come from **OpenStreetMap** via the Overpass API (free, no key). The query covers the box
in `shops_bbox`. Each shop is assigned to a park if it's within 150 m of one of that park's rides
or restaurants, otherwise to Disney Village if it's inside `village_bbox`, otherwise dropped
(hotels, car parks). Overpass is often busy, so results are cached for 7 days and the last good
copy is always served. Several mirrors are tried in turn (`overpass_urls`), and the cron
collector refreshes them in the background.

Map tiles are OpenStreetMap's standard tiles (`map_tiles`), which are fine for light personal
use with the attribution shown. The map is a small built-in viewer (`public/assets/map.js`),
so no third-party JavaScript is loaded. Only tile images come from the tile server, and the
page's Content-Security-Policy allows exactly that host.

## Opening hours: where they come from

Each place shows its source next to today's hours, along with its hours on every trip day.

| Place | Source |
|---|---|
| Park restaurants | ThemeParks.wiki `/live` (today), else Disney's per-restaurant `/schedule` (also used for the trip days) |
| Disney Village & Disney hotel restaurants/bars | OpenStreetMap `opening_hours` (parsed: day ranges, split shifts, past-midnight). Your `disney-village.php` `hours` override it |
| Researched on the web | [`opening-hours.php`](opening-hours.php): hours looked up by hand (official sites, Disney's hours via dlpstats.com, tourist office, guides), each with source + check date, ⚠ when only a fan source. These override OSM. Also marks closures (e.g. Annette's Diner renovation) |
| Shops | OpenStreetMap `opening_hours` when tagged, otherwise **≈ park hours** (Disney shops follow the park), clearly marked |
| Anything else | "No opening hours found in any source", never a guess |

**Which source wins** when more than one has hours for the same place (first match is used):

| Place | Order of precedence |
|---|---|
| Park restaurants | 1. ThemeParks.wiki live status & today's hours → 2. Disney's per-restaurant schedule |
| Disney Village & hotels | 1. `hours` in `disney-village.php` (yours) → 2. `opening-hours.php` (web research) → 3. OpenStreetMap |
| Shops | 1. `opening-hours.php` → 2. OpenStreetMap → 3. today's park hours (labelled "≈ park hours") |

Closures in `opening-hours.php` (`'hours' => 'off'`) beat everything except your own `disney-village.php` hours, and show the reason on the card.

**Menus** aren't opening hours but follow the same idea: official Disney menu PDFs are found automatically for park restaurants (`src/MenuFinder.php`, re-checked weekly; 42 of 52 found on 2 Nov 2026), with links to Disneyphile and julieears.com for the rest.

The official Disneyland Paris website isn't scraped: its robots.txt disallows the `/api` that
serves those hours.

## Login

Choose one in `config.local.php` (create it next to `config.php`; it's never served):

**OIDC (recommended)** works with Google, Microsoft Entra, Authentik, Keycloak, Auth0, Zitadel and similar.

```php
<?php
return [
    'oidc' => [
        'issuer'         => 'https://accounts.google.com',
        'client_id'      => '….apps.googleusercontent.com',
        'client_secret'  => '…',
        'allowed_emails' => ['you@example.com', 'partner@example.com'],
    ],
];
```

1. Create an OAuth/OIDC "web application" client at your provider.
2. Register the redirect URI `https://<your-subdomain>/auth/callback`. `/api/health` shows
   the exact URL the app will send.
3. **Always set an allowlist** (`allowed_emails`, `allowed_domains` or `allowed_subs`) with
   public providers. Otherwise anyone with a Google or Microsoft account can sign in.

The flow is authorization code + PKCE with `state` and `nonce`. The ID token signature is
checked against the provider's JWKS (RS256/384/512, ES256 or HS256), along with
issuer/audience/expiry. This needs the PHP `openssl` extension. Sessions are signed cookies
(30 days by default). Each ride in the log records who logged it, and Mine has an
Everyone / Just me switch. The must-do list stays shared.

**PIN:** `<?php return ['pin' => '1234'];` gives one PIN for the whole party.

**Neither:** the app is open to anyone with the URL.

When signed in, the header shows a pill with your initials and first name. Tap it to see the
full name and email you're signed in as, or to sign out.

## Data & caching

- **ThemeParks.wiki** (primary). The destination and both parks are found at runtime in
  `/destinations` (slug `dlp` / name "Disneyland Paris"; the parks are matched by
  "Disneyland Park" and "Studios" or "Adventure World"). `/live` provides waits, status,
  Premier Access and showtimes. The park's `/schedule/YYYY/MM` provides hours and EMH, and
  each show's `/schedule/YYYY/MM` provides the trip show times.
- **Queue-Times.com** (fallback). Its park IDs are also looked up at runtime from
  `/parks.json`. It fills in waits when ThemeParks.wiki is down, stale or reports no
  waits, and always supplies land names (cached daily). Names are matched by
  normalisation, so "Autopia, presented by Avis" matches "Autopia". Its
  "… Single Rider" entries fill the single-rider wait.
- Every upstream response is cached in SQLite and served **stale-on-error** if a refresh fails.

| Data | TTL |
|---|---|
| destinations | 7 days |
| park children | 1 day |
| live | 60 s |
| park schedule | 1 h |
| show schedules | 6 h |
| Queue-Times live | 2 min |
| Queue-Times parks / lands | 7 days / 1 day |

- A wait snapshot per park is stored at most every 5 minutes (only from fresh data). It
  powers the trend arrows, sparklines and "usually" values.

Restaurants come from the same `/live` (status + today's opening hours) and `/children`
(map location, plus restaurants missing from `/live` that day) calls. Queue-Times has no
restaurants, so each restaurant's area is estimated from the nearest ride within 200 m.

All TTLs, the first visit's dates, the timezone and the snapshot interval are in `config.php`. Further visits live in the `visits` table and are managed from Mine.
Override them in `config.local.php`.

## Layout

```
public/               docroot
  index.php           front controller (also the php -S router)
  sw.js               service worker: offline cache, map-tile cache, Web Push
  manifest.webmanifest
  assets/app.js       the whole front end (vanilla JS, no build step)
  assets/map.js       built-in slippy map (no third-party JS)
  assets/theme.js     colour mode + accent, applied in <head> before first paint
  assets/qr.js        built-in QR code reader + writer for park tickets (no third-party code)
  assets/app.css, assets/icon.svg
src/
  App.php             routes, page shell, health check, cron collector
  Router.php, Http.php, HttpError.php, UpstreamException.php, Cache.php, Db.php (schema + migrations), Text.php
  Auth.php, Oidc.php, Jwt.php          login (none / PIN / OIDC)
  ParkService.php     live merge, history, downtime, crowd meter, trip, food, shops, best times, touring plans
  ThemeParks.php, QueueTimes.php, OsmShops.php, Weather.php, Transit.php, MenuFinder.php, What3Words.php, WalkGraph.php, Essentials.php   data sources
  OpeningHours.php    OpenStreetMap opening_hours parser
  CrowdCalendar.php   crowd-level predictions
  UserData.php        must-dos and ride log
  Party.php           bookings, ratings, party locations, meet-up pin
  PushStore.php, WebPush.php, Notifier.php   push subscriptions, VAPID/aes128gcm sending, scheduled notifications
bin/collect.php       cron collector (history, downtime, notifications, cache warm-up)
data/                 SQLite database (created on first run; never overwrite on the server)

Editable content (all blocked from the web by .htaccess):
config.example.php    defaults template — copy to config.php; put secrets in config.local.php (both git-ignored, see config.local.example.php)
characters.php        starting checklist for the character collection
disney-village.php    Disney Village venues (descriptions, booking tips, manual hours)
opening-hours.php     web-researched hours and closures, with sources
ride-info.php         indoor/outdoor, minimum height, intensity, ride length
crowd-calendar.php    school/public holidays, events and weights for the crowd calendar
touring-plans.php     touring-plan templates and rope-drop strategies
guide.php             hotels, dining, skip-the-line, park info, access, transport, events
FEATURES.md           in-app Features page ({{trip_dates}} / {{app_name}} filled from config)
DOCS.md               in-app Docs page: user guide + organiser's guide (same placeholders)
```

### API

All under `/api/` and returning JSON; everything except `bootstrap`, `health`, `login`, `logout` and `cron` needs a signed-in session when a PIN or OIDC is configured. Writes (POST/DELETE) require the header `X-Park-Pulse: 1` (a simple CSRF guard).

| Area | Endpoints |
|---|---|
| App | `GET bootstrap` · `GET health` · `GET cron?key=` |
| Login | `POST login` (PIN) · `POST logout` · `GET /auth/login`, `GET /auth/callback` (OIDC, outside `/api/`) |
| Profiles | `GET profiles` · `POST profiles` · `POST profiles/select` (PIN) · `POST avatar` (emoji / photo, SSO and PIN) |
| Live & history | `GET live/{dlp\|studios}` · `GET history/{entityId}` · `GET best-times` · `GET crowd-calendar` |
| Food & shops | `GET village` · `GET food-schedule/{dlp\|studios}` · `GET shops` · `GET menus` · `GET ratings?device=` · `POST ratings` |
| Planning | `GET trip` · `GET touring-plans` · `GET bookings` · `POST bookings` · `DELETE bookings/{id}` · `GET plan` · `POST plan` · `DELETE plan` |
| Extras | `GET weather` · `GET transit` · `GET w3w?lat=&lng=` · `GET walk-graph` · `GET essentials` · `GET guide` |
| Mine | `GET me` · `POST favourites` · `POST log` · `DELETE log/{id}` · `POST watched` · `DELETE watched/{id}` · `POST places` · `DELETE places/{id}` · `POST characters` · `GET characters/{id}/photo` · `DELETE characters/{id}` · `POST visits/{id}/budget` · `GET export` |
| Push | `GET push/key` · `POST push/subscribe` · `POST push/unsubscribe` · `POST push/prefs` · `POST push/alerts` · `POST push/status` · `POST push/test` |
| Party | `GET party` · `POST party/location` · `POST party/stop` · `POST meet` · `DELETE meet` |
