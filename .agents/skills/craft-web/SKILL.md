---
name: craft-web
description: |
  Build, fix, or refine web frontend work the way a real maintainer would — read the actual request, decide the shape, ship code that looks like it was meant to live there for years, not like an AI template or a 2003 homepage. Triggers on "build a website", "fix this UI bug", "优化界面", "AI 味太重", "太像 AI 生成", "链接老气", "00 年代风格", "加点动效", "改改样式", "帮我做个登录页", "数据库连不上", or any web frontend ask touching HTML/CSS/JS, React/Vue/Svelte/Next.js, Tailwind. Not for pure algorithm questions, backend-only scripts, CLI tools, research/writing tasks, or native desktop/mobile.
---

# Craft Web

## TL;DR
A set of constraints, not a template. The skill tells the model what *not* to do and what *good* looks like — it does not prescribe a fixed page structure or reply shape. A one-line color tweak and a 200-line landing rewrite are both valid; they should not produce the same artifact.

---

## What this is

The most common AI failure on web work is **template matching**: see "SaaS landing" → auto-spawn hero / logo-bar / features / workflow / pricing / CTA / footer. This skill actively forbids that. Read the request, decide the structure, then write.

The second-most-common failure is **default link styling**: ship a page that's visually modern but every `<a>` still renders as `#0000EE` + underline + visited-purple — instant 2003 energy. The third is **AI copy fingerprint**: even when the layout is fine, the words give it away ("seamlessly leverage cutting-edge AI to transform your workflow"). Both are addressed below — Link & text treatment kills the 2003 look, Anti-AI tells kills the generated-copy look.

Three layers of constraint:
- **Visual** — how it looks (the deepest layer, most likely to slip)
- **Voice** — how the model talks about the work
- **Code** — how the code is written

If you only remember one thing: **the visual recipe below**. Everything else is housekeeping.

---

## Visual Recipe

Default AI look = purple gradient + glassmorphism + emoji in UI copy + oversized hero + sparkle particles. Don't ship that. The recipe below is the **constructive** counterpart — what to ship instead.

### Background and surface

Pick a paper color that isn't pure white. Pure `#FFFFFF` reads as "unfinished"; a tiny off-white reads as "designed".

| Mode | Paper | Ink | When |
|---|---|---|---|
| Light | `#FAFAF7` (warm cream) or `#F8F8F5` | `#0A0A0A` | Default for SaaS, docs, marketing |
| Light cool | `#F7F8FA` | `#0B0D12` | Dashboards, dev tools |
| Dark | `#0A0A0A` (not `#000`) | `#EDEDEA` | Dark mode default; never pure black |
| Dark rich | `#0E0F12` | `#E8E8E5` | Premium feel (Linear dark, Vercel) |

Borders and dividers: `rgba(0,0,0,0.08)` on light, `rgba(255,255,255,0.08)` on dark. Never solid 1px gray.

### Type system

Two faces max (sans + optional mono). Real weights, not faux-bold via CSS.

**Sans candidates (pick one family, use it everywhere)**:
- Inter / Geist / Inter Tight — default for SaaS, dashboards
- IBM Plex Sans — for dev tools, technical
- Söhne / Switzer — for premium (paid fonts)
- system-ui — only when zero asset budget

**Mono candidates (when code appears in UI)**:
- JetBrains Mono / Geist Mono / IBM Plex Mono

