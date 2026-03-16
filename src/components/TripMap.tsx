import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Popup, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { LatLngTuple } from "leaflet";
import type { Coordinates, DailyPlan, PlannerInput, PlanningPreview, TripPlan } from "../types";

type TripMapProps = {
  onClearSelection: () => void;
  isPlanning: boolean;
  onMapAction: (kind: "start" | "end" | "destination", coordinates: Coordinates) => Promise<void> | void;
  onRemoveDestination: (destinationId: string) => void;
  onSelectDay: (day: DailyPlan) => void;
  plan: TripPlan | null;
  plannerInput: PlannerInput;
  preview: PlanningPreview | null;
  selectedDay: DailyPlan | null;
};

const markerStyles = {
  start: "#0f766e",
  destination: "#d97706",
  overnight: "#b91c1c",
  end: "#1d4ed8",
  fuel: "#0ea5e9",
} as const;

const candidateMarkerStyle = "#64748b";

const FitRoute = ({ enabled, points }: { enabled: boolean; points: LatLngTuple[] }) => {
  const map = useMap();

  useEffect(() => {
    if (enabled && points.length > 0) {
      map.fitBounds(points, {
        padding: [36, 36],
      });
    }
  }, [enabled, map, points]);

  return null;
};

const MapInteractionEvents = ({
  onContextMenu,
  onDismiss,
  onUserInteract,
}: {
  onContextMenu: (coordinates: Coordinates) => void;
  onDismiss: () => void;
  onUserInteract: () => void;
}) => {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const handleUserInteract = () => onUserInteract();

    container.addEventListener("pointerdown", handleUserInteract, { passive: true });
    container.addEventListener("wheel", handleUserInteract, { passive: true });
    container.addEventListener("touchstart", handleUserInteract, { passive: true });
    container.addEventListener("contextmenu", handleUserInteract, { passive: true });

    return () => {
      container.removeEventListener("pointerdown", handleUserInteract);
      container.removeEventListener("wheel", handleUserInteract);
      container.removeEventListener("touchstart", handleUserInteract);
      container.removeEventListener("contextmenu", handleUserInteract);
    };
  }, [map, onUserInteract]);

  useMapEvents({
    click: () => onDismiss(),
    contextmenu: (event) => {
      onContextMenu({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
      });
    },
  });

  return null;
};

