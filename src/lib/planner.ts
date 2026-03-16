import { distanceAlongPathKm, haversineKm, pointAlongPathKm, slicePolylineByKm } from "./geo";
import { findNearbyCampsites, findPointsOfInterestAlongPath, geocodePlace, routeBetween } from "./osm";
import type {
  DailyPlan,
  FuelStop,
  PlannerInput,
  PlanningPreview,
  PlanningProgressUpdate,
  PlannerLocationInput,
  ResolvedWaypoint,
  RouteSection,
  TripPlan,
} from "../types";

const ROAD_DISTANCE_MULTIPLIER = 1.22;
const AVERAGE_ROAD_SPEED_KMH = 75;

type SearchResult = {
  ordered: ResolvedWaypoint[];
  score: number;
  estimatedDriveHours: number;
  estimatedDriveDays: number;
  mode: "fast";
};

type RouteChunk = {
  geometry: RouteSection["geometry"];
  distanceKm: number;
  durationHours: number;
};

const roundToOneDecimal = (value: number) => Math.round(value * 10) / 10;

const estimateDriveHours = (from: ResolvedWaypoint, to: ResolvedWaypoint) => {
  const directDistanceKm = haversineKm(from.coordinates, to.coordinates);
  return (directDistanceKm * ROAD_DISTANCE_MULTIPLIER) / AVERAGE_ROAD_SPEED_KMH;
};

const makeWaypointId = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "stop";

const estimateDriveDays = (hours: number, maxDriveHoursPerDay: number) => Math.max(1, Math.ceil(hours / maxDriveHoursPerDay));

const makePreview = (
  selectedDestinations: ResolvedWaypoint[],
  allWaypoints: ResolvedWaypoint[],
  routeSections: RouteSection[],
): PlanningPreview => ({
  selectedDestinations,
  allWaypoints,
  routeSections,
  optimizationMode: "fast",
});

type PlannerOptions = {
  onProgress?: (update: PlanningProgressUpdate) => void;
};

const emitProgress = (options: PlannerOptions | undefined, update: PlanningProgressUpdate) => {
  options?.onProgress?.(update);
};

const resolveLocationCoordinates = async (location: PlannerLocationInput) => {
  if (location.coordinates) {
    return location.coordinates;
  }

  return geocodePlace(location.name.trim());
};

const resolveInputWaypoints = async (input: PlannerInput, options?: PlannerOptions) => {
  emitProgress(options, {
    stage: "resolve",
    message: `Resolving ${input.destinations.filter((destination) => destination.location.name.trim().length > 0).length + 2} locations.`,
  });

  const [startCoordinates, endCoordinates] = await Promise.all([
    resolveLocationCoordinates(input.start),
    resolveLocationCoordinates(input.end),
  ]);

  const destinations = await Promise.all(
    input.destinations
      .filter((destination) => destination.location.name.trim().length > 0)
      .map(async (destination) => ({
        id: destination.id,
        name: destination.location.name.trim(),
        kind: "destination" as const,
        coordinates: await resolveLocationCoordinates(destination.location),
        stayDays: Math.max(0, Math.round(destination.stayDays)),
        desirability: Math.max(1, Math.round(destination.desirability)),
        notes: destination.notes?.trim(),
      })),
  );

  const start: ResolvedWaypoint = {
    id: `start-${makeWaypointId(input.start.name)}`,
    name: input.start.name.trim(),
    kind: "start",
    coordinates: startCoordinates,
    stayDays: 0,
    desirability: 0,
  };

  const end: ResolvedWaypoint = {
    id: `end-${makeWaypointId(input.end.name)}`,
    name: input.end.name.trim(),
    kind: "end",
    coordinates: endCoordinates,
    stayDays: 0,
    desirability: 0,
  };

  emitProgress(options, {
    stage: "resolve",
    message: `Resolved start, end, and ${destinations.length} candidate destinations.`,
  });

  return { start, end, destinations };
};

