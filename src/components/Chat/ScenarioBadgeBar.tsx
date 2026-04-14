import React from 'react';
import { ScenarioId } from '../../types';

export interface ScenarioOption {
  id: ScenarioId;
  label: string;
  description?: string;
}

interface ScenarioBadgeBarProps {
  scenarios: ScenarioOption[];
  activeScenarioId?: ScenarioId;
  onSelect: (scenarioId: ScenarioId) => void;
  disabled?: boolean;
}

export const ScenarioBadgeBar: React.FC<ScenarioBadgeBarProps> = ({
  scenarios,
  activeScenarioId,
  onSelect,
  disabled = false,
}) => {
  if (scenarios.length === 0) {
    return null;
  }

  return (
    <div className="px-4 pt-3 md:px-8">
      <div className="flex flex-wrap gap-2">
        {scenarios.map((scenario) => {
          const isActive = scenario.id === activeScenarioId;
          return (
            <button
              key={scenario.id}
              type="button"
              disabled={disabled}
              title={scenario.description || scenario.label}
              onClick={() => onSelect(scenario.id)}
              className={[
                "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] transition-colors",
                disabled ? "cursor-not-allowed opacity-60" : "hover:border-blue-300 hover:text-blue-700",
                isActive
                  ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-200"
                  : "border-gray-200 bg-white/90 text-gray-500 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300",
              ].join(" ")}
            >
              {scenario.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
