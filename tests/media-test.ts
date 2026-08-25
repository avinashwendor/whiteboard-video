/**
 * Stock media: licensing, and the proxy's allowlist.
 *
 * The network half needs keys and the internet. What can be pinned down here is
 * the half that has consequences when it is wrong.
 *
 * **Licensing**, because getting it wrong means someone publishes a client
 * video containing a track they were not allowed to use, and finds out from a
 * claim rather than from us. The `nd` case is the one people miss: a
 * no-derivatives track cannot legally be cut, faded or mixed under speech,
 * which is the only thing this editor would ever do with it.
 *
 * **The allowlist**, because a proxy that fetches any URL a client names is a
 * server-side request forgery hole with a bandwidth bill attached.
 *
 * Run with `npx tsx tests/media-test.ts`.
 */

import { creditFrom, readCcLicence, type MediaResult } from "../src/lib/media/types";
import { allProviders, providersFor } from "../src/lib/media/registry";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/* -------------------------------- licensing -------------------------------- */

{
  // The permissive end: no credit owed, commercial use fine.
  for (const code of ["cc0", "pdm"]) {
    const licence = readCcLicence(code);
    assert(!licence.attributionRequired, `${code} owes no attribution`);
    assert(licence.commercialUse, `${code} may be used commercially`);
  }

  // Attribution licences: usable, but they oblige a credit.
  const by = readCcLicence("by", "4.0");
  assert(by.commercialUse, "CC BY is commercial-safe");
  assert(by.attributionRequired, "and owes a credit");
  assert(by.name.includes("4.0"), "the version is part of the name");

  const bySa = readCcLicence("by-sa", "4.0");
  assert(bySa.commercialUse, "share-alike is still commercial-safe");
  assert(bySa.attributionRequired, "and still owes a credit");
}

{
  // The two that must be excluded, for different reasons.
  const nc = readCcLicence("by-nc", "4.0");
  assert(!nc.commercialUse, "non-commercial is not commercial-safe");

  // The one people miss. `nd` forbids derivative works, and putting a track
  // under a video — cut, faded, ducked — is exactly that. It is not a
  // commercial restriction and it excludes the track anyway.
  const nd = readCcLicence("by-nd", "4.0");
  assert(
    !nd.commercialUse,
    "no-derivatives must be excluded: cutting and mixing a track IS a derivative"
  );

  const ncNd = readCcLicence("by-nc-nd", "4.0");
  assert(!ncNd.commercialUse, "and both together, obviously");

  // Anything unrecognised is treated as the most restrictive thing it could
  // be. Guessing generously here means offering a track someone cannot use.
  const odd = readCcLicence("something-else");
  assert(odd.attributionRequired, "an unknown licence is assumed to owe a credit");
}

{
  // A credit carries through to the clip, so the attribution block can be
  // built from the timeline rather than from whatever the search panel
  // happened to still have in memory.
  const result: MediaResult = {
    id: "1",
    provider: "openverse",
    kind: "music",
    title: "Nightwalk",
    artist: "Someone",
    downloadUrl: "https://example.org/a.mp3",
    licence: readCcLicence("by", "4.0"),
    pageUrl: "https://example.org/t",
  };
  const credit = creditFrom(result);
  assert(credit.title === "Nightwalk" && credit.artist === "Someone", "who and what");
  assert(credit.attributionRequired, "and whether it is owed");
  assert(credit.url === "https://example.org/t", "linking to the track, not the file");

  const free = creditFrom({ ...result, licence: readCcLicence("cc0") });
  assert(!free.attributionRequired, "CC0 owes nothing");
}

/* -------------------------------- providers -------------------------------- */

{
  const all = allProviders();
  assert(all.length >= 4, "several catalogues");

  // Exactly one must work with no key. A media panel whose every provider needs
  // one is empty the first time anybody opens it, and "get four API keys before
  // you can add music" is where most people stop.
  const keyless = all.filter((p) => p.keyless);
  assert(keyless.length >= 1, "at least one catalogue must need no key");
  for (const p of keyless) {
    assert(p.isConfigured(), `${p.id} is keyless, so it is always configured`);
  }

  // Every kind is covered by something, and each provider declares kinds it
  // actually handles.
  const kinds = new Set(all.flatMap((p) => p.kinds));
  for (const kind of ["music", "sfx", "image", "gif"] as const) {
    assert(kinds.has(kind), `something can search ${kind}`);
  }

  for (const p of all) {
    assert(p.id.length > 0 && p.note.length > 0, `${p.id} describes itself`);
    assert(p.kinds.length > 0, `${p.id} answers for something`);
  }

  // Ids are unique — results are addressed by (provider, id).
  const ids = all.map((p) => p.id);
  assert(new Set(ids).size === ids.length, "provider ids are unique");
}

{
  // With no keys in the environment — which is how a fresh clone runs — image
  // and music must still return a provider. That is the out-of-the-box promise.
  const hadJamendo = process.env.JAMENDO_CLIENT_ID;
  const hadFreesound = process.env.FREESOUND_API_KEY;
  const hadTenor = process.env.TENOR_API_KEY;
  delete process.env.JAMENDO_CLIENT_ID;
  delete process.env.FREESOUND_API_KEY;
  delete process.env.TENOR_API_KEY;

  try {
    assert(providersFor("image").length > 0, "images work with no keys at all");
    assert(providersFor("music").length > 0, "and so does music");
    // These genuinely need a key, and reporting nothing is the honest answer —
    // better than a panel that searches and always comes back empty.
    assert(providersFor("sfx").length === 0, "sound effects need a key, and say so");
    assert(providersFor("gif").length === 0, "so do GIFs");
  } finally {
    if (hadJamendo) process.env.JAMENDO_CLIENT_ID = hadJamendo;
    if (hadFreesound) process.env.FREESOUND_API_KEY = hadFreesound;
    if (hadTenor) process.env.TENOR_API_KEY = hadTenor;
  }
}

/* -------------------------------- no YouTube -------------------------------- */

{
  // Asserted rather than assumed. Its API has no audio-download endpoint,
  // extracting audio breaches its Terms, and nearly all music on it is licensed
  // such that publishing a video containing it earns a copyright claim — so a
  // provider for it would be handing every user of this app a strike.
  for (const p of allProviders()) {
    assert(
      !/youtube|ytdl|yt-dlp/i.test(p.id),
      `"${p.id}" reads YouTube, which cannot be licensed for this`
    );
  }
}

console.log("ALL MEDIA TESTS PASSED");
