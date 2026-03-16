import { dedupeCoordinates, distanceAlongPathKm, haversineKm, pointAlongPathKm, slicePolylineByKm } from "./geo";
import { findFuelStationsAlongPath, findNearbyCampsites, findPointsOfInterestAlongPath, geocodePlace, routeBetween, routeSequence } from "./osm";
import type {
  DailyPlan,
  FuelStationOption,
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
const FUEL_RANGE_BUFFER_RATIO = 0.82;

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
  startKm: number;
  endKm: number;
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

const mergeGeometries = (geometries: RouteSection["geometry"][]) =>
  dedupeCoordinates(
    geometries.flatMap((geometry, index) => {
      if (index === 0) {
        return geometry;
      }

      return geometry.slice(1);
    }),
  );

const makeFuelWaypoint = (station: FuelStationOption): ResolvedWaypoint => ({
  id: `fuel-${station.id}`,
  name: station.name,
  kind: "fuel",
  coordinates: station.coordinates,
  stayDays: 0,
  desirability: 0,
  notes: station.priceLabel,
});

const buildApproxFuelCandidateScore = (candidate: FuelStationOption, cheapestKnownPrice: number | null) => {
  const missingPricePenalty = cheapestKnownPrice === null ? 0 : 18;

  if (candidate.pricePerLitre === undefined) {
    return candidate.distanceFromRouteKm * 4 + missingPricePenalty;
  }

  const pricePenalty = cheapestKnownPrice === null ? 0 : Math.max(0, candidate.pricePerLitre - cheapestKnownPrice) * 180;
  return candidate.distanceFromRouteKm * 4 + pricePenalty;
};

const buildRoutedFuelCandidateScore = (candidate: FuelStationOption, detourDistanceKm: number, cheapestKnownPrice: number | null) => {
  const missingPricePenalty = cheapestKnownPrice === null ? 0 : 18;

  if (candidate.pricePerLitre === undefined) {
    return detourDistanceKm + missingPricePenalty;
  }

  const pricePenalty = cheapestKnownPrice === null ? 0 : Math.max(0, candidate.pricePerLitre - cheapestKnownPrice) * 180;
  return detourDistanceKm + pricePenalty;
};

const mapInOrder = async <Input, Output>(items: Input[], mapper: (item: Input, index: number) => Promise<Output>) => {
  const results: Output[] = [];

  for (const [index, item] of items.entries()) {
    results.push(await mapper(item, index));
  }

  return results;
};

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

  const startCoordinates = await resolveLocationCoordinates(input.start);
  const endCoordinates = await resolveLocationCoordinates(input.end);

  const destinations = await mapInOrder(
    input.destinations.filter((destination) => destination.location.name.trim().length > 0),
    async (destination) => ({
        id: destination.id,
        name: destination.location.name.trim(),
        kind: destination.stopType === "fuel" ? ("fuel" as const) : ("destination" as const),
        coordinates: await resolveLocationCoordinates(destination.location),
        stayDays: destination.stopType === "fuel" ? 0 : Math.max(0, Math.round(destination.stayDays)),
        desirability: Math.max(0, Math.round(destination.desirability)),
        notes: destination.notes?.trim(),
      }),
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
        startKm: 0,
        endKm: section.distanceKm,
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
      startKm,
      endKm,
    });

    elapsedHours = nextElapsedHours;
  }

  return chunks;
};

