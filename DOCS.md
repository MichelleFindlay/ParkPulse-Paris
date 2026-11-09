# {{app_name}} documentation (v{{version}})

{{app_name}} is our trip companion for Disneyland Paris ({{trip_dates}}). This page explains how to use it in the park, and at the end how the organiser runs it.

## Getting started

![Installing on Android and iPhone (ℹ️ About)](assets/docs/install.png)

Do these once on each phone, ideally the evening before, on Wi-Fi.

1. **Open the app and sign in** with the PIN or single sign-on the organiser gave you. With the PIN, the app then asks **who's using it**: pick your profile or create one (name plus an emoji). Each person should use their own profile, because it keeps your rides, alerts and notifications separate. To change, tap your avatar in the header → **🔁 Switch profile**.
2. **Install it as an app.** On Android, use Chrome ⋮ → **Install app**. On iPhone, use Safari → Share → **Add to Home Screen**, then always open it from that icon. Full steps are under **ℹ️ About**.
3. **Turn on notifications:** **Mine → 🔔 Notifications → Turn on notifications**, then **Send test**. On iPhone this only works from the Home Screen app.
4. **Download the trip pack:** **Trip → 📦 Download for the trip**. This lets the app work in queues with no signal.
5. **Save the map for no signal:** open **Map** and zoom around both parks and Disney Village once. Map tiles you've viewed are kept.
6. **Mark your must-dos:** on any ride, show or restaurant, tap **☆ Must-do**.
7. **Optional: set a child's height** in **📖 Guide → 🎢 Park info**, so rides they're too short for are skipped in suggestions.

## Header & footer

- **Top line:** the status (when data was last updated, or **Offline**), then four buttons:
  - **🎯 What now?**
  - **📖 Guide**
  - **🔍 Search** (on Waits and Eat & shop)
  - **your avatar** (who's signed in; tap it to change your picture, switch profile or sign out)
- **Park switcher:** Disneyland / Adventure World (plus **Village** on Eat & shop).
- **Hours line:** today's opening hours with an **OPEN / NOT YET OPEN / CLOSED** or **EXTRA MAGIC HOURS** badge.
- **Weather chip** (e.g. ☁️ 9° · 💧60% 15:00): tap for the hourly forecast and each trip day. **Warnings** for rain, strong wind (tall rides and fireworks can pause), storms and cold appear on Waits, with **☔ Rain plan** and **☂️ Nearest shelter** buttons.
- **Footer** (every screen):
  - **⏱ Cron last ran …:** when the data collector last ran. It turns orange if it's late.
  - **ℹ️ About:** what the app is, data sources, privacy, how to install, and status.
  - **Features:** the full feature list.
  - **Docs:** this page.
  - **🔒 Security headers** and **DNSSEC (Verisign)** checkers for the site.

## A day in the park

![🎯 What now? — your best 3 options right now](assets/docs/what-now.png)

- **Before opening:** read the **☀️ morning brief** notification, then check the **🌅 Rope drop** card on Trip (also shown on Waits before opening).
- **Not sure what to do?** Tap **🎯** in the header. You get your best 3 options right now, each with 🧭 Go.
- **Planning a day?** Use **Trip → 🧭 Plan my day**. It re-plans itself if a ride goes down or you fall behind.
- **For shows:** tap **🚶 Leave alert** on a show and the app tells you when to set off.
- **Near closing:** a **⏳ Last chance** notification lists must-dos you haven't ridden yet.
- **After a ride:** tap **I rode it** on its card. That builds the log, Trip Wrapped and better predictions.
- **In the evening:** tap **📦 Update trip pack** on Wi-Fi.

## ⏱ Waits

![The Waits tab with the crowd meter](assets/docs/waits.png)

![An opened ride card: graph, facts and actions](assets/docs/ride-card.png)

- **Wait colours:** green ≤ 15 min, amber ≤ 35, orange ≤ 60, red above that. **Down**, **Closed** and **Refurb** are shown in grey.
- **Labels under a ride:**
  - **↑/↓ 15** compares the wait with 30–60 minutes ago.
  - **usually 35** is the typical wait for this hour on earlier days.
  - **down since 14:05**, **back up 5 min ago** and the breakdown count come from the app's own status log.
  - **Single rider saves X**, **PA likely gone ~15:30** and the Premier Access verdict help you choose a queue.
- **Toolbar:**
  - **Open / ★ / All** filter the list.
  - **☔** shows indoor rides only.
  - **🔮 Later** shows predicted waits for the next 4 hours.
  - **Sort** by wait, land or A–Z. **🔍** in the header searches.
- **Tap a ride** to see today's wait graph, ride facts (indoor/outdoor, minimum height, intensity), predictions, **☆ Must-do**, **🔔 Alert**, **📍** map and **I rode it**.
- **Crowd meter:** the card at the top rates the park 1–5 from the average wait, compared with usual.

## ✨ Shows

![The Shows tab with a leave alert](assets/docs/shows.png)

- **Each show and character meet** lists its next time with a countdown, plus all of today's times (past ones crossed out). Attractions that run as timed performances (e.g. Mickey's PhilharMagic) appear here.
- **Toolbar:** **Upcoming / All today**, **Reserved areas** (show the reserved viewing area sessions, hidden by default), and **↻ Refresh**.
- **☆** marks a show as a must-do. With notifications on, you get a reminder before it starts.
- **Completed shows:** once a show has finished its run, it stops appearing and moves to the closed **Completed shows** list at the bottom. If it returns, it comes back by itself.
- **🆕 NEW:** new rides, shows and restaurants carry a tag for 14 days and are listed on Trip. The app checks once a day.
- **🚶 Leave alert** works out your walk and alerts you when to go: 25 minutes early for parades and night shows, 10 minutes for others.

