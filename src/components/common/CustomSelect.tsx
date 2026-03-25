import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface CustomSelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface CustomSelectProps {
  id?: string;
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  buttonClassName?: string;
  menuClassName?: string;
  showSelectedHint?: boolean;
  menuPlacement?: 'top' | 'bottom';
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  id,
  value,
  options,
  onChange,
  placeholder = 'Select an option',
  disabled = false,
  ariaLabel,
  ariaLabelledBy,
  buttonClassName = '',
  menuClassName = '',
  showSelectedHint = true,
  menuPlacement = 'bottom',
}) => {
  const generatedId = useId();
  const selectId = id || `custom-select-${generatedId}`;
  const listboxId = `${selectId}-listbox`;
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value]
  );

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        id={selectId}
        type="button"
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setIsOpen((previous) => !previous);
          }
        }}
        className={`flex w-full items-center justify-between gap-3 rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-left text-sm text-gray-900 shadow-sm transition-colors hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-70 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-gray-500 ${buttonClassName}`}
      >
        <span className="min-w-0">
          <span className={`block truncate ${selectedOption ? '' : 'text-gray-400 dark:text-gray-500'}`}>
            {selectedOption?.label || placeholder}
          </span>
          {showSelectedHint && selectedOption?.hint && (
            <span className="mt-0.5 block truncate text-xs text-gray-500 dark:text-gray-400">
              {selectedOption.hint}
            </span>
          )}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-gray-500 transition-transform dark:text-gray-400 ${isOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 7.5l5 5 5-5" />
        </svg>
      </button>

      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-labelledby={ariaLabelledBy}
          className={`absolute z-30 max-h-72 w-full overflow-y-auto rounded-2xl border border-gray-200 bg-white p-1.5 shadow-2xl shadow-gray-200/70 dark:border-gray-700 dark:bg-gray-900 dark:shadow-black/30 ${
            menuPlacement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
          } ${menuClassName}`}
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                  isSelected
                    ? 'bg-blue-50 text-blue-900 dark:bg-blue-950/50 dark:text-blue-100'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{option.label}</span>
                  {option.hint && (
                    <span className="mt-0.5 block truncate text-xs text-gray-500 dark:text-gray-400">
                      {option.hint}
                    </span>
                  )}
                </span>
                {isSelected && (
                  <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 10.5l3 3 7-7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