const searchFastInsertionRoute = (
  start: ResolvedWaypoint,
  end: ResolvedWaypoint,
  destinations: ResolvedWaypoint[],
  holidayDays: number,
  maxDriveHoursPerDay: number,
): SearchResult => {
  const route = [start, end];
  const remaining = [...destinations];
  let score = 0;
  let totalDriveHours = estimateDriveHours(start, end);
  let totalDriveDays = estimateDriveDays(totalDriveHours, maxDriveHoursPerDay);
  let totalStayDays = 0;

  while (remaining.length > 0) {
    let bestCandidateIndex = -1;
    let bestInsertionIndex = -1;
    let bestValue = Number.NEGATIVE_INFINITY;
    let bestDriveHoursDelta = 0;
    let bestDriveDaysDelta = 0;

    remaining.forEach((candidate, candidateIndex) => {
      for (let insertionIndex = 0; insertionIndex < route.length - 1; insertionIndex += 1) {
        const previousStop = route[insertionIndex];
        const nextStop = route[insertionIndex + 1];
        const previousHours = estimateDriveHours(previousStop, nextStop);
        const beforeHours = estimateDriveHours(previousStop, candidate);
        const afterHours = estimateDriveHours(candidate, nextStop);
        const driveHoursDelta = beforeHours + afterHours - previousHours;
        const driveDaysDelta =
          estimateDriveDays(beforeHours, maxDriveHoursPerDay) +
          estimateDriveDays(afterHours, maxDriveHoursPerDay) -
          estimateDriveDays(previousHours, maxDriveHoursPerDay);
        const projectedTotalDays = totalStayDays + totalDriveDays + candidate.stayDays + driveDaysDelta;

        if (projectedTotalDays > holidayDays) {
          continue;
        }

        const value =
          candidate.desirability * 1.5 -
          driveHoursDelta * 1.15 -
          candidate.stayDays * 0.45 +
          candidate.desirability / Math.max(1, candidate.stayDays + driveHoursDelta + 0.5);

        if (value > bestValue) {
          bestValue = value;
          bestCandidateIndex = candidateIndex;
          bestInsertionIndex = insertionIndex;
          bestDriveHoursDelta = driveHoursDelta;
          bestDriveDaysDelta = driveDaysDelta;
        }
      }
    });

    if (bestCandidateIndex === -1 || bestInsertionIndex === -1) {
      break;
    }

    const candidate = remaining.splice(bestCandidateIndex, 1)[0];
    route.splice(bestInsertionIndex + 1, 0, candidate);
    score += candidate.desirability;
    totalDriveHours += bestDriveHoursDelta;
    totalDriveDays += bestDriveDaysDelta;
    totalStayDays += candidate.stayDays;
  }

  return {
    ordered: route.slice(1, -1),
    score,
    estimatedDriveHours: totalDriveHours,
    estimatedDriveDays: totalDriveDays,
    mode: "fast",
  };
};

const chooseRoute = (
  start: ResolvedWaypoint,
  end: ResolvedWaypoint,
  destinations: ResolvedWaypoint[],
  holidayDays: number,
  maxDriveHoursPerDay: number,
) => {
  const directRouteDays = estimateDriveDays(estimateDriveHours(start, end), maxDriveHoursPerDay);

  if (directRouteDays > holidayDays) {
    throw new Error("The direct route does not fit within the holiday length and daily driving limit.");
  }

  const result = searchFastInsertionRoute(start, end, destinations, holidayDays, maxDriveHoursPerDay);

  if (result.estimatedDriveDays + result.ordered.reduce((sum, waypoint) => sum + waypoint.stayDays, 0) > holidayDays) {
    throw new Error("The direct route does not fit within the holiday length and daily driving limit.");
  }

  return result;
};

const splitRouteSection = (section: RouteSection, maxDriveHoursPerDay: number): RouteChunk[] => {
  const chunkCount = Math.max(1, Math.ceil(section.durationHours / maxDriveHoursPerDay));

  if (chunkCount === 1) {
    return [
      {
        geometry: section.geometry,
        distanceKm: section.distanceKm,
        durationHours: section.durationHours,
      },
    ];
  }

  const chunks: RouteChunk[] = [];
  let elapsedHours = 0;

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const nextElapsedHours = Math.min(section.durationHours, elapsedHours + maxDriveHoursPerDay);
    const startRatio = section.durationHours === 0 ? 0 : elapsedHours / section.durationHours;
    const endRatio = section.durationHours === 0 ? 1 : nextElapsedHours / section.durationHours;
    const startKm = section.distanceKm * startRatio;
    const endKm = section.distanceKm * endRatio;
    const geometry = slicePolylineByKm(section.geometry, startKm, endKm);
    const distanceKm = distanceAlongPathKm(geometry);
    const durationHours =
      section.durationHours === 0 || section.distanceKm === 0
        ? 0
        : section.durationHours * ((endKm - startKm) / section.distanceKm);

    chunks.push({
      geometry,
      distanceKm,
      durationHours,
    });

    elapsedHours = nextElapsedHours;
  }

  return chunks;
};

const calculateRefuelStops = (distanceKm: number, fuelConsumptionLitresPer100Km: number, fuelTankLitres: number) => {
  const tankRangeKm = (fuelTankLitres / fuelConsumptionLitresPer100Km) * 100;

  if (!Number.isFinite(tankRangeKm) || tankRangeKm <= 0) {
    return 0;
  }

  return Math.max(0, Math.ceil(distanceKm / tankRangeKm) - 1);
};

