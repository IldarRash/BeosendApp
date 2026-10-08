export interface CourtVenueMapLabels {
  /** A short heading which names the schematic for sighted and screen-reader users. */
  title: string;
  lockers: string;
  entrance: string;
  yourCourt: string;
  otherCourts: string;
  unassigned: string;
  court: (number: number) => string;
}

export interface CourtVenueMapProps {
  /**
   * Court numbers supplied by the caller's server-backed record. The diagram never
   * treats an unhighlighted court as available, occupied, or selectable.
   */
  courtNumbers: ReadonlyArray<number>;
  labels: CourtVenueMapLabels;
  /** Optional caller-owned lifecycle label, such as “Awaiting confirmation”. */
  statusLabel?: string;
}

const COURT_LAYOUT: ReadonlyArray<number | null> = [null, null, 1, 2, 6, 5, 4, 3];

/**
 * A read-only orientation map for the BeoSand venue. Its physical arrangement is
 * deliberate: lockers are at the top-left and the entrance at the bottom centre.
 * The component contains no availability or selection logic.
 */
export function CourtVenueMap({
  courtNumbers,
  labels,
  statusLabel
}: CourtVenueMapProps): JSX.Element {
  const selectedCourts = new Set(courtNumbers.filter((court) => court >= 1 && court <= 6));
  const assigned = selectedCourts.size > 0;
  const selectedList = [...selectedCourts].sort((left, right) => left - right).join(", ");

  return (
    <section className="court-venue-map" aria-label={labels.title}>
      <div className="court-venue-map__header">
        <h2 className="court-venue-map__title">{labels.title}</h2>
        {statusLabel ? <p className="court-venue-map__status">{statusLabel}</p> : null}
      </div>

      <div
        className="court-venue-map__plan"
        role="group"
        aria-label={assigned ? `${labels.title}: ${labels.yourCourt} ${selectedList}` : `${labels.title}: ${labels.unassigned}`}
      >
        <svg aria-hidden="true" className="court-venue-map__boundary" viewBox="0 0 320 220" preserveAspectRatio="none">
          <rect x="3" y="3" width="314" height="214" rx="14" />
          <path d="M14 110h292" />
        </svg>
        <span className="court-venue-map__facility court-venue-map__facility--lockers">
          <svg aria-hidden="true" className="court-venue-map__facility-icon" viewBox="0 0 20 20">
            <rect x="2.5" y="3" width="15" height="14" rx="1.5" />
            <path d="M2.5 8h15M7.5 3v14M12.5 3v14" />
          </svg>
          <span>{labels.lockers}</span>
        </span>
        <div className="court-venue-map__courts">
          {COURT_LAYOUT.map((court, index) =>
            court === null ? (
              <span className="court-venue-map__gap" aria-hidden="true" key={`gap-${index}`} />
            ) : (
              <span
                aria-label={`${labels.court(court)} — ${selectedCourts.has(court) ? labels.yourCourt : labels.otherCourts}`}
                className={selectedCourts.has(court) ? "court-venue-map__court is-selected" : "court-venue-map__court"}
                key={court}
                role="img"
              >
                <svg aria-hidden="true" className="court-venue-map__court-diagram" viewBox="0 0 90 120" preserveAspectRatio="none">
                  <rect x="5" y="4" width="80" height="112" rx="5" />
                  <path d="M5 60h80" />
                </svg>
                <span aria-hidden="true">{court}</span>
                {selectedCourts.has(court) ? (
                  <svg aria-hidden="true" className="court-venue-map__selected-mark" viewBox="0 0 16 16">
                    <path d="m3.2 8.3 2.9 2.8 6.7-6.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
                  </svg>
                ) : null}
              </span>
            )
          )}
        </div>
        <span className="court-venue-map__facility court-venue-map__facility--entrance">
          <svg aria-hidden="true" className="court-venue-map__facility-icon" viewBox="0 0 20 20">
            <path d="M3 17V3h10v14M6 10h10M13 6l4 4-4 4" />
          </svg>
          <span>{labels.entrance}</span>
        </span>
      </div>

      <ul className="court-venue-map__legend" aria-label={labels.title}>
        <li>
          <span className="court-venue-map__legend-mark court-venue-map__legend-mark--selected" aria-hidden="true" />
          {labels.yourCourt}
        </li>
        <li>
          <span className="court-venue-map__legend-mark" aria-hidden="true" />
          {labels.otherCourts}
        </li>
      </ul>
      {!assigned ? <p className="court-venue-map__unassigned">{labels.unassigned}</p> : null}
    </section>
  );
}