## 🍴 Eat & shop

![Restaurants with live hours, sources and menus](assets/docs/food.png)

- **🍴 Food / 🛍 Shops** switches lists. The park switcher adds **Village** for Disney Village and the Disney hotels.
- **Hours** always show where they came from: *Disney (live)*, *Disney schedule*, *OpenStreetMap*, *web* (with source and check date; ⚠ means only a fan source), *≈ park hours* (shops) or *your list*.
- **📄 Menu** opens Disney's official menu PDF where one exists.
- **⭐ Ratings:** rate a place and add a note. Everyone sees the party's average.
- **🥗 Diet filter:** tap to cycle vegetarian → vegan → gluten-free → halal. This comes from OpenStreetMap and is incomplete, so always check allergens with staff.

## 🗺 Map & navigation

![The map with ride waits and markers](assets/docs/map.png)

![🗂 Layers](assets/docs/layers.png)

![Turn-by-turn navigation](assets/docs/navigation.png)

- **🗂 Layers** chooses what's shown: rides, shows, food, shops, essentials (toilets, water, first aid…), shelter, seats, smoking areas, viewpoints.
- **◎ Me** centres the map on you. **🚻 Nearest** walks you to the closest toilet.
- **Near you:** below the map, everything within 700 m, nearest first, once you're at the resort. Tap a place to show it on the map.
- **Tap any marker** for its status and walking time, plus:
  - **🧭 Go** for in-app navigation
  - **Apple Maps / Google Maps**
  - **📌 Meet here**
  - **///** what3words, if enabled
- **Navigation** shows the next turn ("Turn left in 40 m"), distance and time.
  - **🔊 Voice** reads out real turns.
  - **♿ Step-free** avoids steps.
  - **Off route:** it re-plans if you're more than ~30 m off the path.
  - **GPS accuracy** in the parks is about 5–15 m, so prompts can be a few seconds early or late.
- **👥 Share me** shows your position to the party, updated every minute while the app is open and hidden 30 minutes after you stop. **📌 Pin me** drops a meet-up pin everyone sees.

## 🗓 Trip

![📆 Crowd calendar](assets/docs/crowd-calendar.png)

![🧭 A saved day plan](assets/docs/plan.png)

- **🎟 Park tickets:** keep everyone's tickets ready for the gates.
  - **📷 Scan ticket** opens the camera. Hold the ticket's QR code in the frame; it's read as soon as it's in focus (iPhone and Android). The app then **redraws an exact copy of the QR code** — same data, crisp at any size — rather than keeping a photo.
  - **🖼 From photo or screenshot** reads the QR code from a picture, such as a screenshot of the e-ticket. For a PDF e-ticket, take a screenshot of it first.
  - If a code can't be read (or isn't a QR code), you can save a picture of it instead. On Android, Aztec and PDF417 codes are read too and kept as a picture.
  - Give each ticket a name (and an optional note such as "3-day"). ✕ removes one (tap twice).
  - **🚪 Show at the gate** shows the redrawn code full screen on white, keeps the screen awake and has **◀ Prev / Next ▶** to go through the party. Turn the brightness up.
  - Tickets are saved **on this phone only**. They're never sent to the server, and they work with no signal. Keep the official ticket or the Disneyland Paris app as a backup.