const buildFuelStops = (
  geometry: RouteSection["geometry"],
  distanceKm: number,
  durationHours: number,
  fuelConsumptionLitresPer100Km: number,
  fuelTankLitres: number,
): FuelStop[] => {
  const tankRangeKm = (fuelTankLitres / fuelConsumptionLitresPer100Km) * 100;

  if (!Number.isFinite(tankRangeKm) || tankRangeKm <= 0 || distanceKm <= tankRangeKm * 0.82) {
    return [];
  }

  const usableRangeKm = tankRangeKm * 0.82;
  const stopCount = Math.max(1, Math.ceil(distanceKm / usableRangeKm) - 1);
  const balancedSegmentKm = distanceKm / (stopCount + 1);

  return Array.from({ length: stopCount }, (_, index) => {
    const distanceFromDayStartKm = balancedSegmentKm * (index + 1);
    const coordinates = pointAlongPathKm(geometry, distanceFromDayStartKm) ?? geometry[geometry.length - 1];

    return {
      id: `fuel-stop-${index + 1}-${Math.round(distanceFromDayStartKm * 10)}`,
      name: `Fuel stop ${index + 1}`,
      coordinates,
      distanceFromDayStartKm: roundToOneDecimal(distanceFromDayStartKm),
      driveHoursFromDayStart:
        distanceKm === 0 ? 0 : roundToOneDecimal(durationHours * (distanceFromDayStartKm / distanceKm)),
    };
  });
};

const buildDailyPlans = async (
  allWaypoints: ResolvedWaypoint[],
  routeSections: RouteSection[],
  input: PlannerInput,
  options?: PlannerOptions,
) => {
  const rawDailyPlans: DailyPlan[] = [];
  let dayNumber = 1;

  routeSections.forEach((section, sectionIndex) => {
    const targetWaypoint = allWaypoints[sectionIndex + 1];
    const chunks = splitRouteSection(section, input.maxDriveHoursPerDay);
    let currentFromName = section.from.name;

    chunks.forEach((chunk, chunkIndex) => {
      const finalChunk = chunkIndex === chunks.length - 1;
      const finalPoint = chunk.geometry[chunk.geometry.length - 1] ?? section.to.coordinates;
      let overnightStop: ResolvedWaypoint | undefined;
      let dayDestination: ResolvedWaypoint;

      if (finalChunk) {
        dayDestination = targetWaypoint;
      } else {
        overnightStop = {
          id: `overnight-${section.id}-${chunkIndex + 1}`,
          name: `Overnight stop ${sectionIndex + 1}.${chunkIndex + 1}`,
          kind: "overnight",
          coordinates: finalPoint,
          stayDays: 0,
          desirability: 0,
        };
        dayDestination = overnightStop;
      }

      const fuelUsedLitres = (chunk.distanceKm * input.fuelConsumptionLitresPer100Km) / 100;
      const fuelStops = buildFuelStops(
        chunk.geometry,
        chunk.distanceKm,
        chunk.durationHours,
        input.fuelConsumptionLitresPer100Km,
        input.fuelTankLitres,
      );
      const notes = [] as string[];

      if (!finalChunk) {
        notes.push("The stop lands near your daily drive target and searches nearby camping first.");
      }

      if (finalChunk && targetWaypoint.kind === "destination" && targetWaypoint.stayDays > 0) {
        notes.push(`Arrival day for ${targetWaypoint.name}. ${targetWaypoint.stayDays} stay day(s) are allocated next.`);
      }

      if (fuelStops.length > 0) {
        notes.push(
          `Balanced ${fuelStops.length} fuel stop${fuelStops.length === 1 ? "" : "s"} across the drive day to keep each leg within tank range.`,
        );
      }

      rawDailyPlans.push({
        dayNumber,
        title: `Day ${dayNumber}: ${currentFromName} to ${dayDestination.name}`,
        kind: "drive",
        fromName: currentFromName,
        toName: dayDestination.name,
        geometry: chunk.geometry,
        driveHours: roundToOneDecimal(chunk.durationHours),
        distanceKm: roundToOneDecimal(chunk.distanceKm),
        fuelUsedLitres: roundToOneDecimal(fuelUsedLitres),
        refuelStops: fuelStops.length,
        fuelStops,
        overnightStop,
        destinationStop: finalChunk ? targetWaypoint : undefined,
        campsites: [],
        pois: [],
        notes,
      });

      dayNumber += 1;
      currentFromName = dayDestination.name;
    });

    if (targetWaypoint.kind === "destination" && targetWaypoint.stayDays > 0) {
      for (let stayIndex = 0; stayIndex < targetWaypoint.stayDays; stayIndex += 1) {
        rawDailyPlans.push({
          dayNumber,
          title: `Day ${dayNumber}: Explore ${targetWaypoint.name}`,
          kind: "stay",
          fromName: targetWaypoint.name,
          toName: targetWaypoint.name,
          geometry: [targetWaypoint.coordinates],
          driveHours: 0,
          distanceKm: 0,
          fuelUsedLitres: 0,
          refuelStops: 0,
          fuelStops: [],
          destinationStop: targetWaypoint,
          campsites: [],
          pois: [],
          notes: [
            targetWaypoint.notes || `Allocated stay day ${stayIndex + 1} of ${targetWaypoint.stayDays} at ${targetWaypoint.name}.`,
          ],
        });

        dayNumber += 1;
      }
    }
  });

  const enrichedDailyPlans: DailyPlan[] = [];
  const driveDays = rawDailyPlans.filter((dailyPlan) => dailyPlan.kind === "drive");
  let enrichedDriveDayCount = 0;

  for (const dailyPlan of rawDailyPlans) {
    if (dailyPlan.kind === "stay") {
      enrichedDailyPlans.push(dailyPlan);
      continue;
    }

    let campsites = dailyPlan.campsites;
    let pois = dailyPlan.pois;

    try {
      if (dailyPlan.overnightStop) {
        campsites = await findNearbyCampsites(dailyPlan.overnightStop.coordinates);
      }

      pois = await findPointsOfInterestAlongPath(dailyPlan.geometry);
    } catch {
      dailyPlan.notes.push("Some live map enrichments were unavailable for this day. The route itself is still usable.");
    }

    enrichedDriveDayCount += 1;
    emitProgress(options, {
      stage: "enrich",
      message: `Added stay suggestions and POIs for ${enrichedDriveDayCount} of ${driveDays.length} drive days.`,
    });

    enrichedDailyPlans.push({
      ...dailyPlan,
      campsites,
      pois,
    });
  }

  return enrichedDailyPlans;
};

