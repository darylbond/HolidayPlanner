import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { DestinationInput, PlannerInput } from "../types";

type PlannerFormProps = {
  initialValue: PlannerInput;
  isPlanning: boolean;
  onPlan: (input: PlannerInput) => Promise<void>;
};

const createBlankDestination = (): DestinationInput => ({
  id: crypto.randomUUID(),
  name: "",
  stayDays: 1,
  desirability: 5,
  notes: "",
});

export const PlannerForm = ({ initialValue, isPlanning, onPlan }: PlannerFormProps) => {
  const [formState, setFormState] = useState<PlannerInput>(initialValue);

  const updateField = <Key extends keyof PlannerInput>(field: Key, value: PlannerInput[Key]) => {
    setFormState((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateDestination = <Key extends keyof DestinationInput>(
    destinationId: string,
    field: Key,
    value: DestinationInput[Key],
  ) => {
    setFormState((current) => ({
      ...current,
      destinations: current.destinations.map((destination) =>
        destination.id === destinationId
          ? {
              ...destination,
              [field]: value,
            }
          : destination,
      ),
    }));
  };

  const handleNumericField = (event: ChangeEvent<HTMLInputElement>, field: keyof PlannerInput) => {
    updateField(field, Number(event.target.value) as PlannerInput[keyof PlannerInput]);
  };

  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onPlan({
      ...formState,
      destinations: formState.destinations.filter((destination) => destination.name.trim().length > 0),
    });
  };

  return (
    <form className="planner-form" onSubmit={submitForm}>
      <div className="section-header">
        <p className="eyebrow">Trip Brief</p>
        <h2>Road-trip inputs</h2>
        <p className="section-copy">
          Enter the route constraints, vehicle details, and candidate destinations. The planner fits the best mix of stops
          into the available holiday length and then expands the route into daily travel segments.
        </p>
      </div>

      <div className="field-grid two-column">
        <label>
          <span>Start point</span>
          <input value={formState.start} onChange={(event) => updateField("start", event.target.value)} required />
        </label>

        <label>
          <span>End point</span>
          <input value={formState.end} onChange={(event) => updateField("end", event.target.value)} required />
        </label>

        <label>
          <span>Holiday length in days</span>
          <input
            type="number"
            min="1"
            value={formState.holidayDays}
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
            value={formState.maxDriveHoursPerDay}
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
            value={formState.fuelConsumptionLitresPer100Km}
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
            value={formState.fuelTankLitres}
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
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => updateField("destinations", [...formState.destinations, createBlankDestination()])}
          >
            Add destination
          </button>
        </div>

        <div className="destination-list">
          {formState.destinations.map((destination, index) => (
            <article className="destination-card" key={destination.id}>
              <div className="destination-card-header">
                <strong>Stop {index + 1}</strong>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() =>
                    updateField(
                      "destinations",
                      formState.destinations.filter((item) => item.id !== destination.id),
                    )
                  }
                >
                  Remove
                </button>
              </div>

              <div className="field-grid destination-grid">
                <label className="destination-name">
                  <span>Destination</span>
                  <input
                    value={destination.name}
                    onChange={(event) => updateDestination(destination.id, "name", event.target.value)}
                    placeholder="Example: Wilsons Promontory, VIC"
                  />
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
                    onChange={(event) =>
                      updateDestination(destination.id, "desirability", Number(event.target.value))
                    }
                  />
                </label>

                <label className="destination-notes">
                  <span>Notes</span>
                  <textarea
                    value={destination.notes}
                    onChange={(event) => updateDestination(destination.id, "notes", event.target.value)}
                    rows={2}
                    placeholder="Optional notes for the stay"
                  />
                </label>
              </div>
            </article>
          ))}
        </div>
      </div>

      <button className="primary-button" type="submit" disabled={isPlanning}>
        {isPlanning ? "Planning route..." : "Build holiday plan"}
      </button>
    </form>
  );
};
