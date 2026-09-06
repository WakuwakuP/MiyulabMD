export function cycleMenuIndex(
  value: number,
  delta: number,
  length: number,
): number {
  return (value + delta + length) % length;
}

export function handleCommandMenuKey(
  event: KeyboardEvent,
  options: {
    itemCount: number;
    hasItem: boolean;
    onCycle: (next: (value: number) => number) => void;
    onEnter: () => void;
    onEscape: () => void;
  },
): void {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    options.onCycle((value) => cycleMenuIndex(value, 1, options.itemCount));
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    options.onCycle((value) => cycleMenuIndex(value, -1, options.itemCount));
    return;
  }
  if (event.key === "Enter") {
    if (!options.hasItem) {
      return;
    }
    event.preventDefault();
    options.onEnter();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    options.onEscape();
  }
}
