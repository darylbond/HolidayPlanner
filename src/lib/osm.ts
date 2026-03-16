import { dedupeCoordinates, distanceFromPointToPathKm, getBoundingBox, haversineKm } from "./geo";
import type {
  CampsiteOption,
  Coordinates,
  LocationCandidate,
  PointOfInterest,
  ResolvedWaypoint,
  RouteSection,
} from "../types";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
};

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: {
    lat: number;
    lon: number;
  };
  tags?: Record<string, string>;
};

type OSRMResponse = {
  code: string;
  routes: Array<{
    distance: number;
    duration: number;
    geometry: {
      coordinates: [number, number][];
    };
  }>;
};

const geocodeCache = new Map<string, LocationCandidate[]>();
const reverseGeocodeCache = new Map<string, LocationCandidate>();
const routeCache = new Map<string, RouteSection>();
const campsiteCache = new Map<string, CampsiteOption[]>();
const poiCache = new Map<string, PointOfInterest[]>();

const roundCoordinate = (value: number) => Math.round(value * 100000) / 100000;

const makeCoordinateKey = (coordinates: Coordinates) => `${roundCoordinate(coordinates.lat)},${roundCoordinate(coordinates.lng)}`;

const makeRouteCacheKey = (from: ResolvedWaypoint, to: ResolvedWaypoint) =>
  `${makeCoordinateKey(from.coordinates)}->${makeCoordinateKey(to.coordinates)}`;

const fetchJson = async <Payload>(url: string, init?: RequestInit) => {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}.`);
  }

  return (await response.json()) as Payload;
};

const overpassFetch = async (query: string) => {
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    body: query,
    headers: {
      "Content-Type": "text/plain",
    },
  });

  if (!response.ok) {
    throw new Error(`Overpass request failed with ${response.status}.`);
  }

  return (await response.json()) as { elements: OverpassElement[] };
};

const getElementCoordinates = (element: OverpassElement): Coordinates | null => {
  if (typeof element.lat === "number" && typeof element.lon === "number") {
    return { lat: element.lat, lng: element.lon };
  }

  if (element.center) {
    return { lat: element.center.lat, lng: element.center.lon };
  }

  return null;
};

const buildOsmUrl = (element: OverpassElement) => `https://www.openstreetmap.org/${element.type}/${element.id}`;

export const searchPlaceCandidates = async (query: string, limit = 5): Promise<LocationCandidate[]> => {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return [];
  }

  const cacheKey = `${trimmedQuery.toLowerCase()}::${limit}`;
  const cached = geocodeCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const url = `${NOMINATIM_URL}?format=jsonv2&limit=${limit}&q=${encodeURIComponent(trimmedQuery)}`;
  const results = await fetchJson<NominatimResult[]>(url, {
    headers: {
      Accept: "application/json",
    },
  });

  const candidates = results.map((result) => ({
    name: result.display_name,
    coordinates: {
      lat: Number(result.lat),
      lng: Number(result.lon),
    },
  }));

  geocodeCache.set(cacheKey, candidates);
  return candidates;
};

export const geocodePlace = async (query: string) => {
  const candidates = await searchPlaceCandidates(query, 1);

  if (candidates.length === 0) {
    throw new Error(`Could not find a location for ${query}.`);
  }

  return candidates[0].coordinates;
};

