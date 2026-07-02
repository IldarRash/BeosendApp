---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when building apps/admin components, pages, or the design system. Generates creative, polished code that avoids generic AI aesthetics.
license: Complete terms in LICENSE
---

> **Adapted for BeoSand.** This skill is derived from Anthropic's official `frontend-design` skill
> (Apache-2.0, see `LICENSE`); a BeoSand context section was added and this notice marks the change.
> The aesthetic guidance below is unmodified.

## BeoSand context

You are designing the **apps/admin** console (React + Vite) for the BeoSand booking system.

- **Direction:** refined, utilitarian, **data-dense** — calm, fast to scan, legible. Bold here means
  *intentional and distinctive*, not loud. (For a marketing page the direction could differ; for this
  admin tool, restraint and clarity win.)
- Reuse the design system in `apps/admin/src/ui/*` (`theme.css` tokens, shared components). Add tokens
  rather than one-off values.
- UI strings are **Russian** (Serbian where the product uses it). Money is **RSD**, whole dinars,
  display-only via the shared formatter — never compute price/availability in the frontend.
- Data comes from `apps/api`, validated against `@beosand/types`; design components against those
  shapes. Hand domain wiring to `frontend-implementer`. Accessibility (semantics, focus, contrast,
  `aria-*`) is part of done.

## Designer protocol

Adapt the OpenAI frontend-skill guidance from
https://developers.openai.com/blog/designing-delightful-frontends-with-gpt-5-4 for BeoSand. Use the
principles, not copied text.

Before proposing or editing UI, write down three compact decisions for yourself:

- **Visual thesis:** mood, material, density, and energy of the screen.
- **Content plan:** the primary workspace, supporting context, detail/inspection area, and final
  action.
- **Interaction thesis:** 2-3 motion or state-change ideas that improve orientation, affordance, or
  hierarchy.

For BeoSand app/admin surfaces:

- Start with the working surface itself: tables, grids, filters, status, calendars, queues, or task
  context. Do not add a marketing hero unless the user explicitly asks for one.
- Default to calm, Linear-style restraint: dense but readable information, strong spacing,
  restrained color, minimal chrome, and one clear accent for action or state.
- Prefer layout over card mosaics. Use cards only when the card is the interaction or a repeated
  entity that needs a boundary.
- Use utility copy over marketing copy. Headings should name the area or action; supporting text
  should explain scope, freshness, behavior, or decision value in one sentence.
- Keep every section to one job and one primary takeaway. If an area does not help someone operate,
  monitor, compare, or decide, remove it.
- Motion should clarify hierarchy or state. Use small, fast transitions for hover, selection,
  filtering, drawers, modals, and row expansion; remove ornamental motion.
- Protect layout safety: fixed, sticky, floating, animated, or decorative layers must not overlap
  text, controls, tables, or tap targets on desktop or mobile.

Litmus checks before handing off:

- Can an operator understand the screen by scanning headings, labels, values, and selected states?
- Is there one primary workspace and one obvious next action?
- Are cards, borders, shadows, and backgrounds necessary for understanding or interaction?
- Does the design still work when decorative effects are removed?
- Does every interactive state fit and remain tappable on mobile?

---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics; unexpected, characterful font choices. Pair a distinctive display font with a refined body font.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.

NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices (Space Grotesk, for example) across generations.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

Remember: Claude is capable of extraordinary creative work. Don't hold back, show what can truly be created when thinking outside the box and committing fully to a distinctive vision.
