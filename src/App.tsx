import { useEffect, useRef, useState } from "react";
import { ActivityLogPanel } from "./components/ActivityLogPanel";
import { PlannerForm } from "./components/PlannerForm";
import { ItineraryPanel } from "./components/ItineraryPanel";
import { LocationConfirmDialog } from "./components/LocationConfirmDialog";
import { TripMap } from "./components/TripMap";
import { reverseGeocodePlace, searchPlaceCandidates } from "./lib/osm";
import { planRoadTrip } from "./lib/planner";
import type {
  DailyPlan,
  DestinationInput,
  LocationCandidate,
  LocationConfirmTarget,
  PlannerInput,
  PlannerLocationInput,
  PlannerLogEntry,
  PlanningPreview,
  PlanningStage,
  TripPlan,
} from "./types";

const defaultPlannerInput: PlannerInput = {
  start: {
    name: "Sydney NSW",
  },
  end: {
    name: "Melbourne VIC",
  },
  holidayDays: 12,
  maxDriveHoursPerDay: 5.5,
  fuelConsumptionLitresPer100Km: 9.2,
  fuelTankLitres: 75,
  destinations: [
    {
      id: crypto.randomUUID(),
      location: {
        name: "Canberra ACT",
      },
      stayDays: 1,
      desirability: 6,
      notes: "Short city stop with galleries and lake walks.",
    },
    {
      id: crypto.randomUUID(),
      location: {
        name: "Jervis Bay NSW",
      },
      stayDays: 2,
      desirability: 9,
      notes: "Beach time and national park walks.",
    },
    {
      id: crypto.randomUUID(),
      location: {
        name: "Lakes Entrance VIC",
      },
      stayDays: 2,
      desirability: 8,
      notes: "Coastal rest days and easy base for Gippsland.",
    },
    {
      id: crypto.randomUUID(),
      location: {
        name: "Wilsons Promontory VIC",
      },
      stayDays: 2,
      desirability: 10,
      notes: "High-priority nature stop.",
    },
    {
      id: crypto.randomUUID(),
      location: {
        name: "Bright VIC",
      },
      stayDays: 2,
      desirability: 7,
      notes: "Mountain town stop for slower days.",
    },
    {
      id: crypto.randomUUID(),
      location: {
        name: "Eden NSW",
      },
      stayDays: 1,
      desirability: 7,
      notes: "Harbour stop with easy coastline access.",
    },
    {
      id: crypto.randomUUID(),
      location: {
        name: "Phillip Island VIC",
      },
      stayDays: 1,
      desirability: 8,
      notes: "Penguins and a short coastal break before Melbourne.",
    },
    {
      id: crypto.randomUUID(),
      location: {
        name: "Albury NSW",
      },
      stayDays: 1,
      desirability: 5,
      notes: "Low-friction inland stop if the coastal route gets too long.",
    },
  ],
};

type LocationDialogState = LocationConfirmTarget & {
  candidates: LocationCandidate[];
  errorMessage: string | null;
  isLoading: boolean;
};

const createBlankDestination = (location?: PlannerLocationInput): DestinationInput => ({
  id: crypto.randomUUID(),
  location: location ?? {
    name: "",
  },
  stayDays: 1,
  desirability: 5,
  notes: "",
});

const buildPreviewFromPlan = (tripPlan: TripPlan): PlanningPreview => ({
  selectedDestinations: tripPlan.selectedDestinations,
  allWaypoints: tripPlan.allWaypoints,
  routeSections: tripPlan.routeSections,
  optimizationMode: tripPlan.optimizationMode,
});

const isReadyToPlan = (input: PlannerInput) =>
  input.start.name.trim().length > 0 &&
  input.end.name.trim().length > 0 &&
  input.holidayDays > 0 &&
  input.maxDriveHoursPerDay > 0 &&
  input.fuelConsumptionLitresPer100Km > 0 &&
  input.fuelTankLitres > 0;

const fallbackPinnedName = (coordinates: PlannerLocationInput["coordinates"]) =>
  coordinates ? `Pinned ${coordinates.lat.toFixed(4)}, ${coordinates.lng.toFixed(4)}` : "Pinned location";

