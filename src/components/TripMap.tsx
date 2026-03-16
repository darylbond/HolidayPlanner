import { useEffect } from "react";
import { CircleMarker, MapContainer, Popup, Polyline, TileLayer, useMap } from "react-leaflet";
import type { LatLngTuple } from "leaflet";
import type { DailyPlan, TripPlan } from "../types";

type TripMapProps = {
  plan: TripPlan | null;
  selectedDay: DailyPlan | null;
};

const markerStyles = {
  start: "#0f766e",
  destination: "#d97706",
  overnight: "#b91c1c",
  end: "#1d4ed8",
} as const;

const FitRoute = ({ points }: { points: LatLngTuple[] }) => {
  const map = useMap();

  useEffect(() => {
    if (points.length > 0) {
      map.fitBounds(points, {
        padding: [36, 36],
      });
    }
  }, [map, points]);

  return null;
};

export const TripMap = ({ plan, selectedDay }: TripMapProps) => {
  if (!plan) {
    return (
      <section className="map-panel map-placeholder">
        <p className="eyebrow">Map</p>
        <h2>Daily route map</h2>
        <p>Build a plan to display the route, overnight stops, and destination sequence on the map.</p>
      </section>
    );
  }

  const allPoints = plan.routeSections.flatMap((section) => section.geometry).map((point) => [point.lat, point.lng] as LatLngTuple);
  const highlightedPath = selectedDay?.geometry.map((point) => [point.lat, point.lng] as LatLngTuple) ?? [];

  return (
    <section className="map-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Map</p>
          <h2>Total route</h2>
        </div>
        <p className="subtle-copy">{selectedDay ? `Highlighting ${selectedDay.title}` : "Showing the full itinerary"}</p>
      </div>

      <div className="map-frame">
        <MapContainer className="map-canvas" center={[-35.0, 148.0]} zoom={5} scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitRoute points={allPoints} />

          <Polyline color="#165dff" positions={allPoints} weight={4} opacity={0.35} />

          {highlightedPath.length > 1 ? <Polyline color="#ef4444" positions={highlightedPath} weight={6} /> : null}

          {plan.allWaypoints.map((waypoint) => (
            <CircleMarker
              center={[waypoint.coordinates.lat, waypoint.coordinates.lng]}
              key={waypoint.id}
              pathOptions={{
                color: markerStyles[waypoint.kind],
                fillColor: markerStyles[waypoint.kind],
                fillOpacity: 0.95,
              }}
              radius={7}
            >
              <Popup>
                <strong>{waypoint.name}</strong>
                <div>{waypoint.kind}</div>
              </Popup>
            </CircleMarker>
          ))}

          {plan.dailyPlans
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
        </MapContainer>
      </div>
    </section>
  );
};
