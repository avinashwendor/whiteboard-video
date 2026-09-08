# TODO

Sorted by priority. Source: team dump, 22–23 Aug 2026.

---

## P0 — Blocking bugs & pitch-critical

### Broken navigation (nothing works right)
- [x] "New thread" doesn't work — fix
- [ ] Editor name click → lands on wrong new page (bug, Avinash)
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
- [x] Landing page: sign in / sign up
- [x] Landing page: pricing section

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
- [x] Short-form video support
- [x] Portrait mode support
      Native, not a crop and not a rescale. The board has a shape now
      (`BOARDS` in lib/whiteboard/scene.ts: landscape 1280×720, portrait
      720×1280, square 1080×1080) and the layouts arrange themselves for it:
      four icons are a row on a wide board and a 2×2 grid on a tall one, a
      sequence runs down the page with its arrows pointing down, a comparison
      stacks instead of splitting, a pie trades leader lines for a legend, bars
      lie on their side, and a timeline's spine stands up. The taped photograph
      moves from beside the drawing to above it.
      Hyperframes reads the frame from one module every one of its drawing
      helpers already goes through, so its margins, line lengths and subtitle
      floor all follow the shape.
      Chosen in Advanced settings (the plates follow it), stored on the project
      because the boards are composed for it, and carried through the player,
      the export, the poster and the capability probe.
      tests/board-shapes-test.ts composes every layout in every shape at every
      item count the schema allows and measures all 2,687 primitives against
      the paper.

### Landing page content
- [~] Editor UI → match website theme — defaults to dark now so crossing
      between the two apps does not flash white. Full restyle of its 107
      components not attempted; it is Avinash's app.
- [x] Improve content: video styles, pricing, value prop, editor features ("more larp")
- [x] Mention efficiency + pricing
- [x] Social media links → ours

### Pricing (for PPT)
- [x] 2 models: subscription-based + credit-based

### Navigation additions
- [x] "New" button (general)
- [x] History page "New" button
- [x] Option: create new vid vs start new workspace
- [x] Whiteboard + modern frames → easily accessible

### Error handling
- [x] Distinguish network error vs server error

### Decisions made
- [x] Delete storyboard (quality bad; ratelimit on 4 imgs = not worth fixing)

---

## P2 — Polish, UX, hardening

- [x] Chime when output ready
- [ ] General UI/UX issues pass
- [x] Balance lazy prompting vs question-based prompting
- [x] Delete unused components (codebase cleanup)
- [x] Whiteboard pen travel fix — **explicitly last priority**
- [~] End-to-end testing — route smoke test added at tests/smoke-routes-test.ts
      (npx tsx tests/smoke-routes-test.ts). Catches render-time crashes like the
      one retiring storyboard caused. Interaction coverage still manual.

---

## Owned elsewhere
- [ ] Social media publishing → Avinash (decide if in scope)
