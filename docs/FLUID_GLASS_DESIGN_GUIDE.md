# Fluid Glass — design guide for building apps

A portable spec for the calm, Apple-like "liquid glass" look used in the Budget and Bets apps
(web: React + CSS; Android: Jetpack Compose). Hand this to any agent building a new app in the same
family. Values are exact; swap the brand colours in §3 for a new app, keep everything else.

> **The feel in one sentence:** a calm, bright field where content floats on frosted glass, and
> everything you touch answers with a short, soft spring.

---

## 1. Principles

1. **Content floats on glass; the page is a soft field.** Cards, sheets, menus, nav and the top bar
   are translucent, blurred glass over a slowly drifting ambient backdrop. Nothing sits on flat white.
2. **Separate with space and tone, never lines.** No borders or dividers inside cards. A 1px inner
   highlight, a faint hairline ring and a diffuse shadow define each surface. Rows are separated by
   rhythm (12px), not rules.
3. **One accent per view.** Only the primary action (Add / Save) is the saturated accent colour.
   Selection is a **raised neutral thumb**, never a blue fill, stripe or bar. Links are secondary ink.
4. **Fewer words.** Show what the user scans for; put details one tap away. No explanatory captions
   under toggles or settings ("I know what that is"). Labels are nouns, not sentences.
5. **Short, springy, interruptible motion.** 150–350 ms for interaction. Springs for anything that
   arrives or follows a finger. Every animation can be interrupted, and all of it turns off with
   reduced motion.
6. **Colour is never the only signal.** Signed numbers keep their sign (`+$10`, `−$11.50` with a real
   minus U+2212), statuses keep their word, coloured markers sit next to a text label.
7. **Calm voice.** Short, factual, no hype, no exclamation marks, no celebration or blame.

## 2. Anti-patterns (what reads as "vibe coded" — never do these)

- Coloured **left-edge bars/stripes** on selected or highlighted rows/cards.
- Gradient text, neon/glow borders, glowing shadows (especially in dark mode), emoji in UI.
- Explanatory captions under every toggle; badge/pill clutter on every row.
- Hard-edged sticky headers that cut content at a line; drop shadows under the top bar.
- Blue-filled selected states, multiple competing accent buttons on one screen.
- Animating `filter: blur()` or a blur radius every frame; fading a parent of blurred content
  (see §9 — the blur snaps on at the end).
- Every card a different colour; rainbow category palettes used for text.
- Dividers between every list row.

## 3. Colour tokens (default brand — swap per app)

| Token | Light | Dark | Role |
|---|---|---|---|
| `ink` | `#08204F` | `#F5F8FF` | primary text |
| `ink-2` | `#415373` | `#C2CEE2` | secondary text, links, inactive nav |
| `ink-3` | `#63718A` | `#91A2BF` | metadata, micro labels |
| `page` | `#F4F6FB` | `#0A1122` | page base under the backdrop |
| `card` (opaque fallback) | `#FFFFFF` | `#0A1122` | glass fallback |
| `accent` | `#1059FC` | `#4A82FF` | the one action colour, focus ring |
| `accent-pressed` | `#0A45CC` | `#7BA3FF` | pressed / hover primary |
| `on-accent` | `#FFFFFF` | `#0A1122` | label on accent (navy in dark: white fails contrast) |
| `good` | `#15803D` | `#4ADE80` | positive values / status |
| `bad` | `#DC2626` | `#FF8585` | negative values / status |
| `warn` | `#B45309` | `#F2A93B` | warnings |
| `scrim` | `rgba(8,32,79,.28)` | `rgba(0,0,0,.5)` | behind sheets |

Rules: dark mode has its **own** good/bad (light values fail on navy). Categorical colours (e.g.
category or sportsbook markers) are graphics only, each ≥ 3:1 on both page colours, always paired
with a text label; never used as text colour.

## 4. Typography

Fonts bundled locally (no network fonts): **Inter** for UI, **Barlow Condensed 600 uppercase** for
display titles only. Icons: **Lucide**, 24px grid, stroke **1.75**, round caps.

| Role | Font | Size / line | Weight | Tracking |
|---|---|---|---|---|
| Display (page title) | Barlow Condensed | 40/44 | 600, UPPERCASE | +0.8px |
| Hero number | Inter | 48/52 | 600 | −1px |
| Title | Inter | 24/30 | 600 | −0.48px |
| Card title / compact bar title | Inter | 17/24 | 600 | −0.2px |
| Body | Inter | 16/24 | 400 (controls 500) | 0 |
| Numbers in tables | Inter | 16/24 | 500 | tabular |
| Micro label | Inter | 12/16 | 500–600, UPPERCASE | +0.72px |

