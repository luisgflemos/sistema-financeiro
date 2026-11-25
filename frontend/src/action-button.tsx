import { useId } from "react";
import type { LucideIcon } from "lucide-react";
import "./action-button.css";

export function ActionButton({
  label,
  ariaLabel,
  icon: Icon,
  onClick,
  disabled = false,
  disabledReason,
  tone = "default",
  tooltipAlign = "end",
}: {
  label: string;
  ariaLabel?: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
  tone?: "default" | "neutral" | "danger";
  tooltipAlign?: "start" | "end";
}) {
  const tooltipId = useId();
  return (
    <span
      className="row-action"
      data-tone={tone}
      data-disabled={disabled}
      data-tooltip-align={tooltipAlign}
    >
      <button
        type="button"
        className="row-action-button"
        aria-label={ariaLabel ?? label}
        aria-describedby={tooltipId}
        disabled={disabled}
        onClick={onClick}
      >
        <Icon size={18} aria-hidden="true" />
      </button>
      <span id={tooltipId} role="tooltip" className="row-action-tooltip">
        {disabled && disabledReason ? `${label} — ${disabledReason}` : label}
      </span>
    </span>
  );
}
