import { dedupeCoordinates, distanceFromPointToPathKm, getBoundingBox, haversineKm } from "./geo";
import type {
  CampsiteOption,
  Coordinates,
  FuelStationOption,
  LocationCandidate,
  PointOfInterest,
  ResolvedWaypoint,
  RouteSection,
} from "../types";

const PHOTON_SEARCH_URL = "https://photon.komoot.io/api";
const PHOTON_REVERSE_URL = "https://photon.komoot.io/reverse";
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

type PhotonFeature = {
  geometry?: {
    coordinates?: [number, number];
  };
  properties?: {
    name?: string;
    city?: string;
    state?: string;
    country?: string;
    county?: string;
    district?: string;
    suburb?: string;
    street?: string;
    postcode?: string;
  };
};

type PhotonResponse = {
  features?: PhotonFeature[];
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
const fuelCache = new Map<string, FuelStationOption[]>();

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

const PRICE_TAGS = ["fuel:diesel", "fuel:e10", "fuel:octane_91", "fuel:octane_95", "fuel:lpg", "fuel:cng"];

const parseFuelPrice = (value: string | undefined) => {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/,/g, ".");
  const match = normalized.match(/\d+(?:\.\d+)?/);

  if (!match) {
    return null;
  }

  const numericValue = Number.parseFloat(match[0]);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const getFuelPriceDetails = (tags: Record<string, string> | undefined) => {
  if (!tags) {
    return {};
  }

  const pricedTags = PRICE_TAGS
    .map((key) => ({
      key,
      rawValue: tags[key],
      numericValue: parseFuelPrice(tags[key]),
    }))
    .filter((entry): entry is { key: string; rawValue: string; numericValue: number } => entry.rawValue !== undefined && entry.numericValue !== null)
    .sort((left, right) => left.numericValue - right.numericValue);

  if (pricedTags.length === 0) {
    return {};
  }

  const bestPrice = pricedTags[0];
  const labelKey = bestPrice.key.replace("fuel:", "").replace(/_/g, " ");

  return {
    pricePerLitre: bestPrice.numericValue,
    priceLabel: `${labelKey} ${bestPrice.rawValue}`,
  };
};

const formatPhotonLabel = (feature: PhotonFeature, fallbackName: string) => {
  const properties = feature.properties ?? {};
  const parts = [
    properties.name,
    properties.city ?? properties.county ?? properties.district ?? properties.suburb,
    properties.state,
    properties.country,
  ].filter((part, index, allParts): part is string => Boolean(part) && allParts.indexOf(part) === index);

  return parts.join(", ") || fallbackName;
};

const toPhotonCandidate = (feature: PhotonFeature, fallbackName: string): LocationCandidate | null => {
  const coordinates = feature.geometry?.coordinates;

  if (!coordinates || coordinates.length !== 2) {
    return null;
  }

  return {
    name: formatPhotonLabel(feature, fallbackName),
    coordinates: {
      lat: coordinates[1],
      lng: coordinates[0],
    },
  };
};

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

  const url = `${PHOTON_SEARCH_URL}?limit=${limit}&q=${encodeURIComponent(trimmedQuery)}`;
  const payload = await fetchJson<PhotonResponse>(url, {
    headers: {
      Accept: "application/json",
    },
  });

  const candidates = (payload.features ?? [])
    .map((feature) => toPhotonCandidate(feature, trimmedQuery))
    .filter((candidate): candidate is LocationCandidate => candidate !== null);

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

  const url = `${PHOTON_REVERSE_URL}?lat=${coordinates.lat}&lon=${coordinates.lng}`;
  const payload = await fetchJson<PhotonResponse>(url, {
    headers: {
      Accept: "application/json",
    },
  });

  const topFeature = payload.features?.[0];
  const label = topFeature ? formatPhotonLabel(topFeature, `Pinned ${coordinates.lat.toFixed(4)}, ${coordinates.lng.toFixed(4)}`) : undefined;

  const candidate = {
    name: label ?? `Pinned ${coordinates.lat.toFixed(4)}, ${coordinates.lng.toFixed(4)}`,
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
    fuelStops: [],
  };

  routeCache.set(cacheKey, section);
  return section;
};

export const findFuelStationsAlongPath = async (path: Coordinates[], around: Coordinates): Promise<FuelStationOption[]> => {
  if (path.length < 2) {
    return [];
  }

  const cacheKey = `${makeCoordinateKey(around)}::${path.length}::fuel`;
  const cached = fuelCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const query = `
[out:json][timeout:25];
(
  node(around:20000,${around.lat},${around.lng})["amenity"="fuel"];
  way(around:20000,${around.lat},${around.lng})["amenity"="fuel"];
  relation(around:20000,${around.lat},${around.lng})["amenity"="fuel"];
);
out center 60;
`;

  const payload = await overpassFetch(query);
  const seen = new Set<string>();

  const stations = payload.elements
    .map((element) => {
      const coordinates = getElementCoordinates(element);

      if (!coordinates) {
        return null;
      }

      const distanceFromRouteKm = distanceFromPointToPathKm(coordinates, path);

      if (distanceFromRouteKm > 12) {
        return null;
      }

      const key = `${Math.round(coordinates.lat * 1000)}-${Math.round(coordinates.lng * 1000)}`;

      if (seen.has(key)) {
        return null;
      }

      seen.add(key);

      const tags = element.tags ?? {};
      const priceDetails = getFuelPriceDetails(tags);
      const station: FuelStationOption = {
        id: `${element.type}-${element.id}`,
        name: tags.name ?? "Fuel station",
        coordinates,
        distanceFromRouteKm,
        osmUrl: buildOsmUrl(element),
        priceLabel: priceDetails.priceLabel,
        pricePerLitre: priceDetails.pricePerLitre,
      };

      return station;
    })
    .filter((station): station is FuelStationOption => station !== null)
    .sort((left, right) => {
      if (left.pricePerLitre !== undefined && right.pricePerLitre !== undefined && left.pricePerLitre !== right.pricePerLitre) {
        return left.pricePerLitre - right.pricePerLitre;
      }

      if (left.pricePerLitre !== undefined || right.pricePerLitre !== undefined) {
        return left.pricePerLitre !== undefined ? -1 : 1;
      }

      return left.distanceFromRouteKm - right.distanceFromRouteKm;
    })
    .slice(0, 10);

  fuelCache.set(cacheKey, stations);
  return stations;
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