All numbers use tabular, lining figures (`font-feature-settings: "tnum" 1, "lnum" 1`; Compose
`fontFeatureSettings = "tnum, lnum"`). Right-align comparable money columns. Respect browser zoom /
Android font scale; wrap instead of shrinking.

## 5. The ambient backdrop

A fixed layer behind everything (`z-index: -1`, `pointer-events: none`, never scrolls).

| | Light | Dark |
|---|---|---|
| Base | `page` | `page` |
| Blob A — top-left, 70vmax | accent `rgba(16,89,252,.07)` | `rgba(74,130,255,.12)` |
| Blob B — bottom-right, 60vmax | indigo `rgba(99,102,241,.05)` | `rgba(99,102,241,.08)` |
| Blob C — centre-low, 50vmax | sky `rgba(56,189,248,.04)` | `rgba(56,189,248,.05)` |

Blobs are radial gradients (colour → transparent), blurred 40px, drifting up to 6vmax with a
1 → 1.1 scale over 36 / 44 / 52 s, alternating. **Pause the drift while any sheet, dialog or menu is
open** (the blur behind it otherwise re-renders every frame). Static under reduced motion. On Android,
sample the drift at ~12 fps, not 60 — it's imperceptible and saves battery.

## 6. Glass recipes

Every glass surface: `backdrop-filter: blur(24px) saturate(160%)` (plus `-webkit-` twin).

| Token | Light | Dark | Used by |
|---|---|---|---|
| `glass` | `rgba(255,255,255,.74)` | `rgba(20,32,56,.72)` | cards, tiles, side rail |
| `glass-strong` | `rgba(255,255,255,.86)` | `rgba(17,27,48,.88)` | sheets, menus, bottom nav, tooltip |
| `glass-hi` (inner top highlight) | `inset 0 1px 0 rgba(255,255,255,.55)` | `inset 0 1px 0 rgba(255,255,255,.08)` | all glass |
| `glass-edge` (hairline ring) | `0 0 0 1px rgba(8,32,79,.06)` | `0 0 0 1px rgba(255,255,255,.06)` | all glass |
| `glass-shadow` | `0 1px 2px rgba(8,32,79,.04), 0 12px 32px -12px rgba(8,32,79,.14)` | `0 1px 2px rgba(0,0,0,.25), 0 16px 40px -14px rgba(0,0,0,.6)` | cards |
| `glass-shadow-lg` | `0 24px 64px -16px rgba(8,32,79,.28)` | `0 24px 64px -16px rgba(0,0,0,.7)` | sheets, menus, floating nav |
| `fill` | `rgba(8,32,79,.05)` | `rgba(255,255,255,.06)` | control tracks, chips, inputs, ghost buttons |
| `fill-2` | `rgba(8,32,79,.08)` | `rgba(255,255,255,.10)` | hover, pressed, nav indicator |
| `thumb` | `#FFFFFF` | `rgba(255,255,255,.14)` | raised selected thumb |
| `thumb-shadow` | `0 1px 2px rgba(8,32,79,.08), 0 4px 12px -2px rgba(8,32,79,.12)` | `0 1px 2px rgba(0,0,0,.3), 0 4px 12px -2px rgba(0,0,0,.4)` | thumb, selected chip |

Shadows are **navy-tinted** in light mode (never grey/black) and dark-only in dark mode (never a
coloured glow).

**Radii:** cards 20 · sheets 28 (top corners on phones) · menus 18 · inputs and buttons 12 ·
segmented controls, chips, pills, bottom nav 999 (pill) · side rail 24.

**Fallback:** where backdrop blur is unsupported (`@supports not (backdrop-filter: blur(1px))`, or
Android < 12), glass becomes the opaque `card` colour with the same edge and shadow — never a
see-through panel without blur.

**Contrast:** check text contrast on the *composited* colour (glass over the strongest blob), not on
the token. Target WCAG AA (4.5:1 text). If a tone fails on a tinted band, make a darker "-fill" variant
(10% toward ink) for that context.

## 7. Layout and chrome

- **Page:** max width 1240, gutters 16 (phone) / 24 (wide), 12px grid gap, bottom padding that clears
  the floating nav + safe area.
- **Page head:** micro label (ink-3) above a display title. It scrolls away; the bar takes over.
- **Top bar:** sticky, 52px + status-bar inset. Transparent at rest. When the large title scrolls
  under, a **progressive fade** (not a panel) fades in: page tint 92% → 84% at the bar's bottom edge
  with the glass blur, then easing to fully transparent over 28px below the bar. A compact title
  (Inter 17/600) cross-fades in. No shadow, no hairline, no hard bottom edge. Actions stay right.
- **Bottom nav (< 600px):** a detached floating glass pill, centred, 12px + safe area from the bottom,
  60 tall, icon 20 + label 12/600, with a sliding `fill-2` indicator. The round primary action (56px,
  accent, shadow `0 10px 24px -6px rgba(16,89,252,.45)` in light, plain dark shadow in dark) floats
  beside it.
