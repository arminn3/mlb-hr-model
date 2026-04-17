import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4">
      {Icon && (
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center mb-4"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <Icon size={22} className="text-muted" />
        </div>
      )}
      <h4 className="text-[14px] leading-[20px] font-semibold text-foreground">
        {title}
      </h4>
      {description && (
        <p className="text-[12px] leading-[16px] font-medium text-muted mt-1.5 max-w-sm">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
