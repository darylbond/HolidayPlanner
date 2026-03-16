import type { ChangeEvent, FormEvent } from "react";
import { useState } from "react";
import type { DestinationInput, LocationConfirmTarget, PlannerInput, PlannerLocationInput } from "../types";

type PlannerFormProps = {
  isPlanning: boolean;
  onAddDestination: () => void;
  onChange: (input: PlannerInput) => void;
  onOpenLocationConfirm: (target: LocationConfirmTarget) => void;
  onPlanNow: () => Promise<void> | void;
  onRemoveDestination: (destinationId: string) => void;
  value: PlannerInput;
};

type NumericPlannerField =
  | "holidayDays"
  | "maxDriveHoursPerDay"
  | "fuelConsumptionLitresPer100Km"
  | "fuelTankLitres";

const describeLocation = (location: PlannerLocationInput) =>
  location.coordinates ? "Map confirmed" : "Text only. Use Confirm on map for an explicit pin.";

export const PlannerForm = ({
  isPlanning,
  onAddDestination,
  onChange,
  onOpenLocationConfirm,
  onPlanNow,
  onRemoveDestination,
  value,
}: PlannerFormProps) => {
  const [isDestinationListOpen, setIsDestinationListOpen] = useState(true);
  const [openDestinations, setOpenDestinations] = useState<Record<string, boolean>>({});

  const isDestinationExpanded = (destinationId: string) => openDestinations[destinationId] ?? true;

  const toggleDestinationCard = (destinationId: string) => {
    setOpenDestinations((current) => ({
      ...current,
      [destinationId]: !(current[destinationId] ?? true),
    }));
  };

  const updateField = <Key extends keyof PlannerInput>(field: Key, fieldValue: PlannerInput[Key]) => {
    onChange({
      ...value,
      [field]: fieldValue,
    });
  };

  const updateNamedLocation = (field: "start" | "end", name: string) => {
    updateField(field, {
      name,
    } as PlannerInput[typeof field]);
  };

  const updateDestination = <Key extends keyof DestinationInput>(
    destinationId: string,
    field: Key,
    fieldValue: DestinationInput[Key],
  ) => {
    onChange({
      ...value,
      destinations: value.destinations.map((destination) =>
        destination.id === destinationId
          ? {
              ...destination,
              [field]: fieldValue,
            }
          : destination,
      ),
    });
  };

  const updateDestinationLocation = (destinationId: string, name: string) => {
    onChange({
      ...value,
      destinations: value.destinations.map((destination) =>
        destination.id === destinationId
          ? {
              ...destination,
              location: {
                name,
              },
            }
          : destination,
      ),
    });
  };

  const handleNumericField = (event: ChangeEvent<HTMLInputElement>, field: NumericPlannerField) => {
    updateField(field, Number(event.target.value) as PlannerInput[NumericPlannerField]);
  };

  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onPlanNow();
  };

  return (
    <form className="planner-form" onSubmit={submitForm}>
      <div className="section-header">
        <p className="eyebrow">Trip Brief</p>
        <h2>Road-trip inputs</h2>
        <p className="section-copy">
          Enter the route constraints, vehicle details, and candidate destinations. The planner fits the best mix of stops
          into the available holiday length, re-runs automatically as you edit, and keeps the preview map in sync while it
          routes each leg.
        </p>
      </div>

      <div className="field-grid two-column">
        <label className="location-label">
          <span>Start point</span>
          <div className="location-input-row location-input-stack">
            <input value={value.start.name} onChange={(event) => updateNamedLocation("start", event.target.value)} required />
            <button
              className="secondary-button compact-button"
              onClick={() =>
                onOpenLocationConfirm({
                  kind: "start",
                  label: "Start point",
                  query: value.start.name,
                })
              }
              type="button"
            >
              Confirm on map
            </button>
          </div>
          <small>{describeLocation(value.start)}</small>
        </label>

        <label className="location-label">
          <span>End point</span>
          <div className="location-input-row location-input-stack">
            <input value={value.end.name} onChange={(event) => updateNamedLocation("end", event.target.value)} required />
            <button
              className="secondary-button compact-button"
              onClick={() =>
                onOpenLocationConfirm({
                  kind: "end",
                  label: "End point",
                  query: value.end.name,
                })
              }
              type="button"
            >
              Confirm on map
            </button>
          </div>
          <small>{describeLocation(value.end)}</small>
        </label>

        <label>
          <span>Holiday length in days</span>
          <input
            type="number"
            min="1"
            value={value.holidayDays}
            onChange={(event) => handleNumericField(event, "holidayDays")}
            required
          />
        </label>

        <label>
          <span>Max driving hours per day</span>
          <input
            type="number"
            min="1"
            step="0.5"
            value={value.maxDriveHoursPerDay}
            onChange={(event) => handleNumericField(event, "maxDriveHoursPerDay")}
            required
          />
        </label>

        <label>
          <span>Fuel consumption L/100km</span>
          <input
            type="number"
            min="1"
            step="0.1"
            value={value.fuelConsumptionLitresPer100Km}
            onChange={(event) => handleNumericField(event, "fuelConsumptionLitresPer100Km")}
            required
          />
        </label>

        <label>
          <span>Fuel tank size in litres</span>
          <input
            type="number"
            min="1"
            step="1"
            value={value.fuelTankLitres}
            onChange={(event) => handleNumericField(event, "fuelTankLitres")}
            required
          />
        </label>
      </div>

      <div className="destination-block">
        <div className="section-header inline-header">
          <div>
            <p className="eyebrow">Stops</p>
            <h3>Candidate destinations</h3>
            <p className="subtle-copy">
              Add as many candidates as you need. The planner uses a fast heuristic, then keeps only the set that fits.
            </p>
          </div>
          <div className="header-actions">
            <button className="secondary-button" onClick={onAddDestination} type="button">
              Add destination
            </button>
            <button className="ghost-button neutral-button" onClick={() => setIsDestinationListOpen((current) => !current)} type="button">
              {isDestinationListOpen ? "Collapse" : "Expand"}
            </button>
          </div>
        </div>

        <div className="destination-summary-row">
          <span className="pill">{value.destinations.length} candidates</span>
          <span className="pill">{value.destinations.filter((destination) => destination.location.coordinates).length} map-confirmed</span>
        </div>

        {isDestinationListOpen ? (
          <div className="destination-list">
            {value.destinations.map((destination, index) => (
              <article className="destination-card" key={destination.id}>
                <div className="destination-card-header">
                  <div>
                    <strong>Stop {index + 1}</strong>
                    <p className="destination-card-title">{destination.location.name.trim() || "Untitled destination"}</p>
                    <p className="destination-status">{describeLocation(destination.location)}</p>
                  </div>
                  <div className="destination-card-actions">
                    <button
                      className="ghost-button neutral-button"
                      onClick={() => toggleDestinationCard(destination.id)}
                      type="button"
                    >
                      {isDestinationExpanded(destination.id) ? "Collapse" : "Expand"}
                    </button>
                    <button className="ghost-button" type="button" onClick={() => onRemoveDestination(destination.id)}>
                      Remove
                    </button>
                  </div>
                </div>

                {isDestinationExpanded(destination.id) ? (
                  <div className="field-grid destination-grid destination-card-body">
                    <label className="destination-name">
                      <span>Destination</span>
                      <div className="location-input-row">
                        <input
                          value={destination.location.name}
                          onChange={(event) => updateDestinationLocation(destination.id, event.target.value)}
                          placeholder="Example: Wilsons Promontory, VIC"
                        />
                        <button
                          className="secondary-button compact-button"
                          onClick={() =>
                            onOpenLocationConfirm({
                              kind: "destination",
                              destinationId: destination.id,
                              label: `Destination ${index + 1}`,
                              query: destination.location.name,
                            })
                          }
                          type="button"
                        >
                          Confirm on map
                        </button>
                      </div>
                    </label>

                    <label>
                      <span>Stay days</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={destination.stayDays}
                        onChange={(event) => updateDestination(destination.id, "stayDays", Number(event.target.value))}
                      />
                    </label>

                    <label>
                      <span>Desirability</span>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        step="1"
                        value={destination.desirability}
                        onChange={(event) => updateDestination(destination.id, "desirability", Number(event.target.value))}
                      />
                    </label>

                    <label className="destination-notes">
                      <span>Notes</span>
                      <textarea
                        value={destination.notes ?? ""}
                        onChange={(event) => updateDestination(destination.id, "notes", event.target.value)}
                        rows={2}
                        placeholder="Optional notes for the stay"
                      />
                    </label>
                  </div>
                ) : null}
            </article>
            ))}
          </div>
        ) : null}
      </div>

      <p className="subtle-copy form-footer-copy">The planner refreshes automatically after edits. Use the button below to force an immediate rebuild.</p>

      <button className="primary-button" type="submit" disabled={isPlanning}>
        {isPlanning ? "Planning route..." : "Refresh now"}
      </button>
    </form>
  );
};