const chooseFuelStationForSection = async (
  currentOrigin: ResolvedWaypoint,
  finalDestination: ResolvedWaypoint,
  currentSection: RouteSection,
  distanceTravelledKm: number,
  usableDistanceKm: number,
) => {
  const targetPoint =
    pointAlongPathKm(currentSection.geometry, Math.max(0, Math.min(currentSection.distanceKm, usableDistanceKm))) ??
    currentSection.geometry[currentSection.geometry.length - 1] ??
    currentSection.to.coordinates;
  const candidates = await findFuelStationsAlongPath(currentSection.geometry, targetPoint);

  if (candidates.length === 0) {
    throw new Error(`No fuel station could be found near the route from ${currentOrigin.name} to ${finalDestination.name}.`);
  }

  const cheapestKnownPrice = candidates.reduce<number | null>((currentCheapest, candidate) => {
    if (candidate.pricePerLitre === undefined) {
      return currentCheapest;
    }

    return currentCheapest === null ? candidate.pricePerLitre : Math.min(currentCheapest, candidate.pricePerLitre);
  }, null);

  const shortlistedCandidates = [...candidates]
    .sort(
      (left, right) =>
        buildApproxFuelCandidateScore(left, cheapestKnownPrice) - buildApproxFuelCandidateScore(right, cheapestKnownPrice),
    )
    .slice(0, 4);

  const evaluatedCandidates = await mapInOrder(shortlistedCandidates, async (candidate) => {
    const fuelWaypoint = makeFuelWaypoint(candidate);
    const toFuelSection = await routeBetween(currentOrigin, fuelWaypoint);
    const remainingSection = await routeBetween(fuelWaypoint, finalDestination);
    const detourDistanceKm = toFuelSection.distanceKm + remainingSection.distanceKm - currentSection.distanceKm;

    return {
      candidate,
      fuelWaypoint,
      toFuelSection,
      remainingSection,
      detourDistanceKm,
      score: buildRoutedFuelCandidateScore(candidate, detourDistanceKm, cheapestKnownPrice),
    };
  });

  const reachableCandidates = evaluatedCandidates
    .filter((candidate) => candidate.toFuelSection.distanceKm <= usableDistanceKm + 1)
    .sort((left, right) => left.score - right.score);

  if (reachableCandidates.length === 0) {
    throw new Error(`Fuel stations near ${currentOrigin.name} require too much detour to stay within tank range.`);
  }

  const bestCandidate = reachableCandidates[0];

  return {
    fuelStop: {
      id: `fuel-stop-${bestCandidate.candidate.id}-${Math.round((distanceTravelledKm + bestCandidate.toFuelSection.distanceKm) * 10)}`,
      name: bestCandidate.candidate.name,
      coordinates: bestCandidate.candidate.coordinates,
      distanceFromSectionStartKm: roundToOneDecimal(distanceTravelledKm + bestCandidate.toFuelSection.distanceKm),
      distanceFromDayStartKm: 0,
      driveHoursFromDayStart: 0,
      priceLabel: bestCandidate.candidate.priceLabel,
      pricePerLitre: bestCandidate.candidate.pricePerLitre,
      osmUrl: bestCandidate.candidate.osmUrl,
      detourDistanceKm: roundToOneDecimal(Math.max(0, bestCandidate.detourDistanceKm)),
    },
    waypoint: bestCandidate.fuelWaypoint,
    toFuelSection: bestCandidate.toFuelSection,
    remainingSection: bestCandidate.remainingSection,
  };
};

const buildRoutedFuelSection = async (section: RouteSection, input: PlannerInput, options?: PlannerOptions): Promise<RouteSection> => {
  const litresPerKm = input.fuelConsumptionLitresPer100Km / 100;
  const reserveLitres = input.fuelTankLitres * (1 - FUEL_RANGE_BUFFER_RATIO);
  const usableDistanceKm = Math.max(0, (input.fuelTankLitres - reserveLitres) / litresPerKm);

  if (!Number.isFinite(usableDistanceKm) || usableDistanceKm <= 0 || section.distanceKm <= usableDistanceKm) {
    return {
      ...section,
      fuelStops: [],
    };
  }

  const routedSegments: RouteSection[] = [];
  const fuelStops: FuelStop[] = [];
  let distanceTravelledKm = 0;
  let currentOrigin = section.from;
  let remainingSection = section;

  while (remainingSection.distanceKm > usableDistanceKm) {
    emitProgress(options, {
      stage: "route",
      message: `Looking up fuel options between ${currentOrigin.name} and ${section.to.name}.`,
    });

    const selectedFuelStation = await chooseFuelStationForSection(
      currentOrigin,
      section.to,
      remainingSection,
      distanceTravelledKm,
      usableDistanceKm,
    );

    routedSegments.push(selectedFuelStation.toFuelSection);
    fuelStops.push(selectedFuelStation.fuelStop);
    distanceTravelledKm += selectedFuelStation.toFuelSection.distanceKm;
    currentOrigin = selectedFuelStation.waypoint;
    remainingSection = selectedFuelStation.remainingSection;
  }

  routedSegments.push(remainingSection);

  return {
    ...section,
    geometry: mergeGeometries(routedSegments.map((routeSection) => routeSection.geometry)),
    distanceKm: routedSegments.reduce((sum, routeSection) => sum + routeSection.distanceKm, 0),
    durationHours: routedSegments.reduce((sum, routeSection) => sum + routeSection.durationHours, 0),
    fuelStops,
  };
};

