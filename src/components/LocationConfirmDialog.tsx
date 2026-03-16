import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { LatLngTuple } from "leaflet";
import type { Coordinates, LocationCandidate } from "../types";

type LocationConfirmDialogProps = {
  candidates: LocationCandidate[];
  errorMessage: string | null;
  isLoading: boolean;
  isOpen: boolean;
  query: string;
  targetLabel: string;
  onCancel: () => void;
  onConfirm: (candidate: LocationCandidate) => void;
};

const FitCandidates = ({ candidates }: { candidates: LocationCandidate[] }) => {
  const map = useMap();

  useEffect(() => {
    if (candidates.length === 0) {
      return;
    }

    window.setTimeout(() => {
      map.invalidateSize();

      if (candidates.length === 1) {
        map.setView([candidates[0].coordinates.lat, candidates[0].coordinates.lng], 11);
        return;
      }

      map.fitBounds(candidates.map((candidate) => [candidate.coordinates.lat, candidate.coordinates.lng] as LatLngTuple), {
        padding: [28, 28],
      });
    }, 0);
  }, [candidates, map]);

  return null;
};

const RefineLocationEvents = ({ onRefine }: { onRefine: (coordinates: Coordinates) => void }) => {
  useMapEvents({
    click: (event) => {
      onRefine({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
      });
    },
  });

  return null;
};

export const LocationConfirmDialog = ({
  candidates,
  errorMessage,
  isLoading,
  isOpen,
  query,
  targetLabel,
  onCancel,
  onConfirm,
}: LocationConfirmDialogProps) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [refinedCoordinates, setRefinedCoordinates] = useState<Coordinates | null>(null);

  useEffect(() => {
    setSelectedIndex(0);
    setRefinedCoordinates(null);
  }, [candidates, isOpen, query]);

  if (!isOpen) {
    return null;
  }

  const selectedCandidate = candidates[selectedIndex] ?? null;
  const confirmedCandidate = useMemo(
    () =>
      selectedCandidate
        ? {
            ...selectedCandidate,
            coordinates: refinedCoordinates ?? selectedCandidate.coordinates,
          }
        : null,
    [refinedCoordinates, selectedCandidate],
  );
  const hasRefinedPin =
    confirmedCandidate !== null &&
    (confirmedCandidate.coordinates.lat !== selectedCandidate?.coordinates.lat ||
      confirmedCandidate.coordinates.lng !== selectedCandidate?.coordinates.lng);

  return (
    <div className="dialog-backdrop" role="presentation">
      <div aria-modal className="dialog-card" role="dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">Confirm location</p>
            <h2>{targetLabel}</h2>
          </div>
          <button className="ghost-button" onClick={onCancel} type="button">
            Close
          </button>
        </div>

        <p className="subtle-copy">Review the map match for "{query}", then click the map to refine the pin before confirming if needed.</p>

        {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
        {isLoading ? <p className="subtle-copy">Searching the map…</p> : null}

        {candidates.length > 0 ? (
          <div className="dialog-grid">
            <div className="dialog-map-frame">
              <MapContainer center={[-35.0, 148.0]} className="dialog-map" key={`${query}-${candidates.length}`} zoom={5} scrollWheelZoom>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <FitCandidates candidates={candidates} />
                <RefineLocationEvents onRefine={setRefinedCoordinates} />

                {candidates.map((candidate, index) => (
                  <CircleMarker
                    center={[candidate.coordinates.lat, candidate.coordinates.lng]}
                    eventHandlers={{
                      click: () => setSelectedIndex(index),
                    }}
                    key={`${candidate.name}-${candidate.coordinates.lat}-${candidate.coordinates.lng}`}
                    pathOptions={{
                      color: index === selectedIndex ? "#d9480f" : "#0f766e",
                      fillColor: index === selectedIndex ? "#d9480f" : "#0f766e",
                      fillOpacity: 0.92,
                    }}
                    radius={index === selectedIndex ? 9 : 6}
                  />
                ))}

                {confirmedCandidate ? (
                  <CircleMarker
                    center={[confirmedCandidate.coordinates.lat, confirmedCandidate.coordinates.lng]}
                    pathOptions={{
                      color: hasRefinedPin ? "#ef4444" : "#d9480f",
                      fillColor: hasRefinedPin ? "#ef4444" : "#d9480f",
                      fillOpacity: 0.25,
                      weight: 3,
                    }}
                    radius={12}
                  />
                ) : null}
              </MapContainer>
            </div>

            <div className="candidate-list">
              <div className="candidate-refine-note">
                <strong>{hasRefinedPin ? "Refined pin active" : "Map refinement available"}</strong>
                <span>
                  {confirmedCandidate
                    ? `${confirmedCandidate.coordinates.lat.toFixed(4)}, ${confirmedCandidate.coordinates.lng.toFixed(4)}`
                    : "Select a candidate to refine it on the map."}
                </span>
              </div>

              {candidates.map((candidate, index) => (
                <button
                  className={`candidate-option ${index === selectedIndex ? "selected" : ""}`}
                  key={`${candidate.name}-${candidate.coordinates.lat}-${candidate.coordinates.lng}`}
                  onClick={() => {
                    setSelectedIndex(index);
                    setRefinedCoordinates(null);
                  }}
                  type="button"
                >
                  <strong>{candidate.name}</strong>
                  <span>
                    {candidate.coordinates.lat.toFixed(4)}, {candidate.coordinates.lng.toFixed(4)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="dialog-actions">
          <button className="secondary-button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!confirmedCandidate || isLoading}
            onClick={() => confirmedCandidate && onConfirm(confirmedCandidate)}
            type="button"
          >
            Confirm location
          </button>
        </div>
      </div>
    </div>
  );
};