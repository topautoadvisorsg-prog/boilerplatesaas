import { cn } from "@/lib/utils";

export interface AvatarProps {
  name?: string | null;
  email?: string | null;
  src?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-xs",
  lg: "h-12 w-12 text-sm",
};

function initials(name: string | null | undefined, email: string | null | undefined): string {
  if (name && name.trim()) {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0])
      .join("")
      .toUpperCase();
  }
  if (email) return email[0]?.toUpperCase() ?? "?";
  return "?";
}

// Stable color from input string (8 picks).
function colorFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const palette = [
    "bg-orange-500/20 text-orange-300",
    "bg-emerald-500/20 text-emerald-300",
    "bg-blue-500/20 text-blue-300",
    "bg-pink-500/20 text-pink-300",
    "bg-violet-500/20 text-violet-300",
    "bg-amber-500/20 text-amber-300",
    "bg-cyan-500/20 text-cyan-300",
    "bg-rose-500/20 text-rose-300",
  ];
  return palette[Math.abs(h) % palette.length] ?? palette[0]!;
}

export function Avatar({ name, email, src, size = "md", className }: AvatarProps) {
  const seed = name ?? email ?? "?";
  const color = colorFor(seed);
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-semibold ring-1 ring-border overflow-hidden shrink-0",
        sizeClasses[size],
        !src && color,
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name ?? email ?? ""} className="h-full w-full object-cover" />
      ) : (
        initials(name, email)
      )}
    </span>
  );
}
