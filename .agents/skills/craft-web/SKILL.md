---
name: craft-web
description: |
  Build, fix, or refine web frontend work the way a real maintainer would — read the actual request, decide the shape, ship code that looks like it was meant to live there for years, not like an AI template or a 2003 homepage. Triggers on "build a website", "fix this UI bug", "优化界面", "AI 味太重", "太像 AI 生成", "链接老气", "00 年代风格", "加点动效", "改改样式", "帮我做个登录页", "数据库连不上", or any web frontend ask touching HTML/CSS/JS, React/Vue/Svelte/Next.js, Tailwind. Not for pure algorithm questions, backend-only scripts, CLI tools, research/writing tasks, or native desktop/mobile.
---

# Craft Web: Frontend Polish & Anti-AI Guidelines

Constraints and concrete design recipes for shipping modern web frontends without AI template cliches or 2000s legacy artifacts.

---

## 🎨 Visual Recipe

### 1. Paper & Ink Palette

Never use pure white `#FFFFFF` or pure black `#000000` as the primary surface.

| Theme | Paper (Background) | Ink (Text) | Context |
|---|---|---|---|
| **Light Warm** | `#FAFAF7` / `#F8F8F5` | `#0A0A0A` | SaaS, docs, marketing default |
| **Light Cool** | `#F7F8FA` | `#0B0D12` | Dashboards, dev tools |
| **Dark Clean** | `#0A0A0A` | `#EDEDEA` | Standard dark mode |
| **Dark Rich** | `#0E0F12` | `#E8E8E5` | Premium (Linear / Vercel dark) |

- **Borders & Dividers**: `rgba(0,0,0,0.08)` on light, `rgba(255,255,255,0.08)` on dark.
- **Palette Pattern**: 1 Brand + 1 Accent + Ink + Paper + 2 Grays (max 6 tokens).

### 2. Typography & Scale

Max two families (sans + mono). Max 3 weights (`400`, `500`, `600`).

```text
display: 56–72px / 600 / -0.03em tracking / 1.05 line-height
h1:      40–48px / 600 / -0.015em / 1.15
h2:      28–32px / 600 / -0.01em  / 1.25
h3:      20–24px / 550 / -0.005em / 1.3
body:    15–16px / 400 / 0        / 1.55
caption: 13–14px / 500 / 0        / 1.4
mono:    13–14px / 400 / 0        / 1.5
```

### 3. Spacing, Rhythm & Motion

- **Spacing Scale (4-base)**: `4, 8, 12, 16, 24, 32, 48, 64, 96, 128px`.
- **Vertical Rhythm**: Section gap `96–128px`; component group `24–48px`; sibling gap `8–16px`.
- **Motion**: `150–200ms ease-out` for enter; `ease-in` for exit. No bounce/jello.
- **Focus Rings**: `:focus-visible` with 2px offset, brand color at 40% alpha.

### 4. Link & Text Treatment

- **No browser default link colors**: Never blue underline + purple visited. Use ink color or hover underline;
- **Descriptive links**: No "Click here" / "Learn more". Destination-specific: "View API Reference";
- **Internal vs External**: No `target="_blank"` on internal routes; external links get `rel="noopener noreferrer"`;
- **Footer**: Single row, max 6–8 entries. No multi-column link farms.

---

## 🚫 Anti-Patterns Checklist

### 1. Anti-AI Visual Tells (Forbidden)

- ❌ Gradient text in headlines (`bg-clip-text` purple/pink);
- ❌ Purple-to-pink gradient backgrounds;
- ❌ Floating blurred glow orbs / glassmorphism cards (`backdrop-blur` + `bg-white/10`);
- ❌ Symmetric 3-column equal-width card grids with top colored icon in a box;
- ❌ Sparkle / particle / aurora floating animations;
- ❌ System emojis in UI copy (🚀 ⚡ ✨ 🔒). Use inline SVG with `currentColor`.

### 2. Anti-AI Copy Tells (Forbidden)

- ❌ Buzzwords: *seamless, leverage, robust, scalable, cutting-edge, innovative, empower, transform*;
- ❌ Empty claims: "Boost productivity" ➔ replace with concrete metrics ("Average response: 142ms");
- ❌ Parallel formulaic titles ("Build Better Bonds").

### 3. Anti-Dated Tells (Forbidden)

- ❌ Layout tables (`<table>` for layout);
- ❌ Web-safe default fonts (Arial, Times New Roman, Comic Sans);
- ❌ Heavy drop shadows on every container (`box-shadow: 0 0 10px rgba(0,0,0,0.5)`);
- ❌ `outline: none` without providing custom `:focus-visible` ring.

---

## 💻 Code Engineering Constraints

1. **Semantic Naming**: `handleCheckout`, `isOverdue(invoice)` (no `handleBtn1`, `tempData`);
2. **Error & Loading States**: Every async path renders loading, empty, and user-facing error states;
3. **No Dead Scaffold**: Clean all `console.log`, commented-out blocks, debug flags;
4. **Accessible Semantics**: Semantic HTML (`<button>` instead of `<div onClick>`), `aria-label` on icon-only buttons;
5. **No Style Leaks**: Use classes / tokens instead of inline `style={{}}` soup.

---

## 📋 Pre-Ship Verification

- [ ] Data views render loading, empty, and error states;
- [ ] Responsive layout validated at 375px and 1440px;
- [ ] No emoji in UI copy; no purple gradients; no glassmorphism;
- [ ] Links styled intentionally; external links have `noopener noreferrer`;
- [ ] Zero unhandled async rejections or `catch(e) {}` silent swallows.
