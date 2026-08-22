# TODO

Sorted by priority. Source: team dump, 22–23 Aug 2026.

---

## P0 — Blocking bugs & pitch-critical

### Broken navigation (nothing works right)
- [x] "New thread" doesn't work — fix
- [ ] Rescript name click → lands on wrong new page (bug, Avinash)
- [x] History → New flow broken, connections missing — add redirects
- [x] Click on Studio → should land on creation page

### Editor (pitch demo runs on this)
- [x] Video player fix
- [x] Export fix
- [x] Audio SFX ↔ video sync missing
- [x] Fullscreen: no pause / move-timeline controls — add
- [x] Timeline scrubber

### Pitch prep
- [ ] IRL video + backup generated video ready
- [ ] Landing page: sign in / sign up
- [ ] Landing page: pricing section

---

## P1 — Core features & product

### Generation pipeline
- [x] Direct pipeline: hyper generation → edit
- [x] History updates when new thing generated
- [~] Reduce video generation time — narration now runs as a bounded pool
      instead of one clip at a time; boards still serialise for layout variety.
      Measured run after the change: 6 scenes / 76s video in 2m45s.
- [ ] Optimize timings

### Video format
- [ ] Short-form video support
- [ ] Portrait mode support
      NOT a constant change. BOARD_WIDTH/HEIGHT are the single source of truth
      (no stray 1280/720 anywhere), but the layout engines mix absolute pixels
      with them — margins of 160, 62pt type, fixed TITLE_Y — across scene.ts,
      renderer.ts and modern-renderer.ts. Portrait needs those re-tuned, not
      rescaled. Multi-hour, and it is the pipeline the demo runs on.

### Landing page content
- [ ] Rescript UI → match website theme
- [x] Improve content: video styles, pricing, value prop, editor features ("more larp")
- [x] Mention efficiency + pricing
- [ ] Social media links → ours

### Pricing (for PPT)
- [ ] 2 models: subscription-based + credit-based

### Navigation additions
- [x] "New" button (general)
- [x] History page "New" button
- [ ] Option: create new vid vs start new workspace
- [x] Whiteboard + modern frames → easily accessible

### Error handling
- [x] Distinguish network error vs server error

### Decisions made
- [x] Delete storyboard (quality bad; ratelimit on 4 imgs = not worth fixing)

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
