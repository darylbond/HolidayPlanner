import type { Coordinates } from "../types";

const EARTH_RADIUS_KM = 6371;

const toRadians = (value: number) => (value * Math.PI) / 180;

export const haversineKm = (start: Coordinates, end: Coordinates) => {
  const latitudeDelta = toRadians(end.lat - start.lat);
  const longitudeDelta = toRadians(end.lng - start.lng);
  const startLatitude = toRadians(start.lat);
  const endLatitude = toRadians(end.lat);

  const a =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(startLatitude) *
      Math.cos(endLatitude) *
      Math.sin(longitudeDelta / 2) *
      Math.sin(longitudeDelta / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
};

export const distanceAlongPathKm = (path: Coordinates[]) => {
  if (path.length < 2) {
    return 0;
  }

  let total = 0;

  for (let index = 1; index < path.length; index += 1) {
    total += haversineKm(path[index - 1], path[index]);
  }

  return total;
};

export const interpolatePoint = (start: Coordinates, end: Coordinates, fraction: number): Coordinates => ({
  lat: start.lat + (end.lat - start.lat) * fraction,
  lng: start.lng + (end.lng - start.lng) * fraction,
});

export const slicePolylineByKm = (path: Coordinates[], startKm: number, endKm: number) => {
  if (path.length < 2 || endKm <= startKm) {
    return path.length > 0 ? [path[0]] : [];
  }

  const result: Coordinates[] = [];
  let travelledKm = 0;

  for (let index = 1; index < path.length; index += 1) {
    const segmentStart = path[index - 1];
    const segmentEnd = path[index];
    const segmentKm = haversineKm(segmentStart, segmentEnd);
    const nextTravelledKm = travelledKm + segmentKm;

    if (nextTravelledKm < startKm) {
      travelledKm = nextTravelledKm;
      continue;
    }

    if (travelledKm > endKm) {
      break;
    }

    const segmentStartFraction = segmentKm === 0 ? 0 : Math.max(0, (startKm - travelledKm) / segmentKm);
    const segmentEndFraction = segmentKm === 0 ? 1 : Math.min(1, (endKm - travelledKm) / segmentKm);

    if (segmentStartFraction <= 1 && result.length === 0) {
      result.push(interpolatePoint(segmentStart, segmentEnd, segmentStartFraction));
    }

    if (segmentStartFraction === 0) {
      result.push(segmentStart);
    }

    if (segmentEndFraction >= 0 && segmentEndFraction <= 1) {
      result.push(interpolatePoint(segmentStart, segmentEnd, segmentEndFraction));
    }

    travelledKm = nextTravelledKm;
  }

  if (result.length === 1) {
    result.push(result[0]);
  }

  return dedupeCoordinates(result);
};

export const dedupeCoordinates = (points: Coordinates[]) => {
  const deduped: Coordinates[] = [];

  points.forEach((point) => {
    const lastPoint = deduped[deduped.length - 1];

    if (!lastPoint || lastPoint.lat !== point.lat || lastPoint.lng !== point.lng) {
      deduped.push(point);
    }
  });

  return deduped;
};

export const getBoundingBox = (points: Coordinates[], paddingDegrees = 0.18) => {
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);

  return {
    south: Math.min(...lats) - paddingDegrees,
    west: Math.min(...lngs) - paddingDegrees,
    north: Math.max(...lats) + paddingDegrees,
    east: Math.max(...lngs) + paddingDegrees,
  };
};

export const distanceFromPointToPathKm = (point: Coordinates, path: Coordinates[]) => {
  if (path.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  let closestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < path.length; index += 1) {
    closestDistance = Math.min(closestDistance, haversineKm(point, path[index]));
  }

  return closestDistance;
};
