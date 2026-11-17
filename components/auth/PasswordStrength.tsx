"use client";

export interface StrengthScore {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

export function evaluatePasswordStrength(password: string): StrengthScore {
  if (!password) return { score: 0, label: "Enter a password" };
  let points = 0;
  if (password.length >= 8) points++;
  if (password.length >= 12) points++;
  if (password.length >= 16) points++;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((r) => r.test(password)).length;
  if (classes >= 2) points++;
  if (classes >= 3) points++;

  const score = Math.min(4, Math.max(1, Math.floor((points * 4) / 5))) as 1 | 2 | 3 | 4;
  const labels: Record<1 | 2 | 3 | 4, string> = {
    1: "Weak",
    2: "Fair",
    3: "Good",
    4: "Strong",
  };
  return { score: password.length < 8 ? 1 : score, label: password.length < 8 ? "Too short (min 8 chars)" : labels[score] };
}

export function PasswordStrength({ password }: { password: string }) {
  const { score, label } = evaluatePasswordStrength(password);
  const colors = ["bg-muted", "bg-destructive", "bg-warning", "bg-primary", "bg-success"];
  return (
    <div className="space-y-1" aria-live="polite">
      <div className="grid grid-cols-4 gap-1.5">
        {[1, 2, 3, 4].map((step) => (
          <div
            key={step}
            className={`h-1.5 rounded-full transition-colors ${score >= step ? colors[score] : "bg-muted"}`}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Strength: {label}</p>
    </div>
  );
}