const buildDailyPlans = async (
  allWaypoints: ResolvedWaypoint[],
  routeSections: RouteSection[],
  input: PlannerInput,
  options?: PlannerOptions,
) => {
  const rawDailyPlans: DailyPlan[] = [];
  let dayNumber = 1;
  let cumulativeFuelUsedLitres = 0;

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
      cumulativeFuelUsedLitres += fuelUsedLitres;
      const fuelStops = section.fuelStops
        .filter(
          (fuelStop) =>
            fuelStop.distanceFromSectionStartKm >= chunk.startKm - 0.01 && fuelStop.distanceFromSectionStartKm <= chunk.endKm + 0.01,
        )
        .map((fuelStop) => {
          const distanceFromDayStartKm = Math.max(0, fuelStop.distanceFromSectionStartKm - chunk.startKm);

          return {
            ...fuelStop,
            distanceFromDayStartKm: roundToOneDecimal(distanceFromDayStartKm),
            driveHoursFromDayStart:
              chunk.distanceKm === 0 ? 0 : roundToOneDecimal(chunk.durationHours * (distanceFromDayStartKm / chunk.distanceKm)),
          };
        });
      const notes = [] as string[];

      if (!finalChunk) {
        notes.push("The stop lands near your daily drive target and searches nearby camping first.");
      }

      if (finalChunk && targetWaypoint.kind === "destination" && targetWaypoint.stayDays > 0) {
        notes.push(`Arrival day for ${targetWaypoint.name}. ${targetWaypoint.stayDays} stay day(s) are allocated next.`);
      }

      if (finalChunk && targetWaypoint.kind === "fuel") {
        notes.push(`Planned fuel stop at ${targetWaypoint.name}.`);
      }

      if (fuelStops.length > 0) {
        const pricedStops = fuelStops.filter((fuelStop) => fuelStop.priceLabel);
        notes.push(
          pricedStops.length > 0
            ? `Inserted ${fuelStops.length} routed fuel stop${fuelStops.length === 1 ? "" : "s"}, favouring stations with known pricing when available.`
            : `Inserted ${fuelStops.length} routed fuel stop${fuelStops.length === 1 ? "" : "s"} and included the detour in the route geometry.`,
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
        cumulativeFuelUsedLitres: roundToOneDecimal(cumulativeFuelUsedLitres),
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
          cumulativeFuelUsedLitres: roundToOneDecimal(cumulativeFuelUsedLitres),
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

  const completedRouteSections = await routeSequence(allWaypoints);

  completedRouteSections.forEach((section, index) => {
    emitProgress(options, {
      stage: "route",
      message: `Routed leg ${index + 1} of ${completedRouteSections.length}: ${section.from.name} to ${section.to.name}.`,
      preview: makePreview(selectedRoute.ordered, allWaypoints, completedRouteSections.slice(0, index + 1)),
    });
  });

  const routedFuelSections = await mapInOrder(completedRouteSections, async (section) => buildRoutedFuelSection(section, input, options));
  const dailyPlans = await buildDailyPlans(allWaypoints, routedFuelSections, input, options);
  const totalDistanceKm = routedFuelSections.reduce((sum, section) => sum + section.distanceKm, 0);
  const totalDriveHours = routedFuelSections.reduce((sum, section) => sum + section.durationHours, 0);
  const totalStayDays = selectedRoute.ordered.reduce((sum, waypoint) => sum + waypoint.stayDays, 0);

  const result: TripPlan = {
    selectedDestinations: selectedRoute.ordered,
    allWaypoints,
    routeSections: routedFuelSections,
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
    preview: makePreview(selectedRoute.ordered, allWaypoints, routedFuelSections),
  });

  return result;
};