export const reverseGeocodePlace = async (coordinates: Coordinates): Promise<LocationCandidate> => {
  const cacheKey = makeCoordinateKey(coordinates);
  const cached = reverseGeocodeCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${coordinates.lat}&lon=${coordinates.lng}`;
  const result = await fetchJson<{ display_name?: string }>(url, {
    headers: {
      Accept: "application/json",
    },
  });

  const candidate = {
    name: result.display_name ?? `Pinned ${coordinates.lat.toFixed(4)}, ${coordinates.lng.toFixed(4)}`,
    coordinates,
  };

  reverseGeocodeCache.set(cacheKey, candidate);
  return candidate;
};

export const routeBetween = async (from: ResolvedWaypoint, to: ResolvedWaypoint): Promise<RouteSection> => {
  const cacheKey = makeRouteCacheKey(from, to);
  const cached = routeCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const url = `${OSRM_URL}/${from.coordinates.lng},${from.coordinates.lat};${to.coordinates.lng},${to.coordinates.lat}?overview=full&geometries=geojson`;
  const payload = await fetchJson<OSRMResponse>(url);

  if (payload.code !== "Ok" || payload.routes.length === 0) {
    throw new Error(`No route found between ${from.name} and ${to.name}.`);
  }

  const route = payload.routes[0];
  const geometry = dedupeCoordinates(
    route.geometry.coordinates.map(([lng, lat]) => ({
      lat,
      lng,
    })),
  );

  const section = {
    id: `${from.id}-${to.id}`,
    from,
    to,
    distanceKm: route.distance / 1000,
    durationHours: route.duration / 3600,
    geometry,
  };

  routeCache.set(cacheKey, section);
  return section;
};

const formatCampsiteDescription = (tags: Record<string, string> | undefined) => {
  if (!tags) {
    return "Basic listing";
  }

  const details = [
    tags.fee ? `Fee: ${tags.fee}` : null,
    tags.toilets ? `Toilets: ${tags.toilets}` : null,
    tags.shower ? `Showers: ${tags.shower}` : null,
    tags.access ? `Access: ${tags.access}` : null,
  ].filter(Boolean);

  return details.length > 0 ? details.join(" · ") : "Basic listing";
};

export const findNearbyCampsites = async (stop: Coordinates): Promise<CampsiteOption[]> => {
  const cacheKey = makeCoordinateKey(stop);
  const cached = campsiteCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const query = `
[out:json][timeout:20];
(
  node(around:25000,${stop.lat},${stop.lng})["tourism"~"camp_site|caravan_site|camp_pitch"];
  way(around:25000,${stop.lat},${stop.lng})["tourism"~"camp_site|caravan_site|camp_pitch"];
  relation(around:25000,${stop.lat},${stop.lng})["tourism"~"camp_site|caravan_site|camp_pitch"];
);
out center 40;
`;

  const payload = await overpassFetch(query);

  const campsites = payload.elements
    .map((element) => {
      const coordinates = getElementCoordinates(element);

      if (!coordinates) {
        return null;
      }

      const tags = element.tags ?? {};
      const distanceKm = haversineKm(stop, coordinates);
      const freeCamp = tags.fee === "no" || tags.fee === "free" || tags.backcountry === "yes";

      return {
        name: tags.name ?? "Unnamed campsite",
        coordinates,
        distanceKm,
        freeCamp,
        description: formatCampsiteDescription(tags),
        osmUrl: buildOsmUrl(element),
      };
    })
    .filter((camp): camp is CampsiteOption => camp !== null)
    .sort((left, right) => {
      if (left.freeCamp !== right.freeCamp) {
        return left.freeCamp ? -1 : 1;
      }

      return left.distanceKm - right.distanceKm;
    })
    .slice(0, 4);

  campsiteCache.set(cacheKey, campsites);
  return campsites;
};

const inferPoiCategory = (tags: Record<string, string> | undefined) => {
  if (!tags) {
    return "Point of interest";
  }

  return tags.tourism ?? tags.historic ?? tags.natural ?? tags.leisure ?? tags.amenity ?? "Point of interest";
};

export const findPointsOfInterestAlongPath = async (path: Coordinates[]): Promise<PointOfInterest[]> => {
  if (path.length < 2) {
    return [];
  }

  const { south, west, north, east } = getBoundingBox(path);
  const cacheKey = `${roundCoordinate(south)},${roundCoordinate(west)},${roundCoordinate(north)},${roundCoordinate(east)}`;
  const cached = poiCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const query = `
[out:json][timeout:25];
(
  node(${south},${west},${north},${east})["tourism"];
  node(${south},${west},${north},${east})["historic"];
  node(${south},${west},${north},${east})["natural"];
  node(${south},${west},${north},${east})["leisure"="park"];
  node(${south},${west},${north},${east})["amenity"~"museum|arts_centre"];
  way(${south},${west},${north},${east})["tourism"];
  way(${south},${west},${north},${east})["historic"];
  way(${south},${west},${north},${east})["natural"];
  relation(${south},${west},${north},${east})["tourism"];
  relation(${south},${west},${north},${east})["historic"];
  relation(${south},${west},${north},${east})["natural"];
);
out center 80;
`;

  const payload = await overpassFetch(query);
  const seen = new Set<string>();

  const pois = payload.elements
    .map((element) => {
      const coordinates = getElementCoordinates(element);

      if (!coordinates || !element.tags?.name) {
        return null;
      }

      const distanceFromRouteKm = distanceFromPointToPathKm(coordinates, path);
      const key = `${element.tags.name}-${Math.round(coordinates.lat * 1000)}-${Math.round(coordinates.lng * 1000)}`;

      if (distanceFromRouteKm > 15 || seen.has(key)) {
        return null;
      }

      seen.add(key);

      return {
        name: element.tags.name,
        category: inferPoiCategory(element.tags),
        distanceFromRouteKm,
        osmUrl: buildOsmUrl(element),
      };
    })
    .filter((poi): poi is PointOfInterest => poi !== null)
    .sort((left, right) => left.distanceFromRouteKm - right.distanceFromRouteKm)
    .slice(0, 5);

  poiCache.set(cacheKey, pois);
  return pois;
};