- **Side rail (≥ 600px):** floating glass panel inset 12px, radius 24; 76px wide (600–1023) or 220px
  with the logo lockup (≥ 1024). Active item = sliding `fill-2` pill, ink text; inactive ink-2.
- **Wide screens / foldables:** list + detail side by side; switch layout by available width (window
  size classes), never by device model.
- **Rows:** title (16/500 ink) + one quiet meta line (ink-3, with a coloured marker dot if useful);
  the right side holds the key number over a small status word. Selected row = `fill` tone or raised
  thumb, nothing else.

## 8. Controls

- **Segmented control:** pill track `fill`, 3px padding; selected option on a raised `thumb` with
  `thumb-shadow` that **slides** between options (spring-soft, 350 ms). Labels 15/500 ink-2, selected
  ink. Use for ranges, modes, filters, theme.
- **Chips:** pill, 34 tall (44 hit area), `fill`, ink-2; selected = `thumb` + `thumb-shadow`, ink, 600.
  A chip that represents a coloured entity shows a dot; when selected it gets a 1.5px border in that
  colour over a 12% tint.
- **Switch:** 48×28, track `fill-2` off / accent on, 24px white thumb that slides with spring-soft and
  stretches to 28px while pressed. Label only — no caption.
- **Buttons:** primary = solid accent + `on-accent` label, radius 12, min height 44–50. Everything else
  is a ghost (`fill`, no border, ink). Destructive = ghost with bad-coloured text.
- **Inputs:** `fill` background, no border at rest, radius 12; focus = 2px accent ring with 2px offset.
- **Hit targets:** ≥ 44px web, ≥ 48dp Android, even when the visible icon is 24.

## 9. Motion

```
--ease:        cubic-bezier(.22, 1, .36, 1)    movement, fades, exits
--spring:      cubic-bezier(.34, 1.4, .64, 1)  arrivals, pops (sheets, toasts, menus)
--spring-soft: cubic-bezier(.3, 1.25, .5, 1)   sliding thumbs and indicators, spring-backs
```

| Use | Duration | Curve |
|---|---|---|
| Press: `scale(.97)` (icon buttons `.94`) | 150 ms | ease |
| Hover: tone change; tappable cards lift −2px + `glass-shadow-lg` | 200 ms | ease |
| Segmented / nav thumb, switch thumb | 350 ms | spring-soft |
| Sheet in / out | 350 / 220 ms | spring / ease |
| Toast in / out | 350 / 200 ms | spring / ease |
| Menu in / out (scale .9 → 1 from its anchor + fade) | 350 / 200 ms | spring / ease |
| List rows in / out (FLIP: rows glide from old position) | 300 / 260 ms | ease |
| Number roll to new value (not on first paint) | 380 ms | ease |
| Chart line draw-in, then area fade | 700 ms | ease |
| Top bar condense cross-fade | 200–250 ms | ease |
| Swipe / drag spring-back | 300 ms | spring-soft |

**Reduced motion** (web `prefers-reduced-motion`, Android "Remove animations"): no transitions, no
draw-in, no drift (backdrop stays, static); gestures still work but snap.

## 10. Gestures

- **Swipe a row to act** (touch only): right = positive action (good underlay + check), left = negative
  / delete (bad underlay + icon). Lock direction after 8px horizontal. The action **arms** at 96px or
  30% of the row width: underlay icon scales up + haptic tick. Past that, the row follows at 35%
  (rubber band). Release armed = row slides out (220 ms) and the action runs with an **Undo** toast;
  otherwise spring back (300 ms). Keep buttons for pointer and screen-reader users (Android: custom
  accessibility actions).
- **Sheets drag to dismiss** (phones): drag the grabber/header down, the sheet follows 1:1 and the
  scrim fades with it; dragging up rubber-bands (`−sqrt(|dy|)·4`). Close past 120px or a flick faster
  than 0.6 px/ms; otherwise spring back.
- **Chart scrub:** vertical hairline + dot + a `glass-strong` tooltip (date, value); haptic tick per
  step on Android; clears on release.
- **Undo over confirm:** for reversible destructive actions use an Undo toast, not a confirm dialog.

## 11. Implementation recipes

### Web (CSS)

