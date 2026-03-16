import type { DailyPlan, TripPlan } from "../types";

type ItineraryPanelProps = {
  onClearSelection: () => void;
  plan: TripPlan | null;
  selectedDayNumber: number | null;
  onSelectDay: (day: DailyPlan) => void;
};

const formatBadge = (value: string) => <span className="pill">{value}</span>;

export const ItineraryPanel = ({ onClearSelection, plan, selectedDayNumber, onSelectDay }: ItineraryPanelProps) => {
  if (!plan) {
    return (
      <section className="itinerary-panel placeholder-panel">
        <p className="eyebrow">Itinerary</p>
        <h2>Daily travel list</h2>
        <p>The daily breakdown will appear here once the route is planned.</p>
      </section>
    );
  }

  return (
    <section className="itinerary-panel">
      <div className="panel-heading with-metrics">
        <div>
          <p className="eyebrow">Itinerary</p>
          <h2>{plan.totalHolidayDays} planned days</h2>
        </div>
        <div className="metric-strip">
          <article>
            <span>Total drive</span>
            <strong>{plan.totalDriveHours}h</strong>
          </article>
          <article>
            <span>Distance</span>
            <strong>{plan.totalDistanceKm} km</strong>
          </article>
          <article>
            <span>Fuel</span>
            <strong>{plan.totalFuelLitres} L</strong>
          </article>
        </div>
      </div>

      <div className="plan-summary-row">
        <div>{formatBadge(`${plan.selectedDestinations.length} selected destinations`)}</div>
        <div>{formatBadge(`${plan.totalStayDays} stay days`)}</div>
        <div>{formatBadge(`${plan.optimizationMode} optimizer`)}</div>
      </div>

      <div className="daily-list">
        {plan.dailyPlans.map((day) => (
          <article className={`day-card ${selectedDayNumber === day.dayNumber ? "selected" : ""}`} key={day.dayNumber}>
            <div className="day-card-header">
              <button className="day-card-summary" onClick={() => (selectedDayNumber === day.dayNumber ? onClearSelection() : onSelectDay(day))} type="button">
                <div>
                  <p className="day-label">Day {day.dayNumber}</p>
                  <h3>{day.title}</h3>
                </div>
                <span className={`kind-badge ${day.kind}`}>{day.kind}</span>
              </button>
              <div className="day-card-header-actions">
                <button
                  className="ghost-button neutral-button"
                  onClick={() => (selectedDayNumber === day.dayNumber ? onClearSelection() : onSelectDay(day))}
                  type="button"
                >
                  {selectedDayNumber === day.dayNumber ? "Collapse" : "Expand"}
                </button>
              </div>
            </div>

            {selectedDayNumber === day.dayNumber ? (
              <div className="day-card-body">
                {day.kind === "drive" ? (
                  <div className="day-metrics">
                    <span>{day.driveHours}h driving</span>
                    <span>{day.distanceKm} km</span>
                    <span>{day.fuelUsedLitres} L fuel</span>
                    <span>{day.cumulativeFuelUsedLitres} L trip total</span>
                    <span>{day.refuelStops} refuels</span>
                  </div>
                ) : (
                  <div className="day-metrics">
                    <span>Non-driving day</span>
                    <span>{day.cumulativeFuelUsedLitres} L trip total</span>
                  </div>
                )}

                {day.notes.length > 0 ? (
                  <div className="detail-block">
                    {day.notes.map((note) => (
                      <p key={note}>{note}</p>
                    ))}
                  </div>
                ) : null}

                {day.fuelStops.length > 0 ? (
                  <div className="detail-block">
                    <strong>Suggested fuel stops</strong>
                    {day.fuelStops.map((fuelStop) => (
                      <div className="list-row" key={fuelStop.id}>
                        <span>{fuelStop.name}</span>
                        <span>
                          {fuelStop.distanceFromDayStartKm} km into the day · about {fuelStop.driveHoursFromDayStart}h
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {day.campsites.length > 0 ? (
                  <div className="detail-block">
                    <strong>Stay options near the overnight stop</strong>
                    {day.campsites.map((campsite) => (
                      <a className="list-row" href={campsite.osmUrl} key={campsite.osmUrl} rel="noreferrer" target="_blank">
                        <span>{campsite.name}</span>
                        <span>
                          {campsite.freeCamp ? "Free-camp favoured" : "Paid or unknown"} · {campsite.distanceKm.toFixed(1)} km
                        </span>
                      </a>
                    ))}
                  </div>
                ) : null}

                {day.pois.length > 0 ? (
                  <div className="detail-block">
                    <strong>Points of interest on this day</strong>
                    {day.pois.map((poi) => (
                      <a className="list-row" href={poi.osmUrl} key={poi.osmUrl} rel="noreferrer" target="_blank">
                        <span>{poi.name}</span>
                        <span>
                          {poi.category} · {poi.distanceFromRouteKm.toFixed(1)} km off route
                        </span>
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
};