export const TripMap = ({
  onClearSelection,
  isPlanning,
  onMapAction,
  onRemoveDestination,
  onSelectDay,
  plan,
  plannerInput,
  preview,
  selectedDay,
}: TripMapProps) => {
  const [contextCoordinates, setContextCoordinates] = useState<Coordinates | null>(null);
  const [autoFitEnabled, setAutoFitEnabled] = useState(true);
  const displayedJourney = preview ?? (plan
    ? {
        selectedDestinations: plan.selectedDestinations,
        allWaypoints: plan.allWaypoints,
        routeSections: plan.routeSections,
        optimizationMode: plan.optimizationMode,
      }
    : null);

  const routeWaypoints = displayedJourney?.allWaypoints ?? [];
  const plannedDriveDays = plan?.dailyPlans.filter((day) => day.kind === "drive") ?? [];
  const selectedDestinationIds = new Set((displayedJourney?.selectedDestinations ?? []).map((waypoint) => waypoint.id));
  const routedPath = displayedJourney?.routeSections.flatMap((section) => section.geometry).map((point) => [point.lat, point.lng] as LatLngTuple) ?? [];
  const directPath = routeWaypoints.map((waypoint) => [waypoint.coordinates.lat, waypoint.coordinates.lng] as LatLngTuple);
  const highlightedPath = selectedDay?.geometry.map((point) => [point.lat, point.lng] as LatLngTuple) ?? [];
  const selectedFuelStops = selectedDay?.fuelStops ?? [];

  const extraCandidateMarkers = useMemo(
    () =>
      plannerInput.destinations.filter(
        (destination) => destination.location.coordinates && !selectedDestinationIds.has(destination.id),
      ),
    [plannerInput.destinations, selectedDestinationIds],
  );

  const fitPoints =
    routedPath.length > 0
      ? routedPath
      : directPath.length > 0
        ? directPath
        : [plannerInput.start.coordinates, plannerInput.end.coordinates, ...plannerInput.destinations.map((destination) => destination.location.coordinates)]
            .filter((point): point is Coordinates => Boolean(point))
            .map((point) => [point.lat, point.lng] as LatLngTuple);

  const hasSelectedStart = routeWaypoints.some((waypoint) => waypoint.kind === "start");
  const hasSelectedEnd = routeWaypoints.some((waypoint) => waypoint.kind === "end");

  return (
    <section className="map-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Map</p>
          <h2>Live preview map</h2>
        </div>
        <div className="map-panel-actions">
          <p className="subtle-copy">
            {selectedDay
              ? `Highlighting ${selectedDay.title}`
              : isPlanning
                ? "Routing the current draft live. Right-click to add or move stops."
                : "Right-click anywhere to add a destination or reset the trip bounds."}
          </p>
          <button className="secondary-button compact-button" onClick={() => setAutoFitEnabled(true)} type="button">
            Recenter map
          </button>
        </div>
      </div>

      <div className="map-frame">
        <MapContainer className="map-canvas" center={[-35.0, 148.0]} zoom={5} scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitRoute enabled={autoFitEnabled} points={fitPoints} />
          <MapInteractionEvents
            onContextMenu={(coordinates) => {
              setAutoFitEnabled(false);
              setContextCoordinates(coordinates);
            }}
            onDismiss={() => {
              setContextCoordinates(null);
              onClearSelection();
            }}
            onUserInteract={() => setAutoFitEnabled(false)}
          />

          {directPath.length > 1 ? <Polyline color="#165dff" dashArray="8 12" opacity={routedPath.length > 1 ? 0.18 : 0.55} positions={directPath} weight={4} /> : null}

          {plannedDriveDays.length > 0 && !isPlanning
            ? plannedDriveDays.map((day) => {
                const dayPath = day.geometry.map((point) => [point.lat, point.lng] as LatLngTuple);
                const isSelected = selectedDay?.dayNumber === day.dayNumber;

                return dayPath.length > 1 ? (
                  <Polyline
                    color={isSelected ? "#ef4444" : "#165dff"}
                    eventHandlers={{
                      click: (event) => {
                        event.originalEvent.stopPropagation();
                        if (isSelected) {
                          onClearSelection();
                        } else {
                          onSelectDay(day);
                        }
                      },
                    }}
                    key={day.dayNumber}
                    opacity={isSelected ? 0.95 : 0.42}
                    positions={dayPath}
                    weight={isSelected ? 6 : 5}
                  />
                ) : null;
              })
            : routedPath.length > 1
              ? <Polyline color="#165dff" positions={routedPath} weight={5} opacity={0.38} />
              : null}

          {highlightedPath.length > 1 && (isPlanning || plannedDriveDays.length === 0) ? <Polyline color="#ef4444" positions={highlightedPath} weight={6} /> : null}

          {selectedFuelStops.map((fuelStop) => (
            <CircleMarker
              center={[fuelStop.coordinates.lat, fuelStop.coordinates.lng]}
              key={fuelStop.id}
              pathOptions={{
                color: markerStyles.fuel,
                fillColor: markerStyles.fuel,
                fillOpacity: 0.92,
              }}
              radius={5}
            >
              <Popup>
                <strong>{fuelStop.name}</strong>
                <div>{fuelStop.distanceFromDayStartKm} km into the selected drive day</div>
              </Popup>
            </CircleMarker>
          ))}

          {routeWaypoints.map((waypoint) => (
            <CircleMarker
              center={[waypoint.coordinates.lat, waypoint.coordinates.lng]}
              key={waypoint.id}
              pathOptions={{
                color: markerStyles[waypoint.kind],
                fillColor: markerStyles[waypoint.kind],
                fillOpacity: 0.95,
              }}
              radius={8}
            >
              <Popup>
                <strong>{waypoint.name}</strong>
                <div>{waypoint.kind}</div>
                {waypoint.kind === "destination" ? (
                  <button className="ghost-button popup-button" onClick={() => onRemoveDestination(waypoint.id)} type="button">
                    Remove destination
                  </button>
                ) : null}
              </Popup>
            </CircleMarker>
          ))}

          {!hasSelectedStart && plannerInput.start.coordinates ? (
            <CircleMarker
              center={[plannerInput.start.coordinates.lat, plannerInput.start.coordinates.lng]}
              pathOptions={{
                color: markerStyles.start,
                fillColor: markerStyles.start,
                fillOpacity: 0.65,
              }}
              radius={6}
            >
              <Popup>
                <strong>{plannerInput.start.name}</strong>
                <div>Draft start</div>
              </Popup>
            </CircleMarker>
          ) : null}

          {!hasSelectedEnd && plannerInput.end.coordinates ? (
            <CircleMarker
              center={[plannerInput.end.coordinates.lat, plannerInput.end.coordinates.lng]}
              pathOptions={{
                color: markerStyles.end,
                fillColor: markerStyles.end,
                fillOpacity: 0.65,
              }}
              radius={6}
            >
              <Popup>
                <strong>{plannerInput.end.name}</strong>
                <div>Draft end</div>
              </Popup>
            </CircleMarker>
          ) : null}

          {extraCandidateMarkers.map((destination) => (
            <CircleMarker
              center={[destination.location.coordinates!.lat, destination.location.coordinates!.lng]}
              key={destination.id}
              pathOptions={{
                color: candidateMarkerStyle,
                fillColor: candidateMarkerStyle,
                fillOpacity: 0.68,
              }}
              radius={6}
            >
              <Popup>
                <strong>{destination.location.name}</strong>
                <div>Candidate destination</div>
                <button className="ghost-button popup-button" onClick={() => onRemoveDestination(destination.id)} type="button">
                  Remove destination
                </button>
              </Popup>
            </CircleMarker>
          ))}

          {plan?.dailyPlans
            .filter((day) => day.overnightStop)
            .map((day) => (
              <CircleMarker
                center={[day.overnightStop!.coordinates.lat, day.overnightStop!.coordinates.lng]}
                key={day.overnightStop!.id}
                pathOptions={{
                  color: markerStyles.overnight,
                  fillColor: markerStyles.overnight,
                  fillOpacity: 0.8,
                }}
                radius={5}
              >
                <Popup>{day.overnightStop!.name}</Popup>
              </CircleMarker>
            ))}

          {contextCoordinates ? (
            <Popup position={[contextCoordinates.lat, contextCoordinates.lng]}>
              <div className="map-popup-actions">
                <strong>Map actions</strong>
                <button
                  className="secondary-button popup-button"
                  onClick={() => {
                    setAutoFitEnabled(false);
                    void onMapAction("destination", contextCoordinates);
                    setContextCoordinates(null);
                  }}
                  type="button"
                >
                  Add destination
                </button>
                <button
                  className="secondary-button popup-button"
                  onClick={() => {
                    setAutoFitEnabled(false);
                    void onMapAction("start", contextCoordinates);
                    setContextCoordinates(null);
                  }}
                  type="button"
                >
                  Use as start
                </button>
                <button
                  className="secondary-button popup-button"
                  onClick={() => {
                    setAutoFitEnabled(false);
                    void onMapAction("end", contextCoordinates);
                    setContextCoordinates(null);
                  }}
                  type="button"
                >
                  Use as end
                </button>
              </div>
            </Popup>
          ) : null}
        </MapContainer>
      </div>

      <p className="subtle-copy map-help-copy">Tip: click a route leg to focus its table entry, use Recenter after panning manually, and fuel-stop markers appear for the selected drive day.</p>
    </section>
  );
};