```css
.glass {
  background: var(--glass);
  -webkit-backdrop-filter: blur(24px) saturate(160%); backdrop-filter: blur(24px) saturate(160%);
  box-shadow: var(--glass-hi), var(--glass-edge), var(--glass-shadow);
  border-radius: 20px;
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass { background: var(--card); }
}

/* Top bar: progressive fade, not a panel */
.topbar { position: sticky; top: 0; z-index: 30;
  height: calc(52px + env(safe-area-inset-top)); padding-top: env(safe-area-inset-top); }
.topbar::before {
  content: ''; position: absolute; inset: 0 0 -28px; z-index: -1; pointer-events: none;
  opacity: 0; transition: opacity .25s var(--ease);
  background: linear-gradient(to bottom,
    color-mix(in srgb, var(--page) 92%, transparent) 0%,
    color-mix(in srgb, var(--page) 84%, transparent) calc(100% - 28px),
    transparent 100%);
  -webkit-backdrop-filter: blur(24px) saturate(160%); backdrop-filter: blur(24px) saturate(160%);
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent);
          mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent);
}
.topbar.condensed::before { opacity: 1; }

/* Modal: the container never fades — the scrim and the sheet fade themselves */
.modal { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; }
.modal::before { content: ''; position: absolute; inset: 0; z-index: -1; opacity: 0;
  background: var(--scrim); backdrop-filter: blur(6px) saturate(1.2); transition: opacity .28s var(--ease); }
.modal.open::before { opacity: 1; }
.sheet { opacity: 0; transform: translateY(16px) scale(.96);
  transition: transform .35s var(--spring), opacity .25s var(--ease); }
.modal.open .sheet { opacity: 1; transform: none; }
.modal-lock .backdrop i { animation-play-state: paused; } /* freeze drift while a sheet is open */
```

### Android (Jetpack Compose)

- Real backdrop blur with **Haze** (`dev.chrisbanes.haze`) on Android 12+ (`RenderEffect`); below 12,
  the opaque `card` fallback. Put `hazeSource` on the scrolling content + backdrop and `hazeEffect`
  on chrome (top bar, bottom nav, rail, sheets).
- Top bar fade: Haze blur **masked** with the same vertical fade as the tint gradient
  (`Brush.verticalGradient`), extending 28dp below the bar. No `graphicsLayer` alpha around the blur;
  fade in with Haze's own alpha or the brush's draw alpha.
- Sliding thumbs: offset in the layout phase (`Modifier.offset { }`) so they don't recompose per frame.
- Springs: `spring(dampingRatio ≈ 0.7–0.8, stiffness = Spring.StiffnessMediumLow)` for thumbs/sheets;
  `tween(150)` presses with `graphicsLayer { scaleX/scaleY }`.
- Haptics: `HapticFeedbackType` tick on gesture arm, chart steps, save and grade.
- Ambient backdrop: three `Canvas` radial gradients in a full-screen `Box` behind the scaffold; drift
  sampled ~12 fps; paused while any overlay is open (a shared "open overlays" counter).

## 12. Pitfalls we hit (and the fixes)

| Symptom | Cause | Fix |
|---|---|---|
| Sheet/menu blur "snaps on" at the end of the open animation | An **ancestor with opacity < 1** disables `backdrop-filter` inside it; the modal container was fading | Never fade a container of blurred content; fade the scrim (`::before`) and the sheet themselves |
| Menu open stutters | Animating `filter: blur()` on top of its backdrop blur | Animate only opacity + transform |
| Top bar looks jagged / cuts content | Hard-edged glass panel + drop shadow; blur edge shows ragged | Progressive fade with a masked blur (§11), no shadow |
| Sheet slide stutters on Android | Drifting backdrop is part of the blur source, so the blur redraws every frame | Pause the drift while overlays are open; sample drift at ~12 fps |
| Text unreadable on some glass | Contrast checked on the token, not the composited result | Check over the strongest blob; darker "-fill" variants where needed |
| White label on dark accent fails AA | `#4A82FF` too light for white | `on-accent` is navy in dark mode |
| Dark-mode "glow" on the floating Add button | Accent-tinted shadow in dark mode | Plain dark shadow in dark mode |
| Content hidden under the iPhone status bar in the installed PWA | `viewport-fit=cover` without safe-area padding | `env(safe-area-inset-top)` on the top bar |
| Screenshots don't show blur | Headless Chromium/Robolectric render the fallback | Verify blur on a real device; screenshots verify layout |

## 13. Checklist for a new screen

- [ ] Page title block (micro label + display title); compact title appears in the faded top bar on scroll
- [ ] All surfaces are glass recipes; no flat white cards; no borders/dividers inside cards
- [ ] Exactly one accent element; selection = raised thumb or tone, never a blue fill or stripe
- [ ] Rows: title + one meta line + one key number; details one tap away
- [ ] No explanatory captions under toggles
- [ ] Signed numbers with U+2212, tabular figures, status words alongside colour
- [ ] Press scale, sliding thumbs, FLIP lists, rolling numbers; reduced motion respected
- [ ] Swipe actions have button + accessibility equivalents and an Undo toast
- [ ] Contrast AA on composited glass, light and dark; opaque fallback without blur
- [ ] Phone (≥ 360px) and wide layouts checked in light and dark
