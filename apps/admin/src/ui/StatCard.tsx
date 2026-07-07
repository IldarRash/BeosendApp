interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
}

/** A single figure in the data-dense dashboard grid. Display only. */
export function StatCard({ label, value, hint }: StatCardProps): JSX.Element {
  return (
    <div className="card stat-card">
      <span className="card__label">{label}</span>
      <span className="card__value">{value}</span>
      {hint ? <span className="card__hint">{hint}</span> : null}
    </div>
  );
}
