# Turkish Support Services — Design System

## 1. Purpose

This document defines the visual and UI rules for Turkish Support Services (TSS) products.

The goal is to ensure that AI-generated interfaces remain consistent with the TSS brand and do not introduce generic SaaS/dashboard visual patterns that are not part of the brand.

These rules are mandatory unless a specific product requirement explicitly requires an exception.

---

# 2. Brand Foundations

## 2.1 Brand Colors

The brand color hierarchy is fixed and must never be reordered or reweighted.

### Primary

`#C90C0F` — Primary Red

- Permanent dominant brand color.
- Must always be present in the overall product experience.
- Used for primary CTAs and important interactive elements.
- Should visually lead the interface.

### Secondary

`#EC5F43` — Coral

- Secondary emphasis.
- Supporting actions.
- May be used for secondary action buttons.

### Accent

`#B1F1A7` — Mint

- Success surfaces.
- Light status indicators.
- Positive or completed states.
- Light accent areas.

### Neutral Accent

`#F8EFC6` — Cream

- Warm backgrounds.
- Light surfaces.
- Subtle highlighted areas.

### Deep Accent

`#458553` — Forest Green

- Positive/success states.
- Strong status indicators.
- Secondary deep accent.

### Color Rules

- Primary red must remain the dominant brand color.
- Coral is the only additional brand color permitted for action buttons.
- Mint, cream and forest green must not become dominant page backgrounds.
- Do not introduce additional brand colors.
- Do not randomly recolor components for visual variety.
- Do not use gradients.
- Do not use neon colors.
- Do not use purple, blue or other generic SaaS accent colors unless explicitly required by a future product specification.

---

# 3. Neutral Colors

Use a warm-tinted oklch gray scale rather than a pure neutral gray scale.

The neutral palette should visually complement the primary red.

Use neutrals for:

- Page backgrounds
- Cards
- Borders
- Dividers
- Body text
- Secondary text
- Disabled states

Avoid excessive pure black/white usage when a suitable neutral token exists.

---

# 4. Typography

## Font

Use **Outfit** as the only typeface.

Do not introduce another font family.

### Weights

- `400` — body text
- `500` — secondary UI text when needed
- `600` — labels, buttons, navigation
- `700` — headings
- `800` — major headings

### Typography Rules

- Headings should use 700–800.
- Body text should primarily use 400.
- Buttons and UI labels should use 600.
- Avoid excessive font-weight variation.
- Do not use serif typography.
- Do not introduce another font for numbers, tables or special sections.

---

# 5. Spacing

Use a 4px base spacing system.

Preferred spacing values:

`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64px`

Do not introduce arbitrary spacing values unless technically necessary.

Maintain consistent spacing between:

- Page sections
- Form fields
- Cards
- Table rows
- Navigation items
- Buttons
- Labels and inputs

Prefer whitespace and alignment over decorative elements.

---

# 6. Shape and Radius

Use the following radius hierarchy:

- `6px` — inputs and small controls
- `10px` — buttons and standard cards
- `16px` — large surfaces
- `9999px` / full pill — badges and tags

Do not use excessive rounding.

Avoid:

- 24px+ radius on standard cards
- Fully rounded dashboard panels
- Randomly mixed radius values

The interface should feel structured and operational rather than playful.

---

# 7. Shadows

Use only two shadow levels:

- `shadow-sm` — resting cards
- `shadow-md` — elevated/overlay elements

Do not use:

- Colored shadows
- Glow effects
- Neon shadows
- Heavy dramatic shadows
- Multiple competing shadow styles

---

# 8. Motion

Motion should be minimal and functional.

Default interaction transition:

`0.15s`

Allowed:

- Button hover brightness change
- Small state transitions
- Basic modal/dropdown transitions when useful

Avoid:

- Bounce animations
- Excessive scaling
- Parallax
- Decorative animations
- Continuous motion
- Animated gradients

The product is an operational/support interface, not a marketing landing page.

---

# 9. Logo

## Light Background

Use:

`logo-black.png`

## Dark / Brand Background

Use:

`logo-white.png`

The white logo may be used on:

- Primary red
- Forest green
- Black

Always preserve sufficient clear space around the logo.

Never:

- Recolor the wordmark
- Stretch the logo
- Distort proportions
- Add effects
- Add glow
- Place the logo inside unnecessary decorative containers

---

# 10. Iconography

No official icon set has been provided.

If icons are required, use a neutral stroke-based icon system such as Lucide or Heroicons.

Icons must:

- Have a consistent visual weight.
- Support the interface rather than dominate it.
- Be used only when they improve comprehension.

Do not invent custom decorative icons.

Do not add icons to every button or label simply for visual decoration.

If an external icon set is introduced, treat it as a functional substitution rather than a new part of the TSS brand identity.

---

# 11. Product UI Direction

The TSS interface is primarily an operational/business application.

The visual language should therefore prioritize:

1. Clarity
2. Information density
3. Fast navigation
4. Readability
5. Consistency
6. Functional hierarchy

The interface should feel like a professional internal operations system.

It should not feel like:

- A marketing website
- A cryptocurrency dashboard
- A generic AI SaaS product
- A glassmorphism template
- A futuristic concept UI
- A consumer social media application

---

# 12. Dashboard and Operational Interfaces

When creating dashboards, prioritize the information users need to make operational decisions.