function App() {
  const [plannerInput, setPlannerInput] = useState<PlannerInput>(defaultPlannerInput);
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [preview, setPreview] = useState<PlanningPreview | null>(null);
  const [selectedDay, setSelectedDay] = useState<DailyPlan | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [activityLog, setActivityLog] = useState<PlannerLogEntry[]>([]);
  const [locationDialogState, setLocationDialogState] = useState<LocationDialogState | null>(null);
  const activePlanningRequest = useRef(0);

  const appendLog = (stage: PlanningStage, message: string) => {
    setActivityLog((current) => {
      if (current[current.length - 1]?.message === message) {
        return current;
      }

      const nextEntry: PlannerLogEntry = {
        id: crypto.randomUUID(),
        stage,
        message,
        timestamp: new Date().toLocaleTimeString(),
      };

      return [...current.slice(-59), nextEntry];
    });
  };

  const runPlanning = async (input: PlannerInput, reason: "auto" | "manual") => {
    if (!isReadyToPlan(input)) {
      return;
    }

    const requestId = activePlanningRequest.current + 1;
    activePlanningRequest.current = requestId;
    setIsPlanning(true);
    setErrorMessage(null);
    appendLog("resolve", reason === "manual" ? "Manual refresh started." : "Refreshing the live route preview.");

    try {
      const result = await planRoadTrip(input, {
        onProgress: (update) => {
          if (requestId !== activePlanningRequest.current) {
            return;
          }

          appendLog(update.stage, update.message);

          if (update.preview) {
            setPreview(update.preview);
          }
        },
      });

      if (requestId !== activePlanningRequest.current) {
        return;
      }

      setPlan(result);
      setPreview(buildPreviewFromPlan(result));
      setSelectedDay((current) => result.dailyPlans.find((day) => day.dayNumber === current?.dayNumber) ?? result.dailyPlans[0] ?? null);
    } catch (error) {
      if (requestId !== activePlanningRequest.current) {
        return;
      }

      setErrorMessage(error instanceof Error ? error.message : "Planning failed.");
      appendLog("complete", error instanceof Error ? `Planning failed: ${error.message}` : "Planning failed.");
    } finally {
      if (requestId === activePlanningRequest.current) {
        setIsPlanning(false);
      }
    }
  };

  useEffect(() => {
    if (!isReadyToPlan(plannerInput)) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void runPlanning(plannerInput, "auto");
    }, 700);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [plannerInput]);

  const handlePlanNow = async () => {
    await runPlanning(plannerInput, "manual");
  };

  const handleLocationDialogRequest = async (target: LocationConfirmTarget) => {
    if (!target.query.trim()) {
      setErrorMessage(`Enter a ${target.label.toLowerCase()} before confirming it on the map.`);
      return;
    }

    setLocationDialogState({
      ...target,
      candidates: [],
      errorMessage: null,
      isLoading: true,
    });
    appendLog("resolve", `Searching map matches for ${target.label.toLowerCase()}.`);

    try {
      const candidates = await searchPlaceCandidates(target.query, 5);

      if (candidates.length === 0) {
        throw new Error(`No map matches found for ${target.query}.`);
      }

      setLocationDialogState({
        ...target,
        candidates,
        errorMessage: null,
        isLoading: false,
      });
      appendLog("resolve", `Loaded ${candidates.length} confirmation matches for ${target.label.toLowerCase()}.`);
    } catch (error) {
      const nextError = error instanceof Error ? error.message : "Location confirmation failed.";

      setLocationDialogState({
        ...target,
        candidates: [],
        errorMessage: nextError,
        isLoading: false,
      });
      appendLog("resolve", nextError);
    }
  };

  const applyConfirmedLocation = (target: LocationConfirmTarget, candidate: LocationCandidate) => {
    setPlannerInput((current) => {
      if (target.kind === "start") {
        return {
          ...current,
          start: {
            name: candidate.name,
            coordinates: candidate.coordinates,
          },
        };
      }

      if (target.kind === "end") {
        return {
          ...current,
          end: {
            name: candidate.name,
            coordinates: candidate.coordinates,
          },
        };
      }

      return {
        ...current,
        destinations: current.destinations.map((destination) =>
          destination.id === target.destinationId
            ? {
                ...destination,
                location: {
                  name: candidate.name,
                  coordinates: candidate.coordinates,
                },
              }
            : destination,
        ),
      };
    });

    appendLog("resolve", `Confirmed ${target.label.toLowerCase()} on the map.`);
    setLocationDialogState(null);
  };

  const resolveDroppedLocation = async (coordinates: LocationCandidate["coordinates"]) => {
    try {
      return await reverseGeocodePlace(coordinates);
    } catch {
      return {
        name: fallbackPinnedName(coordinates),
        coordinates,
      };
    }
  };

  const handleMapAction = async (kind: "start" | "end" | "destination", coordinates: LocationCandidate["coordinates"]) => {
    const location = await resolveDroppedLocation(coordinates);

    if (kind === "start") {
      setPlannerInput((current) => ({
        ...current,
        start: {
          name: location.name,
          coordinates: location.coordinates,
        },
      }));
      appendLog("resolve", `Updated the start point from the map.`);
      return;
    }

    if (kind === "end") {
      setPlannerInput((current) => ({
        ...current,
        end: {
          name: location.name,
          coordinates: location.coordinates,
        },
      }));
      appendLog("resolve", `Updated the end point from the map.`);
      return;
    }

    setPlannerInput((current) => ({
      ...current,
      destinations: [...current.destinations, createBlankDestination(location)],
    }));
    appendLog("resolve", `Added a destination from the map.`);
  };

  const handleRemoveDestination = (destinationId: string) => {
    setPlannerInput((current) => ({
      ...current,
      destinations: current.destinations.filter((destination) => destination.id !== destinationId),
    }));
    appendLog("optimize", "Removed a candidate destination.");
  };

  return (
    <div className="page-shell">
      <div className="hero-backdrop" />
      <header className="hero">
        <p className="eyebrow">Holiday Planner</p>
        <h1>Road-trip planning for static GitHub Pages</h1>
        <p className="hero-copy">
          Live-plan the trip as you edit it, confirm places on a map before committing them, and keep a running log of
          routing, stop selection, and campsite enrichment while the route is built.
        </p>
      </header>

      <main className="app-layout">
        <section className="left-column">
          <PlannerForm
            isPlanning={isPlanning}
            onAddDestination={() =>
              setPlannerInput((current) => ({
                ...current,
                destinations: [...current.destinations, createBlankDestination()],
              }))
            }
            onChange={setPlannerInput}
            onOpenLocationConfirm={handleLocationDialogRequest}
            onPlanNow={handlePlanNow}
            onRemoveDestination={handleRemoveDestination}
            value={plannerInput}
          />
          <aside className="info-card">
            <p className="eyebrow">How it works</p>
            <ul>
              <li>The app geocodes locations with OpenStreetMap Nominatim.</li>
              <li>Route geometry and drive times come from OSRM.</li>
              <li>Overnight campsite suggestions and POIs come from Overpass map data.</li>
              <li>The planner now uses a fast insertion heuristic so larger destination sets stay responsive.</li>
            </ul>
          </aside>
        </section>

        <section className="right-column">
          {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
          <TripMap
            isPlanning={isPlanning}
            onMapAction={handleMapAction}
            onRemoveDestination={handleRemoveDestination}
            plan={plan}
            plannerInput={plannerInput}
            preview={preview}
            selectedDay={selectedDay}
          />
          <ActivityLogPanel isPlanning={isPlanning} logEntries={activityLog} />
          <ItineraryPanel
            onSelectDay={setSelectedDay}
            plan={plan}
            selectedDayNumber={selectedDay?.dayNumber ?? null}
          />
        </section>
      </main>

      <LocationConfirmDialog
        candidates={locationDialogState?.candidates ?? []}
        errorMessage={locationDialogState?.errorMessage ?? null}
        isLoading={locationDialogState?.isLoading ?? false}
        isOpen={locationDialogState !== null}
        query={locationDialogState?.query ?? ""}
        targetLabel={locationDialogState?.label ?? "location"}
        onCancel={() => setLocationDialogState(null)}
        onConfirm={(candidate) => {
          if (locationDialogState) {
            applyConfirmedLocation(locationDialogState, candidate);
          }
        }}
      />
    </div>
  );
}

export default App;
