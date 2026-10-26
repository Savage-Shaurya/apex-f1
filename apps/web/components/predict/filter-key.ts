/** The parts of a keyboard event the driver filter needs (a React KeyboardEvent satisfies it). */
export interface FilterKeyEvent {
  key: string;
  preventDefault(): void;
  stopPropagation(): void;
}

/**
 * Keys in the driver sheet's filter box. The box sits inside the picks form,
 * so Enter must pick the highlighted driver and never reach the form (an
 * unhandled Enter in a text field submits it and starts the save flow:
 * R3-CLICK-2). Escape closes; ArrowDown moves into the grid.
 */
export function handleFilterKey(
  event: FilterKeyEvent,
  { active, pick, close, focusTile }: { active: string | null; pick: (id: string) => void; close: () => void; focusTile: (id: string) => void },
): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    if (active) pick(active);
    return;
  }
  if (event.key === 'ArrowDown' && active) {
    event.preventDefault();
    focusTile(active);
  }
}
