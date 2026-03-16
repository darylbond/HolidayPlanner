import { dedupeCoordinates, distanceFromPointToPathKm, getBoundingBox, haversineKm } from "./geo";
import type { CampsiteOption, Coordinates, PointOfInterest, ResolvedWaypoint, RouteSection } from "../types";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

type NominatimResult = {
  lat: string;
  lon: string;
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

export const geocodePlace = async (query: string) => {
  const url = `${NOMINATIM_URL}?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Geocoding request failed for ${query}.`);
  }

  const results = (await response.json()) as NominatimResult[];

  if (results.length === 0) {
    throw new Error(`Could not find a location for ${query}.`);
  }

  return {
    lat: Number(results[0].lat),
    lng: Number(results[0].lon),
  };
};

export const routeBetween = async (from: ResolvedWaypoint, to: ResolvedWaypoint): Promise<RouteSection> => {
  const url = `${OSRM_URL}/${from.coordinates.lng},${from.coordinates.lat};${to.coordinates.lng},${to.coordinates.lat}?overview=full&geometries=geojson`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Routing request failed between ${from.name} and ${to.name}.`);
  }

  const payload = (await response.json()) as OSRMResponse;

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

  return {
    id: `${from.id}-${to.id}`,
    from,
    to,
    distanceKm: route.distance / 1000,
    durationHours: route.duration / 3600,
    geometry,
  };
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

  return payload.elements
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

  return payload.elements
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
};
