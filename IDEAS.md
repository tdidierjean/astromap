# AstroMap ideas

Feature ideas and known rough edges, collected 2026-10-13. Context for all of them:
naked-eye observing, live, from two fixed windows (North, South balcony) in a
light-polluted city (Bonn-Beuel, Bortle ~6–7), mainly on a phone.

Status: 💡 idea · ⭐ recommended next · 🐛 known issue

## High value

### ⭐ 1. Cloud forecast on the timeline
*Inspiration: Clear Outside, Astrospheric.*
Show hourly low/mid/high cloud cover behind the Gantt timeline and the time
scrubber, so you can tell at a glance whether tonight is worth looking.
- Source: Open-Meteo (free, no API key, CORS-friendly). Variables
  `cloud_cover_low/mid/high`, maybe `visibility` and `relative_humidity_2m`.
- First online data source in the app: cache the last response, and keep the app
  fully working offline or when the fetch fails.

### ⭐ 2. ISS and bright satellite passes
*Inspiration: Heavens-Above.*
The ISS reaches magnitude −3 and is easy to see from a city. Show passes like
"ISS 20:14–20:18, crosses South window 160°→220°, peak 45°", and draw the track
on the sky view, animated by the scrubber.
- TLEs from CelesTrak (refresh daily, cache), propagation with `satellite.js` (SGP4).
- Visible pass = satellite sunlit and observer in darkness. Use the window
  profiles to say which part of the pass is actually visible.
- Maybe later: Tiangong, bright Starlink trains just after launch.

### ⭐ 3. "Tonight at my windows" summary
*Inspiration: SkySafari "Tonight", Sky Tonight.*
One ranked screen listing what passes through which window, and when: planets,
the Moon, bright stars, asterisms, plus highlights such as:
- "Moon near Saturn at 21:00"
- "Orion clears the trees at 23:40"
- "Vega sets behind tree #2 at 22:15"

Extends the current Plan cards (Moon and planets only) to stars and asterisms,
using the measured horizon profiles.

## Using what makes this app unique

### 💡 4. Seasonal planner per window
For any object, a year view (heatmap of month × hour) of when it is actually
visible through each window, not just above the horizon. Example: "Orion: South
window from mid-November after 23:00; December–February in the evening". Generic
apps can't do this because they don't know your obstructions.

### 💡 5. Events list
Moon–planet conjunctions, meteor shower peaks (and whether the radiant is in a
window), eclipses, and occultations of planets or bright stars by the Moon.
`astronomy-engine` can search for most of these. Show the next ~30 days, each
event flagged by which window can see it.

### 💡 6. Play the night
*Inspiration: Stellarium time controls.*
A play button that animates the sky from sunset to sunrise (adjustable speed), to
watch objects rise over the roofs and set behind the trees. Cheap to build.

## Realism

### 💡 7. Calibrate the sky to your own eyes
*Inspiration: Loss of the Night, Globe at Night.*
A guided test ("which of these Little Dipper stars can you see?") sets the
limiting magnitude from what you actually see, instead of the 4.0 default.
Also add:
- extinction: dim stars near the horizon
- Moon glare: brighter sky background near the Moon, depending on phase
- a twilight-dependent limit, refined from the current model

### 💡 8. Star-hopping guides
Short guided routes from bright anchors, for example:
- the Big Dipper's pointer stars → Polaris
- the arc of the Big Dipper's handle → Arcturus → Spica
- Orion's belt → Sirius, and the other way → Aldebaran / the Pleiades
- the Great Square → Andromeda Galaxy (binoculars)

Draw them as highlighted paths on the sky view.

## Integration with the Pi

### 💡 9. Home Assistant / voice assistant
Home Assistant and a voice assistant already run on the Pi. Options:
- a small endpoint, or a shared JS/Python core, answering "what can I see tonight?"
- HA notifications such as "Clear sky and an ISS pass through the South window at 20:14"
  or "Moon–Saturn conjunction tonight, South window 21:00"

This avoids building push notifications into a static web app.

## Later

### 💡 10. Point-the-phone mode
*Inspiration: Star Walk, SkySafari.*
Phone compasses are unreliable indoors, but the measured walls and rooflines can be
used as references: line up the roofline once, then let the gyroscope keep the view
aligned as you move the phone.

### 💡 11. Binocular objects
Pleiades (M45), Andromeda Galaxy (M31), Orion Nebula (M42), Double Cluster,
Beehive (M44). Mark them as "binoculars" under city skies.

### 💡 12. Red night mode
From the original list, explicitly deprioritised: a red-only theme.
(The installable app + offline caching part shipped 2026-10-13.)

### 💡 13. Edge indicators for bright planets
The Moon's off-screen indicator is generic (`INDICATOR_BODIES` in `src/sky/sky.ts`).
Enable it for Jupiter, Saturn, Venus and Mars, maybe as a setting.

### 💡 14. Richer object info
Distance, light-travel time, constellation, a short description or mythology, and
a link to Wikipedia from the tap info panel.

## Horizon measurement

See `tools/horizon/README.md` for the full process and its reproducibility TODO list.
- **Estimated stretches:** the North profile stretches 300–309° and 19–31° are still
  estimates. Retake these with the 1× camera in full darkness.
- **Leaning wall:** the North window's east wall leans (84° at alt 22° → 99° at alt 64°),
  but it is modelled as vertical at 84°.
- **Triage:** build a `triage.py` go/no-go check before slow plate solves.

## Known issues / polish

- 🐛 **Timeline labels:** the Plan timeline's hour labels overlap on a phone
  ("19:0020:0021:00…").
- 🐛 **Moon badge:** the Moon card shows "VISIBLE" when its windows for the night are
  already over at the chosen time (the badge means "visible at some point tonight").
- 🐛 **Moon chip:** the below-horizon Moon chip can overlap star labels near the top
  (e.g. Altair in the North view). It also gives the next rise but never the set time.
- 🐛 **Hidden-Moon label:** it ignores label collisions (e.g. near Mercury or Libra).
- 🐛 **Compass label:** fully zoomed out, the 300° compass label sits behind the toolbar
  buttons.
- 🐛 **Real-phone testing:** pinch zoom-out and the iOS Safari bottom-toolbar padding
  (56 px estimate) were only tested in emulation.
