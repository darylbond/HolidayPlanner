import { useEffect, useMemo, useRef } from "react";
import type { PlannerLogEntry } from "../types";

type ActivityLogPanelProps = {
  isPlanning: boolean;
  logEntries: PlannerLogEntry[];
};

export const ActivityLogPanel = ({ isPlanning, logEntries }: ActivityLogPanelProps) => {
  const consoleRef = useRef<HTMLTextAreaElement | null>(null);
  const consoleText = useMemo(
    () =>
      logEntries
        .map((entry) => `${entry.timestamp} [${entry.stage.toUpperCase()}] ${entry.message}`)
        .join("\n"),
    [logEntries],
  );

  useEffect(() => {
    if (!consoleRef.current) {
      return;
    }

    consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [consoleText]);

  return (
    <details className="activity-panel" open={isPlanning || logEntries.length < 6}>
      <summary>
        <div>
          <p className="eyebrow">Planner log</p>
          <h2>Running activity</h2>
        </div>
        <span className={`log-status ${isPlanning ? "live" : "idle"}`}>{isPlanning ? "Live" : `${logEntries.length} events`}</span>
      </summary>

      <div className="activity-console-wrap">
        <textarea
          className="activity-console"
          placeholder="Planner events will appear here as soon as the route starts building."
          readOnly
          ref={consoleRef}
          value={consoleText}
        />
      </div>
    </details>
  );
};