Typical UI patterns may include:

- Sidebar navigation
- Top navigation/header
- KPI cards
- Data tables
- Search
- Filters
- Forms
- Tabs
- Status badges
- Modals
- Dropdowns
- Pagination
- Empty states
- Loading states
- Error states
- Toast notifications

These are not mandatory components.

**Do not create components simply because they are listed here.**

Before adding a component, determine whether the product workflow actually requires it.

---

# 13. Component Rules

The existing core component inventory is:

- Button
- Badge
- Card
- Input
- Tabs

Additional components may be introduced when real product screens require them.

When creating a new component:

1. Check whether an existing component can solve the problem.
2. Reuse existing tokens.
3. Follow the established color hierarchy.
4. Follow the established spacing and radius rules.
5. Avoid creating one-off visual patterns.
6. Do not create unnecessary variants.

Components should be reusable and consistent rather than individually styled.

---

# 14. Buttons

### Primary Button

Use:

`#C90C0F`

for the primary action.

Examples:

- Save
- Create
- Confirm
- Assign
- Submit

### Secondary Button

Use:

`#EC5F43`

when a secondary action needs a colored button.

### Neutral Button

Neutral styling may be used for:

- Cancel
- Back
- Close
- Secondary utility actions

### Button Rules

- Do not use mint, cream or forest green as standard action-button colors.
- Do not create gradient buttons.
- Do not use excessive pill-shaped buttons.
- Primary actions should remain visually obvious.

---

# 15. Cards

Cards should organize related information.

Use:

- `10px` radius for standard cards
- `shadow-sm` for resting cards
- Consistent internal spacing

Cards should not be used simply to create visual decoration.

Avoid:

- Cards inside cards without a clear information hierarchy
- Excessive nesting
- Huge empty cards
- Decorative card layouts

---

# 16. Forms and Inputs

Inputs should use:

- `6px` radius
- Clear labels
- Consistent spacing
- Clear focus states
- Accessible contrast

Forms should prioritize efficiency.

Avoid unnecessary:

- Decorative illustrations
- Excessive helper text
- Floating labels when they reduce clarity
- Multiple unnecessary steps

---

# 17. Tables and Operational Data

When displaying operational data, prefer tables over visually decorative layouts when the user needs to compare multiple records.

Tables should prioritize:

- Clear column hierarchy
- Readability
- Sorting when useful
- Filtering when useful
- Consistent row spacing
- Status visibility
- Efficient scanning

Do not turn every dataset into cards.

For dense operational data, a well-structured table is preferred.

---

# 18. Status and Semantic Colors

Use brand colors semantically.

### Success

Prefer:

- Mint for light success surfaces
- Forest green for strong success indicators

### Warning / Attention

Use the existing warm brand palette carefully.

Do not introduce arbitrary yellow/orange palettes unless required by the product.

### Error / Critical

Use the primary red carefully when communicating errors or critical states.

Do not make every error element visually dominant.

---

# 19. Layout

Use a clear hierarchy:

```text
Application Shell
├── Sidebar / Navigation
├── Header
└── Main Content
    ├── Page Header
    ├── Filters / Actions
    ├── Main Content
    └── Supporting Information
```

Exact layout may change according to the product screen.

Do not force every page into the same structure when the workflow requires a different layout.

Desktop usage should be prioritized for operational interfaces unless mobile support is explicitly required.

---

# 20. Visual Restraint

The interface should look intentionally designed, not decorated.

Do not add visual elements simply to make a screen appear more "modern".

Avoid:

- Gradients
- Glassmorphism
- Excessive blur
- Glow
- Neon effects
- Floating decorative shapes
- Random illustrations
- Excessive emojis
- Huge rounded containers
- Excessive animations
- Unnecessary icons
- Random accent colors
- Generic AI/SaaS visual patterns

When in doubt, prefer the simpler solution.

---

# 21. AI Implementation Rules

When generating UI code from this design system:

### MUST

- Follow the color hierarchy exactly.
- Use Outfit.
- Reuse design tokens.
- Preserve logo proportions.
- Reuse existing components.
- Maintain consistent spacing and radius.
- Prioritize usability and information hierarchy.
- Analyze the actual user workflow before introducing new components.
- Keep the interface visually restrained.

### MUST NOT

- Invent a new visual identity.
- Introduce new brand colors.
- Change the primary color hierarchy.
- Add gradients.
- Add glassmorphism.
- Add glow effects.
- Add excessive rounded corners.
- Add decorative illustrations without a clear product reason.
- Add unnecessary icons.
- Add generic "modern SaaS" patterns.
- Add UI elements solely to make the interface look more impressive.
- Replace functional clarity with visual decoration.

---

# 22. Decision Rule for Ambiguous Cases

When a design decision is not explicitly defined in this document:

1. Prefer consistency with existing rules.
2. Prefer simplicity.
3. Prefer usability.
4. Prefer reuse over introducing a new pattern.
5. Prefer the primary brand hierarchy over decorative alternatives.
6. Do not invent new visual styles without a product requirement.

**The AI should make the smallest reasonable design decision rather than expanding the design system unnecessarily.**

---

# 23. Core Principle

> **The AI writes the code. It does not redefine the brand.**

The final interface should look like a TSS product that was implemented with AI assistance — not like a generic AI-generated dashboard.