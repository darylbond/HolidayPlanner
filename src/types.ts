export type Coordinates = {
  lat: number;
  lng: number;
};

export type PlannerLocationInput = {
  name: string;
  coordinates?: Coordinates;
};

export type DestinationInput = {
  id: string;
  location: PlannerLocationInput;
  stayDays: number;
  desirability: number;
  notes?: string;
};

export type PlannerInput = {
  start: PlannerLocationInput;
  end: PlannerLocationInput;
  holidayDays: number;
  maxDriveHoursPerDay: number;
  fuelConsumptionLitresPer100Km: number;
  fuelTankLitres: number;
  destinations: DestinationInput[];
};

export type WaypointKind = "start" | "destination" | "end" | "overnight";

export type ResolvedWaypoint = {
  id: string;
  name: string;
  kind: WaypointKind;
  coordinates: Coordinates;
  stayDays: number;
  desirability: number;
  notes?: string;
};

export type RouteSection = {
  id: string;
  from: ResolvedWaypoint;
  to: ResolvedWaypoint;
  distanceKm: number;
  durationHours: number;
  geometry: Coordinates[];
};

export type CampsiteOption = {
  name: string;
  coordinates: Coordinates;
  distanceKm: number;
  freeCamp: boolean;
  description: string;
  osmUrl: string;
};

export type PointOfInterest = {
  name: string;
  category: string;
  distanceFromRouteKm: number;
  osmUrl: string;
};

export type FuelStop = {
  id: string;
  name: string;
  coordinates: Coordinates;
  distanceFromDayStartKm: number;
  driveHoursFromDayStart: number;
};

export type LocationCandidate = {
  name: string;
  coordinates: Coordinates;
};

export type LocationTargetKind = "start" | "end" | "destination";

export type LocationConfirmTarget = {
  kind: LocationTargetKind;
  destinationId?: string;
  label: string;
  query: string;
};

export type PlanningStage = "resolve" | "optimize" | "route" | "enrich" | "complete";

export type PlanningPreview = {
  selectedDestinations: ResolvedWaypoint[];
  allWaypoints: ResolvedWaypoint[];
  routeSections: RouteSection[];
  optimizationMode: "fast";
};

export type PlanningProgressUpdate = {
  stage: PlanningStage;
  message: string;
  preview?: PlanningPreview;
};

export type PlannerLogEntry = {
  id: string;
  stage: PlanningStage;
  message: string;
  timestamp: string;
};

export type DailyPlan = {
  dayNumber: number;
  title: string;
  kind: "drive" | "stay";
  fromName: string;
  toName: string;
  geometry: Coordinates[];
  driveHours: number;
  distanceKm: number;
  fuelUsedLitres: number;
  refuelStops: number;
  fuelStops: FuelStop[];
  overnightStop?: ResolvedWaypoint;
  destinationStop?: ResolvedWaypoint;
  campsites: CampsiteOption[];
  pois: PointOfInterest[];
  notes: string[];
};

export type TripPlan = {
  selectedDestinations: ResolvedWaypoint[];
  allWaypoints: ResolvedWaypoint[];
  routeSections: RouteSection[];
  dailyPlans: DailyPlan[];
  totalDriveHours: number;
  totalDistanceKm: number;
  totalStayDays: number;
  totalHolidayDays: number;
  totalFuelLitres: number;
  optimizationMode: "fast";
};
