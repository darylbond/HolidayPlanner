# Holiday Planner

Holiday Planner is a static React web app for planning a road-trip holiday with destination scoring, travel-time limits, overnight campsite suggestions, and a day-by-day map-based itinerary.

## What it does

- Accepts a start point, end point, holiday length, max driving hours per day, fuel consumption, fuel tank size, and a list of candidate destinations.
- Chooses and orders destinations to fit within the holiday window using a fast insertion heuristic designed to stay responsive in the browser.
- Builds a route with daily driving chunks so long legs can be split into overnight stops.
- Looks up nearby campsites for generated overnight stops with a preference for free-camp style listings.
- Lists points of interest that sit close to each day’s route.
- Displays the full route and selected day on an interactive OpenStreetMap-based map.

## Data sources

The app is fully client-side and uses public OpenStreetMap ecosystem endpoints:

- Photon for geocoding and reverse geocoding.
- OSRM demo routing for route geometry and drive time.
- Overpass for campsites and points of interest.

These are convenient for a prototype and GitHub Pages deployment, but they are public shared services. For higher-volume or commercial use, replace them with your own hosted services or managed APIs.

The app now spaces out public API calls, retries transient 429 and 503 responses, and batches the main OSRM trip route into a single request where possible. That makes it more tolerant of shared-service limits, but it does not remove those limits entirely.

## Local development

1. Install Node.js 20 or newer.
2. Install dependencies:

```bash
npm install
```

3. Start the development server:

```bash
npm run dev
```

4. Build the production bundle:

```bash
npm run build
```

## GitHub Pages deployment

The repository includes a GitHub Actions workflow that builds and deploys the app to GitHub Pages.

1. Push the repository to GitHub.
2. In the repository settings, open `Pages` and set the source to `Deploy from a branch`.
3. Select the `gh-pages` branch and the `/ (root)` folder.
4. The workflow in `.github/workflows/deploy.yml` will build the app and publish the `dist` output to that branch.

The Vite base path is set automatically from `GITHUB_REPOSITORY` during production builds, with `HolidayPlanner` as a fallback.

## Notes

- Geocoding quality depends on how specific each destination name is.
- Campsite and POI discovery can occasionally be slow or unavailable because it depends on live third-party services.
- The planner currently optimizes for desirability within the trip window and uses public road routing once the stop order has been chosen.
