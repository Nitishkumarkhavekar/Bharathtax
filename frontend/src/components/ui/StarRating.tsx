import { useState } from "react";
import { Star } from "lucide-react";

export function StarRating({
  value,
  onRate,
  size = 18,
  label,
  disabled,
}: {
  value?: number | null;
  onRate: (n: number) => void;
  size?: number;
  label?: string;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(0);
  const cur = hover || value || 0;
  return (
    <div className="flex items-center gap-0.5">
      {label ? <span className="mr-1 text-xs text-foreground/60">{label}</span> : null}
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onMouseEnter={() => !disabled && setHover(n)}
          onMouseLeave={() => setHover(0)}
          onClick={() => !disabled && onRate(n)}
          className="p-0.5 transition-transform hover:scale-110 disabled:cursor-default disabled:hover:scale-100"
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
        >
          <Star
            size={size}
            className={n <= cur ? "fill-amber-400 text-amber-400" : "text-slate-300"}
          />
        </button>
      ))}
    </div>
  );
}
