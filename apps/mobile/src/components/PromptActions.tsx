import type { DetectedPrompt } from '@termpod/shared';

interface PromptActionsProps {
  prompt: DetectedPrompt;
  onAccept: () => void;
  onDeny: () => void;
}

export function PromptActions({ prompt, onAccept, onDeny }: PromptActionsProps) {
  return (
    <div className="prompt-actions">
      <div className="prompt-info">
        <span className="prompt-tool">{prompt.tool}</span>
        <span className="prompt-detail">{prompt.detail}</span>
      </div>
      <div className="prompt-buttons">
        <button className="prompt-btn prompt-deny" onClick={onDeny}>
          Deny
        </button>
        <button className="prompt-btn prompt-accept" onClick={onAccept}>
          Accept
        </button>
      </div>
    </div>
  );
}
