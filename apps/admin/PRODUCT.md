# Product

## Register

product

## Users

BeoSand admin is used by school managers and administrators who operate the beach-volleyball
program day to day. They work with schedules, groups, trainers, clients, subscriptions, court
requests, broadcasts, analytics, labels, notification templates, and integrations.

Their context is operational: they need to scan dense information, make accurate decisions, resolve
exceptions, and update records without second-guessing whether the interface is computing domain
state locally. The API remains the source of truth for availability, prices, capacity, waitlists,
payment status, and request decisions.

## Product Purpose

The admin console gives managers a reliable browser workspace for running BeoSand operations. It
exists to make the current state of the school legible, keep operational actions fast, and expose
server-decided facts clearly enough that managers can trust what they see.

Success means managers can maintain schedules, rosters, courts, communications, and client records
with minimal ambiguity, while the UI stays thin over typed API data and shared contracts.

## Brand Personality

Calm, precise, warm.

The admin should feel like a designed operations console rather than a generic template: editorial
enough to be recognizably BeoSand, restrained enough for repeated daily use, and precise enough for
money, capacity, attendance, and availability workflows.

## Anti-references

- Generic SaaS dashboard kits with interchangeable blue/gray cards and decorative metrics.
- Loud sports or fitness interfaces that prioritize energy over operational clarity.
- Telegram-bot-like admin screens that feel like a thin chat wrapper instead of a real console.
- Overly ornamental editorial UI that makes dense tables, forms, and exception queues harder to use.
- Interfaces where the frontend appears to recompute prices, capacity, or availability instead of
  clearly reflecting server-owned state.

## Design Principles

- Serve the task first: density is acceptable when it improves scanning, comparison, and repeated
  operations.
- Make provenance visible: distinguish stored snapshots, server decisions, derived statuses, and
  editable manager inputs when the distinction affects trust.
- Keep domain logic out of the UI: admin screens render validated API state and collect intent; the
  backend owns money, capacity, availability, waitlists, and recompute.
- Preserve BeoSand warmth without softening precision: the visual system can be characterful, but
  tables, controls, and state indicators must remain familiar and predictable.
- Design for exceptions: empty states, conflicts, disabled actions, pending queues, failures, and
  partial data should be explicit rather than hidden behind generic messages.

## Accessibility & Inclusion

Target WCAG 2.1 AA for the admin surface. Keyboard navigation, visible focus, sufficient contrast,
screen-reader labels for controls, and non-color-only status communication are required.

Motion should be short and state-driven, with reduced-motion alternatives. Russian, Serbian, and
English labels must fit within the same layout vocabulary without truncating critical actions or
domain facts.