- **📦 Trip pack:** see *Working offline* below.
- **📆 Crowd calendar:** tap to open it, then tap a day for each park's predicted level (1–10), hours, Extra Magic Hours, events and *why*.
  - Outlined days are trip days. ✓ means the level was measured from real data. 📌 pins a date.
- **🧭 Plan my day:**
  - **Choose** a day and park, optionally a touring plan (small kids, older kids, adults, seniors, mixed), a start time (or Extra Magic Hours), and your rides and shows.
  - **Build plan**, then **Save plan**.
  - **Next up** appears on Waits, and the plan re-optimises itself.
- **📅 Bookings:** add restaurant reservations and Premier Access return times. They feed the plan and trigger reminders.
- **🌅 Rope drop:** the first rides to head for, Extra Magic Hours rides, and the queues that build fastest after opening.
- **🚆 Trains:** live RER A departures, if the organiser enabled them.
- **Trip days:** a card for each day with both parks' hours, Extra Magic Hours, the weather (high/low, rain chance, gusts, sunset) and every show and character time, grouped by park. Today's card is highlighted and opened.

## ★ Mine

![Best times to ride](assets/docs/best-times.png)

- **Must-dos:** your list, with live status. Tap one to jump to it.
- **Best times to ride:** each ride's strip shows average waits by hour (light = short, dark = long). Outlined hours are the best; tap an hour for its exact average. It needs a few hours of collected data and improves every day.
- **🔔 Notifications:**
  - **Switch each type** on or off for this phone.
  - **Send test** checks delivery.
  - **🩺 Check notifications** tests every step and explains fixes.
