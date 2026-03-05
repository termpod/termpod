export interface QuickAction {
  label: string;
  value: string;
  icon?: string;
}

export interface QuickActionsProps {
  onAction: (value: string) => void;
}

const DEFAULT_ACTIONS: QuickAction[] = [
  { label: 'Ctrl+C', value: '\x03' },
  { label: 'Enter', value: '\r' },
  { label: 'Tab', value: '\t' },
  { label: 'Up', value: '\x1b[A' },
  { label: 'Down', value: '\x1b[B' },
  { label: 'Accept', value: 'y\r' },
  { label: 'Deny', value: 'n\r' },
];

export function QuickActions({ onAction }: QuickActionsProps) {
  return (
    <div className="quick-actions">
      {DEFAULT_ACTIONS.map((action) => (
        <button
          key={action.label}
          onClick={() => onAction(action.value)}
          type="button"
          className="quick-action-btn"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
