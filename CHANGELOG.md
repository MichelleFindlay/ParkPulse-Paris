# Changelog

All notable changes to Park Pulse. Versions follow [semantic versioning](https://semver.org/): MAJOR.MINOR.PATCH.

## v1.0.0 — 2026-11-09

First release, for the Disneyland Paris trip.

### Core

- **Live waits** for Disneyland Park and Disney Adventure World: standby, single rider, Premier Access, trends, downtime, crowd meter, predictions, rain plan.
- **Shows & character meets** with countdowns, reminders and leave alerts.
- **Eat & shop:** restaurant hours from several labelled sources, official menu PDFs, party ratings, diet filter, shops, Disney Village and hotels.
- **Map:** GPS, layers, essentials, step-free turn-by-turn navigation, party sharing and meet-up pin, what3words (optional).
- **Trip:** trip pack for offline use, crowd calendar, day planner with touring plans and live re-optimisation, bookings, rope drop, trains (optional).
- **Mine:** must-dos, best times to ride, notifications and checks, Trip Wrapped, ride log, export.
- **🎯 What now?** and **📖 Guide:** hotels, dining, skip-the-line, park info, accessibility, transport, events.
- **Notifications:** Web Push for ride alerts, show and booking reminders, morning brief, last chance and plan warnings.
- **Accounts:** single sign-on (OIDC) or PIN with per-person profiles; brute-force lockouts.
- **Operations:** cron collector, `/api/health`, security headers (CSP, COEP, COOP, CORP, HSTS), About / Features / Docs pages.

### Also included

- **👀 I perused here:** a second button on shop cards for when you only looked. It logs the day, time and a note with no amount, is listed on Mine as "Shops you perused", and has its own lines in Trip Wrapped and Compare visits.
- **🍽🛍🤝 Food, shops and characters in Trip Wrapped:** each person gets a slide for places they ate, shops and characters (met and seen, with photos), and the party gets one for each, which includes anyone who logged no rides. The summary, share image, share text and Mine card count them too. Amounts spent appear on the slides inside the app, never on the share image or text. None of this counts towards rides or rider type.
- **👀 Seen characters:** the character collection now records whether you met a character or only saw them. Sightings count towards the checklist's progress, marked 👀, but only meetings earn badges. Database migration 15.
- **⏱ Queue timer:** tap **I'm in the queue** on a ride, then **I'm on** when you board. A bar shows the running time on every tab, and the ride log opens with your real wait filled in, ready to save. It stores what the sign said alongside it, shows both in the ride log and on the Mine summary, and feeds The Sign Lied and Betrayed by the Sign badges. The timer is kept on the phone, so it survives closing the app. Database migration 14.
- **🤝 Character collection:** a checklist on Mine with progress, for each visit or **All**. Tap a character to log the day, time, a note and an optional photo, or add anyone who isn't listed. Meet-and-greets on the Shows tab get an **I met them** button. The starting list is the new editable `characters.php`. Six new badges, in a new Characters group, bring the total to 39. New `POST /api/characters`, `GET /api/characters/{id}/photo` and `DELETE /api/characters/{id}`.
- **💶 Spend tracker:** add an optional amount in euros to **I ate here** and **I shopped here**. Mine totals it by type, day and person, with an optional party budget for each visit. New `POST /api/visits/{id}/budget`.
- **📊 Compare visits:** on Mine once there are two visits: rides, queues, shows, meals, shops, characters and spending side by side, top rides, what was new to you, what you skipped and what's new at the parks. `GET /api/catalog` now also lists everything added since the first check.
- **🍽 I ate here and 🛍 I shopped here:** log a restaurant or shop from its card on Eat & shop, with the day, time and a note. They're listed on Mine for each visit, and kept apart from rides, so they don't affect ride counts or badges.
- **📆 Crowd calendar dropdown:** on Trip it's now closed by default and opens with a tap, and each phone remembers whether it's open.
- **Fixed:** the Waits tab showed the crowd calendar instead of the live crowd meter, because two functions shared a name. The meter is back and the calendar is on Trip only.
- **🆕 Daily park check:** every 24 hours the collector looks for new rides, shows and restaurants, tags them **NEW** for 14 days and lists them on Trip. Each show's running days are now saved, so past trip days keep their shows after the schedule feed drops them.
- **Completed shows:** a show that has run and has nothing left in the published schedule is marked **Completed** on Trip days and must-dos, with a closed list on the Shows tab. It comes back by itself if new dates appear.
- **Fixed:** the Guide labelled shows not running today as "done today", and the map showed their markers. They now only appear on days they run.
- **🗓 Multiple visits:** add, rename, re-date or delete visits from Mine, or plan the next one from Trip once a trip is over. The app follows the current visit: the one happening now, else the next, else the latest. Pick any visit on Mine to look back at its stats, ride log, shows, Wrapped, badges and map history, or **All** for everything. Must-do ticks now count the current visit only. `config.php`'s `trip` becomes the first visit automatically, and new dates there add a new visit. Each visit's weather, park hours, ride facts and plan are saved after it ends, so old badges don't change.
- **🔕 Quiet outside the trip:** ride alerts, plan warnings, show reminders and last chance only go out between the trip's start and end dates, including the in-app versions. Booking reminders and the morning brief are unchanged.
- **🎭 Shows in Trip Wrapped:** a slide for the shows each person watched, a party Showtime slide (which includes anyone who watched shows but logged no rides), show counts on the summary, share image and share text, and a line on the Mine card. Shows still don't count towards rides, badges or rider type.
- **🎭 I watched it:** log a show from its card on the Shows tab, picking the trip day and time. Shows watched are listed on Mine and kept apart from rides, so they don't affect ride counts or badges. New `POST /api/watched` and `DELETE /api/watched/{id}`; database migration 10 adds a `show_log` table.
- **🗺️ Map history:** each person's trip on the map as numbered stops, day by day, with a replay; or the whole party with ride counts per attraction. Open it from Mine or the end of your Wrapped. It's built from the ride log and ride positions: the app doesn't keep GPS tracks, so the lines join rides rather than trace a walk.
- **🔥 Roast badges:** 30 cheeky badges (queue shame, planning disasters, commitment issues, timing crimes, snack sins, weather fails, ride obsession, group roasts), each with a punchline on its card. They play last in the story, after the positive badges. **Include roast badges** on Mine turns them off: your roasts are hidden from everyone, and you see nobody's. 8 aren't recorded by the app, so they're marked "not tracked". Chickened Out moved here from Thrill. New `POST /api/wrapped/roasts`.
- **📸 Wrapped image for social media:** save or share your Wrapped as a PNG, sized for Stories (1080×1920) or feed posts (1080×1350), from the end of the story or **📸 Image to share** on Mine. It shows your first name only.
- **🏅 Wrapped badges:** 33 badges across timing, queues, ride habits, thrill, weather, planning and movement, worked out from what the app already holds. Each has a drawn emblem; save or share any earned badge as a 1080×1350 PNG card with your name and what you did, or save them all as one image. Reach them from the story, Mine or Trip.
- **More Wrapped slides:** your obsession, thrill score with a label from Gentle Boat Enjoyer to Adrenaline Goblin, wettest ride count, darkest day and land loyalty with your home turf.
- **Front row** tick box when logging a ride. New read-only `GET /api/wrapped`, and `ride-info.php` gains optional `drop`, `speed`, `inversions`, `wet` and `dark` facts.
- **🎉 Trip Wrapped stories:** once the trip has ended, opening the app starts a full-screen story: each person's rides, top rides, time queued, longest queue, biggest day and rider type, then party totals and an award for everyone. Tap a name to watch that person's Wrapped; share a summary as text. Close it to reach the app, replay it from Mine or Trip. Links from notifications skip it. Only rides inside the trip dates count.
- **🎨 Profile pictures:** single sign-on users (and PIN profiles) can choose an emoji, keep their initials, or upload a photo (cropped to 160×160 on the phone, checked and stored on the server). Shown in the header, account sheet, Mine and the profile list. New `POST /api/avatar`; database migration 8 adds an `avatars` table.
- **🎟 Park tickets** (Trip tab): scan tickets with the camera or import a photo or screenshot. A built-in QR reader and writer (`assets/qr.js`, no third-party code) decodes the ticket's QR code on any phone and redraws an exact copy with the same data, mode, version and error-correction level. Codes that aren't QR are kept as a picture. Show them full screen at the gates with the screen kept awake. Stored on the phone only. The page now allows the camera for its own origin (`Permissions-Policy: camera=(self)`).
- **🎨 Theme options** (Mine → Theme): Auto, Light, Dark and Black (OLED) modes, plus 8 accent colours that tint the whole app (background, cards, chips, buttons, header): Indigo, Castle pink, Ocean, Forest, Sunset, Galaxy, Gold, Graphite. Applied before the page paints, so there's no colour flash; the status bar follows the header colour.

### Setup

- Configuration templates: copy `config.example.php` to `config.php` and `config.local.example.php` to `config.local.php` (both git-ignored). The app falls back to `config.example.php` when `config.php` is missing. OIDC can also be set through `PARK_PULSE_OIDC_ISSUER`, `PARK_PULSE_OIDC_CLIENT_ID` and `PARK_PULSE_OIDC_CLIENT_SECRET`.
