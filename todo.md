# TODO

Sorted by priority. Source: team dump, 22–23 Aug 2026.

---

## P0 — Blocking bugs & pitch-critical

### Broken navigation (nothing works right)
- [ ] "New thread" doesn't work — fix
- [ ] Rescript name click → lands on wrong new page (bug, Avinash)
- [ ] History → New flow broken, connections missing — add redirects
- [ ] Click on Studio → should land on creation page

### Editor (pitch demo runs on this)
- [ ] Video player fix
- [ ] Export fix
- [ ] Audio SFX ↔ video sync missing
- [ ] Fullscreen: no pause / move-timeline controls — add
- [ ] Timeline scrubber

### Pitch prep
- [ ] IRL video + backup generated video ready
- [ ] Landing page: sign in / sign up
- [ ] Landing page: pricing section

---

## P1 — Core features & product

### Generation pipeline
- [ ] Direct pipeline: hyper generation → edit
- [ ] History updates when new thing generated
- [ ] Reduce video generation time (investigate)
- [ ] Optimize timings

### Video format
- [ ] Short-form video support
- [ ] Portrait mode support

### Landing page content
- [ ] Rescript UI → match website theme
- [ ] Improve content: video styles, pricing, value prop, editor features ("more larp")
- [ ] Mention efficiency + pricing
- [ ] Social media links → ours

### Pricing (for PPT)
- [ ] 2 models: subscription-based + credit-based

### Navigation additions
- [ ] "New" button (general)
- [ ] History page "New" button
- [ ] Option: create new vid vs start new workspace
- [ ] Whiteboard + modern frames → easily accessible

### Error handling
- [ ] Distinguish network error vs server error

### Decisions made
- [ ] Delete storyboard (quality bad; ratelimit on 4 imgs = not worth fixing)

---

## P2 — Polish, UX, hardening

- [ ] Chime when output ready
- [ ] General UI/UX issues pass
- [ ] Balance lazy prompting vs question-based prompting
- [ ] Delete unused components (codebase cleanup)
- [ ] Whiteboard pen travel fix — **explicitly last priority**
- [ ] End-to-end testing (lots)

---

## Owned elsewhere
- [ ] Social media publishing → Avinash (decide if in scope)
