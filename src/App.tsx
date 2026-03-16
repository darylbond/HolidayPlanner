import { useState } from "react";
import { PlannerForm } from "./components/PlannerForm";
import { ItineraryPanel } from "./components/ItineraryPanel";
import { TripMap } from "./components/TripMap";
import { planRoadTrip } from "./lib/planner";
import type { DailyPlan, PlannerInput, TripPlan } from "./types";

const defaultPlannerInput: PlannerInput = {
  start: "Sydney NSW",
  end: "Melbourne VIC",
  holidayDays: 12,
  maxDriveHoursPerDay: 5.5,
  fuelConsumptionLitresPer100Km: 9.2,
  fuelTankLitres: 75,
  destinations: [
    {
      id: crypto.randomUUID(),
      name: "Canberra ACT",
      stayDays: 1,
      desirability: 6,
      notes: "Short city stop with galleries and lake walks.",
    },
    {
      id: crypto.randomUUID(),
      name: "Jervis Bay NSW",
      stayDays: 2,
      desirability: 9,
      notes: "Beach time and national park walks.",
    },
    {
      id: crypto.randomUUID(),
      name: "Lakes Entrance VIC",
      stayDays: 2,
      desirability: 8,
      notes: "Coastal rest days and easy base for Gippsland.",
    },
    {
      id: crypto.randomUUID(),
      name: "Wilsons Promontory VIC",
      stayDays: 2,
      desirability: 10,
      notes: "High-priority nature stop.",
    },
    {
      id: crypto.randomUUID(),
      name: "Bright VIC",
      stayDays: 2,
      desirability: 7,
      notes: "Mountain town stop for slower days.",
    },
  ],
};

function App() {
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [selectedDay, setSelectedDay] = useState<DailyPlan | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);

  const handlePlan = async (input: PlannerInput) => {
    setIsPlanning(true);
    setErrorMessage(null);

    try {
      const result = await planRoadTrip(input);
      setPlan(result);
      setSelectedDay(result.dailyPlans[0] ?? null);
    } catch (error) {
      setPlan(null);
      setSelectedDay(null);
      setErrorMessage(error instanceof Error ? error.message : "Planning failed.");
    } finally {
      setIsPlanning(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="hero-backdrop" />
      <header className="hero">
        <p className="eyebrow">Holiday Planner</p>
        <h1>Road-trip planning for static GitHub Pages</h1>
        <p className="hero-copy">
          Optimise the destination mix, expand the route into day-sized driving chunks, surface nearby points of
          interest, and prioritise free-camp style overnight options when the stop is not one of your planned
          destinations.
        </p>
      </header>

      <main className="app-layout">
        <section className="left-column">
          <PlannerForm initialValue={defaultPlannerInput} isPlanning={isPlanning} onPlan={handlePlan} />
          <aside className="info-card">
            <p className="eyebrow">How it works</p>
            <ul>
              <li>The app geocodes locations with OpenStreetMap Nominatim.</li>
              <li>Route geometry and drive times come from OSRM.</li>
              <li>Overnight campsite suggestions and POIs come from Overpass map data.</li>
              <li>Up to eight destinations use an exact search. Larger sets switch to a greedy fallback.</li>
            </ul>
          </aside>
        </section>

        <section className="right-column">
          {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
          <TripMap plan={plan} selectedDay={selectedDay} />
          <ItineraryPanel
            onSelectDay={setSelectedDay}
            plan={plan}
            selectedDayNumber={selectedDay?.dayNumber ?? null}
          />
        </section>
      </main>
    </div>
  );
}

export default App;
