import type { PlannerLogEntry } from "../types";

type ActivityLogPanelProps = {
  isPlanning: boolean;
  logEntries: PlannerLogEntry[];
};

export const ActivityLogPanel = ({ isPlanning, logEntries }: ActivityLogPanelProps) => {
  const visibleEntries = [...logEntries].reverse();

  return (
    <details className="activity-panel" open={isPlanning || logEntries.length < 6}>
      <summary>
        <div>
          <p className="eyebrow">Planner log</p>
          <h2>Running activity</h2>
        </div>
        <span className={`log-status ${isPlanning ? "live" : "idle"}`}>{isPlanning ? "Live" : `${logEntries.length} events`}</span>
      </summary>

      <div className="activity-list">
        {visibleEntries.length === 0 ? <p className="subtle-copy">Planner events will appear here as soon as the route starts building.</p> : null}

        {visibleEntries.map((entry) => (
          <article className="activity-entry" key={entry.id}>
            <div className="activity-entry-header">
              <strong>{entry.message}</strong>
              <span>{entry.timestamp}</span>
            </div>
            <p>{entry.stage}</p>
          </article>
        ))}
      </div>
    </details>
  );
};