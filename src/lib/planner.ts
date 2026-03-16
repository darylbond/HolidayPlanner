import { distanceAlongPathKm, slicePolylineByKm, haversineKm } from "./geo";
import { findNearbyCampsites, findPointsOfInterestAlongPath, geocodePlace, routeBetween } from "./osm";
import type { DailyPlan, PlannerInput, ResolvedWaypoint, RouteSection, TripPlan } from "../types";

const MAX_EXACT_DESTINATIONS = 8;
const ROAD_DISTANCE_MULTIPLIER = 1.22;
const AVERAGE_ROAD_SPEED_KMH = 75;

type SearchResult = {
  ordered: ResolvedWaypoint[];
  score: number;
  finishDriveHours: number;
  finishDays: number;
  mode: "exact" | "greedy";
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

const resolveInputWaypoints = async (input: PlannerInput) => {
  const startCoordinates = await geocodePlace(input.start);
  const endCoordinates = await geocodePlace(input.end);

  const destinations = await Promise.all(
    input.destinations
      .filter((destination) => destination.name.trim().length > 0)
      .map(async (destination) => ({
        id: destination.id,
        name: destination.name.trim(),
        kind: "destination" as const,
        coordinates: await geocodePlace(destination.name.trim()),
        stayDays: Math.max(0, Math.round(destination.stayDays)),
        desirability: Math.max(1, Math.round(destination.desirability)),
        notes: destination.notes?.trim(),
      })),
  );

  const start: ResolvedWaypoint = {
    id: `start-${makeWaypointId(input.start)}`,
    name: input.start.trim(),
    kind: "start",
    coordinates: startCoordinates,
    stayDays: 0,
    desirability: 0,
  };

  const end: ResolvedWaypoint = {
    id: `end-${makeWaypointId(input.end)}`,
    name: input.end.trim(),
    kind: "end",
    coordinates: endCoordinates,
    stayDays: 0,
    desirability: 0,
  };

  return { start, end, destinations };
};

const searchExactRoute = (
  start: ResolvedWaypoint,
  end: ResolvedWaypoint,
  destinations: ResolvedWaypoint[],
  holidayDays: number,
  maxDriveHoursPerDay: number,
): SearchResult => {
  let best: SearchResult = {
    ordered: [],
    score: -1,
    finishDriveHours: Number.POSITIVE_INFINITY,
    finishDays: Number.POSITIVE_INFINITY,
    mode: "exact",
  };

  const visit = (
    current: ResolvedWaypoint,
    remaining: ResolvedWaypoint[],
    ordered: ResolvedWaypoint[],
    score: number,
    daysUsed: number,
    driveHoursUsed: number,
  ) => {
    const returnDriveHours = estimateDriveHours(current, end);
    const finishDays = daysUsed + Math.ceil(returnDriveHours / maxDriveHoursPerDay);

    if (finishDays <= holidayDays) {
      const finishDriveHours = driveHoursUsed + returnDriveHours;

      const shouldReplaceCurrentBest =
        score > best.score ||
        (score === best.score && ordered.length > best.ordered.length) ||
        (score === best.score && ordered.length === best.ordered.length && finishDriveHours < best.finishDriveHours);

      if (shouldReplaceCurrentBest) {
        best = {
          ordered: [...ordered],
          score,
          finishDriveHours,
          finishDays,
          mode: "exact",
        };
      }
    }

    remaining.forEach((candidate, candidateIndex) => {
      const legDriveHours = estimateDriveHours(current, candidate);
      const nextDaysUsed = daysUsed + Math.ceil(legDriveHours / maxDriveHoursPerDay) + candidate.stayDays;
      const returnAfterCandidate = estimateDriveHours(candidate, end);

      if (nextDaysUsed + Math.ceil(returnAfterCandidate / maxDriveHoursPerDay) > holidayDays) {
        return;
      }

      const remainingWithoutCandidate = [...remaining.slice(0, candidateIndex), ...remaining.slice(candidateIndex + 1)];

      visit(
        candidate,
        remainingWithoutCandidate,
        [...ordered, candidate],
        score + candidate.desirability,
        nextDaysUsed,
        driveHoursUsed + legDriveHours,
      );
    });
  };

  visit(start, destinations, [], 0, 0, 0);
  return best;
};

const searchGreedyRoute = (
  start: ResolvedWaypoint,
  end: ResolvedWaypoint,
  destinations: ResolvedWaypoint[],
  holidayDays: number,
  maxDriveHoursPerDay: number,
): SearchResult => {
  const remaining = [...destinations];
  const ordered: ResolvedWaypoint[] = [];
  let score = 0;
  let daysUsed = 0;
  let driveHoursUsed = 0;
  let current = start;

  while (remaining.length > 0) {
    let bestCandidateIndex = -1;
    let bestCandidateValue = Number.NEGATIVE_INFINITY;

    remaining.forEach((candidate, index) => {
      const legDriveHours = estimateDriveHours(current, candidate);
      const projectedDays = daysUsed + Math.ceil(legDriveHours / maxDriveHoursPerDay) + candidate.stayDays;
      const returnDays = Math.ceil(estimateDriveHours(candidate, end) / maxDriveHoursPerDay);

      if (projectedDays + returnDays > holidayDays) {
        return;
      }

      const desirabilityPerDay = candidate.desirability / Math.max(1, candidate.stayDays + legDriveHours);
      const value = desirabilityPerDay * 10 - estimateDriveHours(candidate, end) * 0.25;

      if (value > bestCandidateValue) {
        bestCandidateValue = value;
        bestCandidateIndex = index;
      }
    });

    if (bestCandidateIndex === -1) {
      break;
    }

    const candidate = remaining.splice(bestCandidateIndex, 1)[0];
    const legDriveHours = estimateDriveHours(current, candidate);

    ordered.push(candidate);
    score += candidate.desirability;
    daysUsed += Math.ceil(legDriveHours / maxDriveHoursPerDay) + candidate.stayDays;
    driveHoursUsed += legDriveHours;
    current = candidate;
  }

  const finalReturnDriveHours = estimateDriveHours(current, end);

  return {
    ordered,
    score,
    finishDriveHours: driveHoursUsed + finalReturnDriveHours,
    finishDays: daysUsed + Math.ceil(finalReturnDriveHours / maxDriveHoursPerDay),
    mode: "greedy",
  };
};

const chooseRoute = (
  start: ResolvedWaypoint,
  end: ResolvedWaypoint,
  destinations: ResolvedWaypoint[],
  holidayDays: number,
  maxDriveHoursPerDay: number,
) => {
  const result =
    destinations.length <= MAX_EXACT_DESTINATIONS
      ? searchExactRoute(start, end, destinations, holidayDays, maxDriveHoursPerDay)
      : searchGreedyRoute(start, end, destinations, holidayDays, maxDriveHoursPerDay);

  if (result.finishDays > holidayDays) {
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

const buildDailyPlans = async (
  allWaypoints: ResolvedWaypoint[],
  routeSections: RouteSection[],
  input: PlannerInput,
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
      const notes = [] as string[];

      if (!finalChunk) {
        notes.push("The stop lands near your daily drive target and searches nearby camping first.");
      }

      if (finalChunk && targetWaypoint.kind === "destination" && targetWaypoint.stayDays > 0) {
        notes.push(`Arrival day for ${targetWaypoint.name}. ${targetWaypoint.stayDays} stay day(s) are allocated next.`);
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
        refuelStops: calculateRefuelStops(
          chunk.distanceKm,
          input.fuelConsumptionLitresPer100Km,
          input.fuelTankLitres,
        ),
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

    enrichedDailyPlans.push({
      ...dailyPlan,
      campsites,
      pois,
    });
  }

  return enrichedDailyPlans;
};

export const planRoadTrip = async (input: PlannerInput): Promise<TripPlan> => {
  const { start, end, destinations } = await resolveInputWaypoints(input);
  const selectedRoute = chooseRoute(start, end, destinations, input.holidayDays, input.maxDriveHoursPerDay);
  const allWaypoints = [start, ...selectedRoute.ordered, end];
  const routeSections = await Promise.all(
    allWaypoints.slice(0, -1).map((waypoint, index) => routeBetween(waypoint, allWaypoints[index + 1])),
  );
  const dailyPlans = await buildDailyPlans(allWaypoints, routeSections, input);
  const totalDistanceKm = routeSections.reduce((sum, section) => sum + section.distanceKm, 0);
  const totalDriveHours = routeSections.reduce((sum, section) => sum + section.durationHours, 0);
  const totalStayDays = selectedRoute.ordered.reduce((sum, waypoint) => sum + waypoint.stayDays, 0);

  return {
    selectedDestinations: selectedRoute.ordered,
    allWaypoints,
    routeSections,
    dailyPlans,
    totalDriveHours: roundToOneDecimal(totalDriveHours),
    totalDistanceKm: roundToOneDecimal(totalDistanceKm),
    totalStayDays,
    totalHolidayDays: dailyPlans.length,
    totalFuelLitres: roundToOneDecimal((totalDistanceKm * input.fuelConsumptionLitresPer100Km) / 100),
    optimizationMode: selectedRoute.mode,
  };
};
