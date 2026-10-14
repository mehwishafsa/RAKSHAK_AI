import type { ReactNode } from "react";
import { AlertOctagon, AlertTriangle, CheckCircle2, MinusCircle } from "lucide-react";
import type { DetectionRisk } from "../types";
import { RISK_TONE } from "../lib/format";

export type Tone = "good" | "warn" | "crit" | "info" | "faint" | "accent";

const TONE_CLASSES: Record<Tone, string> = {
  good: "border-good/40 bg-good/10 text-good",
  warn: "border-warn/45 bg-warn/10 text-warn",
  crit: "border-crit/50 bg-crit/15 text-crit",
  info: "border-info/40 bg-info/10 text-info",
  faint: "border-line bg-raised text-muted",
  accent: "border-accent/40 bg-accent/10 text-accent",
};

export function Pill({
  tone,
  children,
  icon,
  size = "sm",
  className = "",
  title,
}: {
  tone: Tone;
  children: ReactNode;
  icon?: ReactNode;
  size?: "xs" | "sm" | "lg";
  className?: string;
  title?: string;
}) {
  const sizing =
    size === "lg" ? "gap-2 px-3 py-1.5 text-sm" : size === "xs" ? "gap-1 px-1.5 py-0.5 text-[10px]" : "gap-1.5 px-2 py-0.5 text-xs";
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-full border font-semibold uppercase tracking-wide ${sizing} ${TONE_CLASSES[tone]} ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}

const RISK_ICON: Record<DetectionRisk, typeof CheckCircle2> = {
  LOW: CheckCircle2,
  MEDIUM: AlertTriangle,
  CRITICAL: AlertOctagon,
  OFFLINE: MinusCircle,
};

const RISK_TEXT: Record<DetectionRisk, string> = {
  LOW: "Low risk",
  MEDIUM: "Medium risk",
  CRITICAL: "Critical",
  OFFLINE: "Detection paused",
};

export function RiskPill({ risk, size = "sm" }: { risk: DetectionRisk; size?: "xs" | "sm" | "lg" }) {
  const Icon = RISK_ICON[risk];
  const px = size === "lg" ? 16 : 12;
  return (
    <Pill
      tone={RISK_TONE[risk]}
      size={size}
      icon={<Icon size={px} aria-hidden />}
      className={risk === "CRITICAL" ? "motion-safe:animate-pulsering" : ""}
    >
      {RISK_TEXT[risk]}
    </Pill>
  );
}
