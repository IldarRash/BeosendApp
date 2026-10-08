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
        <span className="court-venue-map__facility court-venue-map__facility--lockers">{labels.lockers}</span>
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
        <span className="court-venue-map__facility court-venue-map__facility--entrance">{labels.entrance}</span>
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