export const planRoadTrip = async (input: PlannerInput, options?: PlannerOptions): Promise<TripPlan> => {
  const { start, end, destinations } = await resolveInputWaypoints(input, options);
  const selectedRoute = chooseRoute(start, end, destinations, input.holidayDays, input.maxDriveHoursPerDay);
  const allWaypoints = [start, ...selectedRoute.ordered, end];

  emitProgress(options, {
    stage: "optimize",
    message: `Selected ${selectedRoute.ordered.length} destinations using the fast insertion optimizer.`,
    preview: makePreview(selectedRoute.ordered, allWaypoints, []),
  });

  const routeSections: Array<RouteSection | null> = new Array(Math.max(0, allWaypoints.length - 1)).fill(null);

  await Promise.all(
    allWaypoints.slice(0, -1).map(async (waypoint, index) => {
      const section = await routeBetween(waypoint, allWaypoints[index + 1]);
      routeSections[index] = section;

      emitProgress(options, {
        stage: "route",
        message: `Routed leg ${index + 1} of ${allWaypoints.length - 1}: ${waypoint.name} to ${allWaypoints[index + 1].name}.`,
        preview: makePreview(
          selectedRoute.ordered,
          allWaypoints,
          routeSections.filter((item): item is RouteSection => item !== null),
        ),
      });
    }),
  );

  const completedRouteSections = routeSections.filter((item): item is RouteSection => item !== null);
  const dailyPlans = await buildDailyPlans(allWaypoints, completedRouteSections, input, options);
  const totalDistanceKm = completedRouteSections.reduce((sum, section) => sum + section.distanceKm, 0);
  const totalDriveHours = completedRouteSections.reduce((sum, section) => sum + section.durationHours, 0);
  const totalStayDays = selectedRoute.ordered.reduce((sum, waypoint) => sum + waypoint.stayDays, 0);

  const result: TripPlan = {
    selectedDestinations: selectedRoute.ordered,
    allWaypoints,
    routeSections: completedRouteSections,
    dailyPlans,
    totalDriveHours: roundToOneDecimal(totalDriveHours),
    totalDistanceKm: roundToOneDecimal(totalDistanceKm),
    totalStayDays,
    totalHolidayDays: dailyPlans.length,
    totalFuelLitres: roundToOneDecimal((totalDistanceKm * input.fuelConsumptionLitresPer100Km) / 100),
    optimizationMode: selectedRoute.mode,
  };

  emitProgress(options, {
    stage: "complete",
    message: `Plan ready with ${dailyPlans.length} days across ${selectedRoute.ordered.length} destinations.`,
    preview: makePreview(selectedRoute.ordered, allWaypoints, completedRouteSections),
  });

  return result;
};