**Type scale (use this exact set unless there's a strong reason not to)**:

```
display    56–72px  / 600 weight / -0.02 to -0.04em tracking / line-height 1.05–1.1
h1         40–48px  / 600 / -0.015em / 1.1–1.2
h2         28–32px  / 600 / -0.01em  / 1.2–1.3
h3         20–24px  / 500–600 / -0.005em / 1.3
body       15–16px  / 400            / 1.5–1.6
caption    13–14px  / 500            / 1.4
mono       13–14px  / 400            / 1.5
```

Two weights is the rule of thumb; three is fine (400 / 500 / 600). Four is too many — pick the right weights before adding more.

### Color palette

The pattern: **1 brand + 1 accent + ink + paper + 2 grays**. That's 6. Anything more is chaos.

**Brand color**: a saturated but not neon value. AI defaults to purple → don't. Try ink-blue (`#1E40AF`), forest (`#166534`), or a muted coral (`#DC2626`). Saturation 60–80%, lightness 35–50%.

**Accent**: subtler than brand. Often a darker/lighter shade of brand or a near-neutral with a hint of hue.

**Grays**: one warm (`#737373` family), one cool (`#6B7280` family). Use warm for paper-on-light UIs, cool for dev tools and dashboards.

Recipe example (Linear-style):
```
brand    #5E6AD2    (a real purple-blue, not Tailwind purple-600)
accent   #4F46E5
ink      #0A0A0A
paper    #FAFAF7
gray-w   #737373
gray-c   #6B7280
```

Recipe example (Vercel-style):
```
ink      #000000
paper    #FFFFFF
accent   #0070F3
gray     #666666
```

### Spacing

4-base scale, used consistently:
```
4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 / 128 / 160 / 192
```

Section-to-section vertical rhythm: **96–160px**. Inside a section: **24–48px** between groups, **8–16px** between siblings. Hero to first content block: **64–96px**.

Tightness is a design choice, not a default. Linear is dense. Vercel is roomy. Pick one and apply it everywhere — mixed density reads as inconsistent.

### Density

Three levels, chosen per surface:

- **Compact** (Linear, dashboard, data table): row height 32–36px, padding 8–12px, font 13–14px. Use when users scan many rows.
- **Medium** (Notion, app shell): row 40–48px, padding 12–16px, font 15px. Default for most apps.
- **Loose** (Vercel docs, marketing hero, blog): padding 24–48px, font 16–18px, line-height generous. Use for reading surfaces.

### Motion

- ≤ 300ms. Default 150–200ms.
- ease-out for enter, ease-in for exit. ease-in-out only for state flips.
- No bounce. No parallax. No scroll-jacking.
- Focus ring is motion: visible on `:focus-visible`, 2px offset, brand color at 40% alpha.

### Iconography

One set, one stroke width, throughout:
- **Lucide** (default, 1.5px stroke) — most things
- **Tabler** (2px stroke) — denser icons
- **Phosphor** (regular weight) — when more visual presence needed

Never mix. Never reach for emoji to substitute an icon.

### Link & text treatment

Links are typography, not afterthought. Default browser link styling (`#0000EE` + underline + visited purple) is the strongest "2000s homepage" tell — and the easiest to fix.

- **No default link colors**. Never `color: blue` + `text-decoration: underline` as baseline. Style links intentionally — usually ink color, or brand color with underline only on hover (or never).
- **No "click here" / "learn more" / "read more"** as link text. The link text describes the destination: "View the API reference", "Linear's changelog", "PR #482".
- **No inline link soup**. A paragraph with 4+ links is a footnote list or a sidebar, not prose.
- **Footer links**: one row, max 6–8 entries, grouped by type. No multi-column link farm. If you need a sitemap, build a real `/sitemap` page.
- **No `target="_blank"` on internal links**. External links get `rel="noopener noreferrer"`. Opening new tabs for your own routes breaks back-button expectations.
- **Hover state**: subtle color shift or underline appear. Never the reverse-color flip that 90s tutorials taught.
- **Breadcrumb**: only when hierarchy is genuinely 3+ levels deep. Use `/` or `›` separator, current page non-link.
- **No "Last updated" stamps** on marketing pages. Docs / changelogs are the exception.
- **Copyright**: one line, no "All rights reserved" (legally redundant since the 1989 Berne Convention implementation). `© Acme` or `© 2024 Acme` is enough.

### Components that signal "real"

These are the markers a real maintainer uses; AI defaults miss them:
- **Real focus ring** (not just `outline: none`)
- **Hover states** that move slightly (1px translate, subtle bg shift) — not just color flip
- **Active/pressed** state distinct from hover
- **Disabled** state with reduced opacity AND a `cursor: not-allowed`
- **Skeleton loaders** matching real layout (not generic gray rectangles)
- **Empty states** with a small illustration or icon + a real next-step CTA, not "No data"
- **Error states** with what went wrong + what to do, not a stack trace
- **Keyboard shortcuts** shown in tooltips on hover (⌘K, etc.)

### Layout anti-patterns

Some layouts are AI-default; some are 2000s-default. Both read as generated. Avoid:

- **No symmetric 3-column equal-width feature card grid**. If you must show 3 features, vary heights, mix in a quote, or use 2+1 / bento layout. Three equal cards with icon-on-top is *the* AI feature grid.
- **No "Trusted by [LOGO] [LOGO] [LOGO]" logo bar**. If customers matter, pick 3 and write one sentence each about how they use it. Greyscale logo strips are 2015 SaaS-default.
- **No animated stat counters** ("10,000+ users" with count-up). Show the number; real numbers don't need a performance.
- **No pricing table with "Most Popular" badge on middle tier**. If you have 3 tiers, show 3 tiers. The badge is a manipulative pattern sophisticated users recognize.
- **No "Why choose us" / "Our features" / "Get started today"** as section headings. Title sections by what they contain, not by their rhetorical role.
- **No perfectly centered hero** (centered title + centered subhead + centered CTA pair). Asymmetric hero (text left + visual right, or text right + meta left) reads as designed.
- **No FAQ accordion in marketing pages**. FAQs belong in `/help` or `/docs`. Common questions get answered inline.
- **No "screenshot in a stylized browser frame" hero visual**. Show the real product UI or don't show one. Browser chrome decorations are filler.
- **No CTA pair "Get started / Learn more"**. Pick one primary action. Secondary action can be a text link, not a button.

---

## Anti-AI tells

The fastest AI tells — things that make a user say "this was generated" within 3 seconds:

### In copy

Buzzword stack — none of these survive editing:
- seamless, leverage, robust, scalable, cutting-edge, innovative
- empower, transform, unlock, revolutionize, next-generation, game-changing
- "Boost productivity", "Streamline workflows", "Supercharge your X"

Replace each with a concrete number, a specific scenario, or remove the sentence entirely.

Other copy tells:
- Perfectly parallel structure across sections (every section is "Verb + noun + benefit"). Vary sentence shape.
- Rhyming or alliterative section titles ("Build Better Bonds").
- Generic testimonial: "[Name], [Title] at [Company]" + 5 stars + "Game changer!". Replace with one real sentence + case-study link.
- "Cutting-edge" applied to anything. Real products don't call themselves cutting-edge.
- All-caps emphasis in body copy: "FREE", "NEW", "PRO". Use weight or color, not capitalization.
- Exclamation marks in body copy. One per page max, if any. Marketing copy with three exclamation marks reads as infomercial.

### In visuals

- **Gradient text in hero headlines** (`bg-clip-text`). The single most identifiable AI visual pattern of 2023–2024.
- **Purple-to-pink gradient backgrounds** (already in Visual Recipe — restating because it's the #1 tell).
- **Floating abstract shapes**: blobs, blurred orbs, gradient circles behind text.
- **Glassmorphism cards** (`backdrop-blur` + `bg-white/10`). Reads as 2021 Dribbble shot.
- **3-up feature card grid** with icon in colored rounded square + title + 2-line description.
- **Sparkle / particle / aurora animations** behind hero.
- **Hero illustration** of abstract people / geometric shapes in flat-design style.
- **Perfectly centered hero** with no asymmetry.
- **Emoji as UI section markers** (🚀 ⚡ ✨ 🔒). Emoji belong in chat, not product UI.

### In code

- Generated placeholder names: `feature1` / `feature2` / `feature3`, `cardData` arrays with lorem copy.
- Comments describing what the code does (`// Button click handler`) — already forbidden in Code section, also an AI tell.
- Inline styles everywhere instead of a coherent class system.
- `Lorem ipsum` anywhere. If copy isn't ready, write real copy or `[copy TBD: pricing details]`.
- Inline `style={{}}` props scattered through JSX instead of classes.

### Counter-patterns — what to do instead

- **Concrete numbers**: "Average response: 142ms", "Handles 47 edge cases", "Deployed to 12 regions".
- **Real attribution**: link to actual docs, real PRs, real blog posts — not "Learn more".
- **Asymmetry**: hero text left, visual right; or one feature twice the height of its neighbors.
- **Opinion**: "We picked Postgres because we needed transactions. If you don't, SQLite is fine." Generic copy can't fake this.
- **Honest limitation**: "Doesn't work offline", "Slow on datasets > 1M rows". Stating a real tradeoff reads as human.
- **Imperfection on purpose**: one element that breaks the grid, one section that's 3× the height of others, one CTA that's plain text instead of a button. Perfectly uniform pages read as generated.

---

## Anti-dated patterns

The 2000s-style tells — patterns that read as "this codebase was last touched in 2008":

- **No layout tables**. `<table>` is for tabular data only. Layout via flexbox / grid.
- **No web-safe font defaults**: Arial, Verdana, Tahoma, Times New Roman, Georgia, Comic Sans, Trebuchet MS. Use the type system in Visual Recipe.
- **No `bgcolor`, `<font>`, `<center>`, `<marquee>`, `<blink>` tags**. (These still appear in generated code more often than you'd think.)
- **No glossy Web 2.0 buttons**: gradient + box-shadow + border-radius combos mimicking iOS 6 / Bootstrap 2. Use flat or single-shadow buttons.
- **No drop shadows everywhere**. One shadow scale (e.g., `0 1px 2px rgba(0,0,0,0.04)` for cards). Don't sprinkle `box-shadow: 0 0 10px rgba(0,0,0,0.5)` on every container.
- **No `outline: none` without a custom focus ring**. Removing default focus without replacing it is 2005.
- **No "Best viewed in 1024x768" / browser-support banners**. Modern responsive design handles this implicitly.
- **No visitor counter, no "Last modified" stamp** on marketing pages.
- **No `© Company. All rights reserved. | Privacy | Terms | Sitemap | RSS`** in a thin gray footer row. One line max, real design.
- **No unstyled `<input type="submit">`**. Form controls get the same design system as everything else.
- **No `text-align: center` on body content**. Center is for hero / feature highlights, not paragraphs.
- **No rainbow gradient buttons**. Related to "no purple gradient" but applies to all CTAs.
- **No `<hr>` decorative dividers** with default browser styling. If you need a divider, use `border-top` on a real element.
- **No `<ul>` with default disc bullets in feature lists**. Either use custom markers, or restructure as definition list / cards.

---

## Voice

- No openers: skip "Sure!", "Of course!", "这是个很好的问题", "让我先理解一下你的需求".
- No empty apologies: skip "抱歉刚才…" unless you actually broke something.
- No "let me think" preamble: skip "让我想想…" / "我需要先分析一下…".
- No user-blaming on bug reports: default to the bug existing. "你是不是清缓存了？" is not a first move.
- Lead with the conclusion, then the reason. One sentence beats five balanced ones.
- Match verbosity to the task. A one-line bug fix doesn't get a five-bullet explanation. A full landing rewrite does.

### Copy anti-patterns (AI tells in user-facing text)

These apply to copy *in the UI itself*, not just to how you talk to the user:

- No marketing buzzwords: "seamless", "leverage", "robust", "scalable", "cutting-edge", "innovative", "empower", "transform". These are the AI copy fingerprint — replace with concrete specifics.
- No abstract benefit claims: "Boost productivity" → "Cuts average task time from 4 min to 90 sec (n=47, internal test)".
- Vary sentence shape: don't write 4 parallel "Verb + noun + benefit" sentences in a row. Mix length, structure, voice.
- State limitations honestly: "Doesn't work offline", "Only tested on Chrome 110+". AI-generated copy never admits tradeoffs; real engineering copy does.
- No all-caps emphasis in body copy. Use weight or color, not capitalization.
- No exclamation marks in body copy. One per page max, if any.
- No rhetorical questions as section openers ("Ever wished you could…?"). Direct statement beats rhetorical question.
- No "In today's fast-paced world…" openers. Ever. The user already knows what world they live in.

---

## Code

- **Naming**: business semantics. `handleCheckout`, `isOverdue(invoice)`, not `handleBtn1` or `processData2`.
- **No leftover scaffolding**: strip `console.log`, commented-out blocks, debug `useState` flags, "TODO: explain this" comments.
- **Comments only explain *why***, never *what*. Code says what; comments say why it had to be that way.
- **Error paths are first-class**: every async path has a real error branch with a user-facing message. No `catch (e) {}`.
- **Three states for every data view**: loading / empty / error. All three rendered.
- **Accessibility**: keyboard reachable, focus ring visible (see Visual Recipe), `aria-label` on icon-only buttons, semantic HTML (`<button>` not `<div onClick>`).
- **No secret leakage**: no API keys in client bundles, no `.env` exposed, no `dangerouslySetInnerHTML` on user input.
- **Links**: no `target="_blank"` on internal routes; external links get `rel="noopener noreferrer"`. No `color: blue` + `text-decoration: underline` as default — see Link & text treatment.
- **No inline `style={{}}` soup** in JSX. Use class-based styling (CSS Modules / Tailwind / styled-components) — inline styles scattered through components read as AI-generated one-shots.

---

## Procedure

1. **Scan first**. Read `package.json`, target file, one nearby file. Mirror existing conventions.
2. **State intent in one sentence** before changing code. *Why*: lets the user redirect early.
3. **Make the smallest change that fixes the problem**. Don't refactor unrelated code in the same pass.
4. **Pre-ship audit** — walk the checklist below.
5. **Hand off**. Say what changed, why, how to verify. UI changes include screenshot or `localhost:PORT` URL.

Small tasks (one-line fix, color tweak, copy edit) skip the ceremony: don't manufacture a 5-step reply when 1 line answers it.

---

## Pre-ship Checklist

Every box must pass before declaring done. Most are obvious in-context; only ones you can't quickly verify need justification.

- [ ] XSS / injection: any user input reaching `dangerouslySetInnerHTML` / `innerHTML` / raw SQL?
- [ ] Secrets: no API keys / tokens / `.env` in client code?
- [ ] A11y: keyboard tab works; focus ring visible; icon buttons have `aria-label`?
- [ ] States: loading / empty / error all handled for data views?
- [ ] Responsive: doesn't break at 375px and 1440px?
- [ ] Visual restraint: no emoji in UI copy; no glassmorphism; no purple gradient; recipe from Visual section followed?
- [ ] Cleanup: no `console.log`, no commented-out code, no debug state?
- [ ] Naming: reads human (`handleCheckout`, not `handleBtn1`)?
- [ ] **Links**: no "click here" / "learn more"; no default blue underline; no `target="_blank"` on internal links; footer ≤ 6 entries; no "All rights reserved"?
- [ ] **Anti-AI visual**: no gradient text in hero; no purple-pink gradient; no 3-up feature card grid with icon-in-square; no glassmorphism; no sparkle particles; no emoji as UI markers?
- [ ] **Anti-AI copy**: no "seamless/leverage/robust/scalable/cutting-edge/empower/transform"; no abstract benefit claims; no perfectly parallel section structures; no exclamation marks in body; no rhetorical-question openers?
- [ ] **Anti-dated**: no layout tables; no Arial/Times/Verdana/Comic Sans defaults; no glossy Web 2.0 buttons; no `box-shadow` on every container; no `<hr>` / default `<ul>` bullets in feature lists?
- [ ] **Hero**: not perfectly centered; no "screenshot in browser frame" decoration; CTA is single primary action (no "Get started / Learn more" pair)?

---

## Calibration anchors — what to learn from each

Don't just visit these sites; learn the **specific thing** each one is good at.

- **linear.app** — density control and typographic rhythm. The compact data UI is a masterclass. Right column width matters. Button height consistency.
- **vercel.com** + **vercel.com/docs** — restrained black/white palette, generous spacing, hierarchy through size not color. The hero is the entire brand.
- **stripe.com/docs** — code samples that look like real code (not code blocks with `lorem ipsum`). Sidebar navigation as design object. Table layouts.
- **github.com** — functional UI where visual restraint serves usability. The "real maintainer" baseline: ship what's needed, nothing decorative.
- **rauchg.com** — prose-first personal site: typography, line-length, vertical rhythm. The opposite of marketing-template.
- **geist-ui.dev** — when you need a component library that already follows this recipe (Geist + Geist Mono + the spacing scale above).

Not Dribbble. Not "AI landing page inspiration" boards. Those are how AI defaults get trained.

---

## What this skill is not

- Not a design system. Don't install shadcn just because this skill mentions it.
- Not a Tailwind preset. The recipe is portable to vanilla CSS, CSS Modules, Vue, whatever.
- Not a substitute for user judgment. When the user has a strong preference (e.g., "match our brand book"), follow that — the recipe is a default, not a law.