- **🎨 Theme:** choose **Auto** (follows your phone's light/dark setting), **Light**, **Dark** or **Black** (pure black, kinder to OLED batteries), and an accent colour: Indigo, Castle pink, Ocean, Forest, Sunset, Galaxy, Gold or Graphite. The accent tints the whole app: background, cards, chips, buttons, the header and the phone's status bar. The choice is saved on this phone only.
- **Alerts on this phone:** every ride alert you've set, with ✕ to remove. There's also a reminder to allow notifications if they're blocked.
- **🗓 Visits:** pick a visit to see its stats, rides, shows, Wrapped, badges and map history, or **All** for everything. **＋ Add a visit** starts another trip, and the app switches to it automatically. Rides belong to a visit by their date, so deleting a visit never deletes them, and must-do ticks start fresh each visit.
- **✨ Trip Wrapped:** rides, shows watched, places you ate, shops, characters you met or saw, time queued, records and a party leaderboard. Once the trip has ended it plays as a full-screen story every time you open the app, with awards for everyone: tap the right of the screen to go on, the left to go back, hold to pause, and tap anyone's name to watch theirs. ✕ takes you to the app, and **▶ Watch your Wrapped** on Mine or Trip replays it.
- **🏅 Badges:** 39 to earn, from the end of your Wrapped or **🏅 Badges** at the top of Mine. Tap one to see what you did or how to earn it, **Save image** for a picture of it, or **Save all** for one image of every badge you earned. On iPhone, saving opens the share sheet: choose **Save Image**. Steps and distance are estimates from the walks between your rides, and plan badges use the last plan saved.
- **🔥 Roast badges:** these come last in your Wrapped. Don't fancy it? Untick **Include roast badges** at the top of Mine: nobody sees your roasts and you won't see anyone else's. You can only save images of your own roasts. Some are marked **not tracked** because the app never recorded snacks, purchases, leaving a queue or regroup times.
- **🍽 I ate here / 🛍 I shopped here / 👀 I perused here:** use **I perused here** for a shop you only looked around, which skips the amount. Open a restaurant or shop on Eat & shop and tap the button, then pick the day and time, and add what you spent if you like. They're listed on Mine for the visit you've picked, and don't count as rides. To change an amount, delete the entry and log it again.
- **💶 Spending:** totals for the visit you've picked, by food and shops, day and person. **Set a budget** gives the party one shared budget for that visit, in euros. **Just me** shows your own spending, but the budget line always counts the whole party.
- **🤝 Character collection:** tap the heading to open the checklist, then tap a character, choose **Met them** or **Seen them**, and log the day, time, a note and a photo. Seen characters count towards your progress and show 👀; meeting them later turns that into ✓, and only meetings earn badges. **Add someone else** covers anyone who isn't listed. Meet-and-greets on the Shows tab also have **🤝 I met or saw them**. Tap a character again to see your meetings, enlarge a photo or delete an entry. The whole party can see photos. They aren't included in **Export my data**. Characters earn their own badges, which appear for anyone with at least one ride logged on that visit.
- **📊 Compare:** under **Visits** once you have two. Pick any two visits to see them side by side. It follows **Everyone / Just me**.
- **🎭 Shows watched:** tap **I watched it** on a show on the Shows tab, then pick the day and time. Everything you've watched is listed on Mine, separately from your rides.
- **🗺️ Map history:** on Mine or at the end of your Wrapped. Pick a person and a day to see their rides as numbered stops, and **▶ Replay** to watch the day play out. **Everyone** and **All days** show ride counts per attraction. Lines join rides in order; the app doesn't save GPS tracks, so they aren't the exact walk.
- **📸 Share your Wrapped:** at the end of the story, or **📸 Image to share** on Mine, choose **Save for Stories** or **Save for posts**, or **Share** to post it straight away. The image shows your first name only, and never what you spent. **Ride log:** every ride by day, with **Everyone / Just me**. Delete with ✕ (tap twice).
- **Export my data (JSON):** a download of your must-dos, ride log, shows, meals, shops, spending and characters (not photos).

## 📖 Guide

Open it with **📖** in the header. The chips at the bottom switch sections, and every section lists its sources.

![📖 Guide → ⚡ Skip line: is Premier Access worth it?](assets/docs/guide-skip.png)

### 🏨 Hotels

- **Room finder:** filter the 7 Disney hotels by budget (€–€€€€), 🏊 pool, 🚶 walk ≤ 15 min, no car needed, 👪 5+ people and 🧸 small kids. Each shows stars, price level, theme, walk or shuttle, pool, meal-plan level and Extra Magic Hours. **Rooms & photos** opens the official site.
- **Partner hotels:** stars, location and which shuttle station they use.
- **Disney hotel benefits** and an **Extra Magic Hours** guide.
- **✉️ Room request:**
  - **Tick your wishes:** high floor, quiet, view, connecting rooms, accessible, cot, twin beds, celebration.
  - **Add details:** pick your hotel and add your name and booking reference.
  - **Copy message** gives a polite English + French request to send in the Disneyland Paris app or by email. Requests are never guaranteed.

### 🍽 Dining

- **Reservation finder:**
  - **Lists** the restaurants that take bookings, with today's status and party rating.
  - **Shows** when each trip day's booking window opens: 2 months ahead, or as soon as a Disney hotel stay is booked.
  - **Links** to official booking and the phone number. **+ Add** puts a table into your 📅 Bookings.
- **⭐ Party ratings:** the party's top-rated places.
- **📄 Menus:** every official menu PDF in one list, plus links for the rest.
- **Dining plans & meal vouchers:** how half and full board work, which hotel gets which level, and the April 2027 changes.

### ⚡ Skip line

- **Is Premier Access worth it right now?**
  - **Per ride:** live price and return time, minutes saved (predicted standby at your return time, minus ~10 minutes in the Premier Access line) and the cost per minute.
  - **Verdicts:** **Worth it / Maybe / Probably not**, **Use single rider**, or **Wait instead** (a quieter hour later today).
  - **Set your own value:** "an hour of queuing is worth €…" (default €15).
- **Premier Access Ultimate:** type in today's price from the app. It's compared with buying single-ride Premier Access for your ★ must-dos (or all eligible rides).
- **Single rider lines:** live single-rider waits against standby, and the rules (your group rides apart; children must meet the height limit and be old enough to ride alone).
- **Virtual queues:** e.g. **A Royal Encounter with Elsa and Anna** is booked only through the Disneyland Paris app (Characters → choose a slot). Join as soon as you're inside.

### 🎢 Park info

- **Attractions, lands & heights:** every ride by land, with minimum height, indoor/outdoor, intensity and live status. Enter a **child's height** and rides they're too short for are greyed out (also used by 🎯 What now? and the planner).
- **Refurbishments & closures:** what's closed right now, plus scheduled closures, with ones that overlap your trip highlighted.
- **Parades, night shows & fireworks (today)** and **🐭 Character meets (today):** live times.
- **🔁 Rider Switch:** how to ride big rides without queuing twice when someone can't ride.

### ♿ Access, 🚆 Transport, 🎉 Events

- **Accessibility:** the free **Priority Card** and **Easy Access Card**. Covers who qualifies, accepted proof (e.g. French CMI), companions and where to get them. The official guide is linked.
- **Transport:**
  - **Eurostar:** no direct London train; change at Lille (TGV) or Paris.
  - **RER A:** €2.55 from Paris; take trains to Marne-la-Vallée–Chessy.
  - **Magical Shuttle:** from CDG/Orly, €24/€11, card only.
  - **Disney hotel shuttles.**
  - **Live RER card,** if enabled.
- **Seasonal events:** Halloween, Christmas, New Year's Eve, Lunar New Year, the 35th anniversary and Pride, marked **on now** or **during your trip**.

## 🔔 Notifications

![🩺 Notification check](assets/docs/notifications.png)

- **Ride alerts** (🔔 on a ride): when it reopens, when its wait drops to your target, or if it goes down.
- **Show reminders:** for ★ shows, before they start.
- **Booking reminders:** 30 minutes before.
- **☀️ Morning brief:** on trip days and the day before.
- **⏳ Last chance:** about 45 minutes before closing.
- **Plan warnings:** when the next ride in your plan stops.

All of these come from the server every 5 minutes, so they arrive even with the app closed. Ride alerts, show reminders, last chance and plan warnings only go out on trip days, so alerts you set early stay quiet until the trip starts. Leave alerts are worked out on the phone, so keep the app open or in the background for those.

## 📶 Working offline

![📦 Trip pack download](assets/docs/trip-pack.png)

![⬇ Offline map](assets/docs/offline-map.png)

- **📦 Trip pack** saves everything: waits (as a snapshot), shows, trip-day hours and show times, restaurants and Disney Village, menus list, shops, toilets and first aid, walking paths, guide, crowd calendar and plans. It's kept permanently and refreshes itself when it's over 12 hours old and you have signal.
- **Fully usable with no signal:** hours, show times, menus list, map markers, **🧭 navigation**, essentials, guide, plans and bookings.
- **Snapshot only:** wait times show "Updated 2 h ago". Ride alerts need signal.
- **Map pictures:** only areas you've viewed before are saved. Elsewhere the markers and your route still show on a blank background.

## 👥 Party & privacy

- **🎨 Your picture:** tap your avatar in the header → **🎨 Picture**, or the picture on **Mine** (✏️). Pick an emoji (with single sign-on you can also keep your initials) or **📷 Upload photo**: it's cropped to a square and shrunk to a small image on your phone before it's saved, and shown instead of the emoji. **✕ Remove photo** goes back to the emoji. Your party sees it.
- **Profiles:** with single sign-on you're identified automatically. With the PIN, choose or create your profile after entering it, and switch any time from the header avatar or **Mine**. Switching on a shared phone also moves that phone's notifications to the new person.
- **Shared with the party:** must-dos, the ride log (who rode what), bookings, ratings and the meet-up pin. Your location is only shared if you turn on **Share me**.
- **Kept on your phone only:** settings, ride alerts, leave alerts, the trip pack and map tiles.
- **No ads, trackers or third-party scripts.** Everything runs on our own server.

## ❓ Troubleshooting

- **The status at the top is orange, or says "Updated 2 h ago".** You're offline, or the live feeds are slow. The data shown is the last good copy.
- **The footer says cron hasn't run, or it's orange.** The organiser's 5-minute job isn't running, so history, alerts and reminders stop. Tell the organiser.
- **Notifications don't arrive.**
  - Run **Mine → 🩺 Check notifications**.
  - On iPhone, use the Home Screen app.
  - Check Focus / Do Not Disturb.
- **"Wrong PIN — locked".** There were too many wrong tries; wait 15 minutes. People already signed in aren't affected.
- **Location not found.** Allow location for the site or app in your phone settings. It needs https.
- **The app looks out of date after an update.** Close it fully and reopen it, so the new version can load.
- **Blank map squares.** You're offline in an area you haven't viewed yet. Your route and the markers still work.

## 🛠 For the organiser

### Hosting

- **Requirements:** PHP 8.2+ with `pdo_sqlite`; recommended `curl`, `mbstring` and `openssl` (needed for push and single sign-on). Apache or LiteSpeed with `mod_rewrite` and `mod_headers`.
- **Deploying:** upload the whole folder into the subdomain's folder by FTP (turn on hidden files so `.htaccess` goes up). Make `data/` writable (755, or 775 if needed).
- **Updating:** re-upload changed files. **Never overwrite or delete `data/` on the server.** It holds the database: ride log, must-dos, bookings, wait history and push subscriptions.
- **Backups:** download `data/parkpulse.sqlite` by FTP.
- **Check everything:** open `/api/health`.

### Configuration (`config.local.php`)

| Key | What it does |
|---|---|
| `pin` | Shared PIN login (5 wrong tries = 15-minute lockout). After the PIN, everyone chooses or creates a **profile** (up to 30), which gives per-person ride logs, "Just me" and last-chance alerts |
| `oidc` → `issuer`, `client_id`, `client_secret`, `allowed_emails` | Single sign-on. Takes priority over the PIN; set an allowlist with public providers |
| `trip` → `start`, `end` | Trip dates (used throughout, including this page) |
| `cron_key` | Secret for the web-cron address `/api/cron?key=…` |
| `push_subject` | Contact for push services, e.g. `mailto:you@yourdomain` |
| `brief_time` | Morning-brief time (default 08:00) |
| `prim_api_key` | Free key for live RER A trains |
| `w3w_api_key` | Paid what3words key |
| `map_tiles` | Map picture provider (must be https and send CORS headers) |

Never upload a `config.local.php` with empty login values over the server copy. That would make the app open to anyone.

### Cron (every 5 minutes)

```
*/5 * * * * /usr/local/bin/php /home/USER/PATH/TO/SUBDOMAIN/bin/collect.php >/dev/null 2>&1
```

The cron job:
- **Records** wait snapshots and status changes.
- **Sends** all notifications.
- **Refreshes** schedules, shops, menus, essentials and walking paths.
- **Checks once every 24 hours** for new rides, shows and restaurants, saves each show's running days and marks finished shows as completed.
- **Skips** parks outside opening hours.

If your host has no cron, point a web-cron service at `/api/cron?key=<cron_key>`. The footer shows when it last ran.

### Editable content (via FTP, blocked from the web)

| File | Contents |
|---|---|
| `characters.php` | Starting checklist for the character collection (who you might hope to meet, not a schedule) |
| `disney-village.php` | Disney Village venues, descriptions, booking tips, manual hours |
| `opening-hours.php` | Web-researched hours and closures, with sources and dates |
| `ride-info.php` | Indoor/outdoor, minimum height, intensity, ride length |
| `crowd-calendar.php` | School and public holidays, events and weights |
| `touring-plans.php` | Touring-plan templates and rope-drop strategies |
| `guide.php` | Hotels, dining, skip-the-line, park info, accessibility, transport, events |
| `FEATURES.md`, `DOCS.md` | The Features and Docs pages (`{{trip_dates}}` and `{{app_name}}` are filled in automatically) |

### Screenshots in these docs

Screenshots are optional: any that are missing are simply hidden. To add them, take phone screenshots (portrait, ideally with no personal names or locations showing), crop out the status bar, keep each under ~300 KB (PNG, JPG or WebP), and upload them by FTP to `public/assets/docs/` with these exact names:

| File | What to capture |
|---|---|
| `install.png` | ℹ️ About → 📲 Install as an app |
| `what-now.png` | 🎯 What now? sheet in a park |
| `waits.png` | Waits tab with the crowd meter at the top |
| `ride-card.png` | A ride opened on Waits (graph, facts, buttons) |
| `shows.png` | Shows tab with a 🚶 leave alert on |
| `food.png` | Eat & shop with a restaurant opened (hours source, 📄 Menu) |
| `map.png` | Map with ride waits showing |
| `layers.png` | Map → 🗂 Layers sheet |
| `navigation.png` | Map while navigating (route + next-turn panel) |
| `crowd-calendar.png` | Trip → 📆 Crowd calendar with a day selected |
| `plan.png` | Trip → 🧭 Plan my day with a built plan |
| `best-times.png` | Mine → Best times to ride |
| `notifications.png` | Mine → 🩺 Check notifications results |
| `trip-pack.png` | Trip → 📦 Trip pack after downloading |
| `offline-map.png` | Map → ⬇ Offline sheet |
| `guide-skip.png` | 📖 Guide → ⚡ Skip line ("Is Premier Access worth it?") |

Only files in `public/assets/docs/` can be shown here, and image links to anywhere else are ignored.

### Security

- **Response headers:** CSP, COEP, COOP, CORP and HSTS (HTTPS only).
- **Writes** need the `X-Park-Pulse` header.
- **Content and config files** are blocked by `.htaccess`.
- **Footer links** test the headers and DNSSEC.
- **If you change the PIN or the SSO issuer,** everyone is signed out.
