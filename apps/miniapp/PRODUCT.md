# Product

## Register

product

## Users

Clients of the BeoSand sports school use the Telegram Mini App, usually on a phone, to browse their schedule, manage training bookings, follow waitlist positions, and review court rentals. They need to understand what is booked, pending, completed, rejected, or cancelled without learning internal operational terminology.

## Product Purpose

The Mini App gives each client a reliable, private view of their relationship with the school: available activities, confirmed participation, personal history, and current requests. Success means the user can find the relevant record quickly, understand its status, and take only the actions the server permits.

## Brand Personality

Calm, clear, reliable. The interface should feel native to Telegram and focused on the user's immediate task rather than behaving like a promotional website.

## Anti-references

- Marketing landing-page layouts, decorative hero sections, and promotional copy inside task flows.
- Ornamental card mosaics, gratuitous gradients, or motion that competes with booking and status information.
- Ambiguous custom controls or color-only statuses that make familiar actions harder to recognize.
- Dense internal terminology, raw backend labels, or visual treatments that imply unavailable actions.

## Design Principles

- Put the current task and record state first; decoration must never compete with dates, times, status, or next actions.
- Keep familiar Telegram and mobile-product interaction patterns so users do not need to relearn standard controls.
- Let the server own permissions, money, availability, and lifecycle decisions; the interface explains validated state faithfully.
- Use one consistent vocabulary for training, waitlist, rental, history, loading, error, and empty states across screens.
- Preserve trust through caller-owned data, explicit status labels, predictable navigation, and safe read-only presentation where no action exists.

## Accessibility & Inclusion

Target WCAG 2.1 AA. Text and controls require sufficient contrast, status must never be conveyed by color alone, touch targets must remain usable on compact mobile screens, and motion must respect `prefers-reduced-motion`. Loading, error, and empty states must be announced and understandable without visual inference.
