// @ts-check
// NAME: Random Library
// AUTHOR: david
// DESCRIPTION: Displays your saved albums & followed artists in a fast, shuffled, filterable grid.

const { React } = Spicetify;
const { useState, useEffect, useCallback, useMemo } = React;

if (typeof document !== "undefined" && !document.getElementById("random-library-keyframes")) {
  const styleEl = document.createElement("style");
  styleEl.id = "random-library-keyframes";
  styleEl.textContent = `
    @keyframes rl-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .rl-grid {
      display: grid !important;
      grid-template-columns: repeat(auto-fill, minmax(max(var(--grid-column-min-width, 170px), 140px), 1fr)) !important;
      gap: var(--grid-gap, 20px) !important;
    }

    @media (min-width: 2200px) {
      .rl-grid {
        grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)) !important;
        gap: 28px !important;
      }
    }
    @media (min-width: 1700px) and (max-width: 2199px) {
      .rl-grid {
        grid-template-columns: repeat(auto-fill, minmax(195px, 1fr)) !important;
        gap: 24px !important;
      }
    }
    @media (min-width: 1200px) and (max-width: 1699px) {
      .rl-grid {
        grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)) !important;
        gap: 20px !important;
      }
    }
    @media (min-width: 800px) and (max-width: 1199px) {
      .rl-grid {
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)) !important;
        gap: 16px !important;
      }
    }
    @media (max-width: 799px) {
      .rl-grid {
        grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)) !important;
        gap: 12px !important;
      }
    }
  `;
  document.head.appendChild(styleEl);
}

// ---------------------------------------------------------------------------
// 1. Spotify URI & ID Helper
// ---------------------------------------------------------------------------
function getSpotifyId(uriOrId) {
  if (!uriOrId) return "";
  const str = String(uriOrId);
  return str.includes(":") ? str.split(":").pop() : str;
}

// ---------------------------------------------------------------------------
// 2. Fisher-Yates shuffle
// ---------------------------------------------------------------------------
function fisherYatesShuffle(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// ---------------------------------------------------------------------------
// 2. Release Classification Logic (100% Native Spotify Catalog Groups)
// ---------------------------------------------------------------------------
function classifyRelease(item, fallbackGroup = "") {
  const groupHint = String(item.album_group || fallbackGroup || "").toLowerCase();
  if (groupHint.includes("compil")) return "compilation";
  if (groupHint.includes("single") || groupHint.includes("ep")) return "single";
  if (groupHint.includes("album")) return "album";

  const rawGroup = String(
    item.album_type ||
    item.albumType ||
    item.type ||
    item.__typename ||
    "album"
  ).toLowerCase();

  if (rawGroup.includes("compil")) return "compilation";
  if (rawGroup.includes("single") || rawGroup.includes("ep")) return "single";
  return "album";
}

// Normalized album title for fuzzy deduplication & cross-edition saved matching
function normalizeAlbumTitle(title) {
  if (!title) return "";
  return String(title)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents (e.g. é -> e)
    .toLowerCase()
    .replace(/['"’“”`]/g, "") // remove smart quotes & apostrophes
    // Strip parenthetical/bracketed edition variations (including years/numbers before edition keywords)
    .replace(/\s*[\(\[\{][^\)\]\}]*(deluxe|expanded|anniversary|remaster|special|bonus|clean|explicit|edition|re-?issue|reissue|mono|stereo|version|cut|box set|collector|live)[^\)\]\}]*[\)\]\}]/gi, "")
    // Strip trailing dashes with edition descriptions e.g. " - 2017 Remaster", " - Deluxe Edition"
    .replace(/\s*-\s*.*(deluxe|expanded|anniversary|remaster|special|bonus|clean|explicit|edition|re-?issue|reissue|mono|stereo|version|cut|box set|collector).*/gi, "")
    // Strip standalone year tag at end like (2017) or [2021]
    .replace(/\s*[\(\[\{]\d{4}[\)\]\}]/g, "")
    // Preserve Unicode letters and numbers across languages (e.g. Chinese/Japanese "猫猫", Cyrillic, etc.)
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Normalize text for resilient search matching (strips accents & diacritics, lowercases)
function normalizeSearchString(str) {
  if (!str) return "";
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\$/g, "s") // handle $ as 's' (e.g. $uicideboy$ -> suicideboys, Ke$ha -> kesha, A$AP -> asap)
    .trim();
}

// Resilient search matcher supporting special characters, punctuation, and diacritics
// (e.g. "juie" matches "JU!iE", "acdc" matches "AC/DC", "rosalia" matches "Rosalía", "jay z" matches "JAY-Z")
function matchesSearchQuery(text, query) {
  if (!query) return true;
  if (!text) return false;

  const normText = normalizeSearchString(text);
  const normQuery = normalizeSearchString(query);
  if (!normQuery) return true;

  // 1. Direct normalized substring match (handles accents, diacritics & casing)
  if (normText.includes(normQuery)) return true;

  // 2. Punctuation-stripped match (replaces punctuation/symbols with spaces)
  const strippedText = normText.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const strippedQuery = normQuery.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (strippedQuery && strippedText.includes(strippedQuery)) return true;

  // 3. Compact match (strips all whitespace and symbols: "juie" matches "ju!ie", "acdc" matches "ac/dc")
  const compactText = normText.replace(/[^\p{L}\p{N}]/gu, "");
  const compactQuery = normQuery.replace(/[^\p{L}\p{N}]/gu, "");
  if (compactText && compactQuery && compactText.includes(compactQuery)) return true;

  return false;
}

// Extract edition metadata for alternative edition detection & badge tags
function getEditionInfo(name) {
  const lower = String(name || "").toLowerCase();
  const isDeluxe = /deluxe|director'?s cut|expanded|complete|special edition|bonus/.test(lower);
  const isRemaster = /remaster|anniversary|re-?issue|mix/.test(lower);

  let label = "Standard";
  if (/director'?s cut/i.test(name)) label = "Director's Cut";
  else if (/deluxe/i.test(name)) label = "Deluxe";
  else if (/expanded/i.test(name)) label = "Expanded";
  else if (/anniversary/i.test(name)) label = "Anniversary";
  else if (/remaster/i.test(name)) label = "Remaster";
  else if (/collector/i.test(name)) label = "Collector's";
  else if (/special edition/i.test(name)) label = "Special Edition";
  else if (/\blive\b/i.test(name)) label = "Live";
  else if (/clean/i.test(name)) label = "Clean";
  else if (/explicit/i.test(name)) label = "Explicit";

  return { isDeluxe, isRemaster, label };
}

// ---------------------------------------------------------------------------
// 3. Saved Albums Fetcher (Instant Local Database)
// ---------------------------------------------------------------------------
async function fetchAllSavedAlbums(onProgress) {
  const albums = [];
  const limit = 50;
  let offset = 0;
  let total = Infinity;
  const seenUris = new Set();

  while (offset < total) {
    const response = await Spicetify.Platform.LibraryAPI.getContents({
      filters: ["0"], // Library filter
      sortOrder: "RECENTLY_ADDED",
      limit,
      offset,
    });

    if (!response || !response.items) break;

    for (const item of response.items) {
      // Exclude playlists, shows, episodes, artists - ONLY accept saved albums/singles (spotify:album: URIs)
      if (!item.uri || !item.uri.startsWith("spotify:album:")) continue;
      if (seenUris.has(item.uri)) continue;
      seenUris.add(item.uri);

      const firstArtist = item.artists?.[0];
      const artistUri = firstArtist?.uri || item.artistUri || (firstArtist?.id ? `spotify:artist:${firstArtist.id}` : "");
      const releaseYear = item.publishDate?.year || item.year || item.releaseDate?.year || (typeof item.releaseDate === "string" ? item.releaseDate.slice(0, 4) : "") || "";

      albums.push({
        uri: item.uri,
        name: item.name,
        artist: item.artists?.map((a) => a.name).join(", ") ?? "Unknown Artist",
        artistUri: artistUri,
        imageUrl: item.images?.[0]?.url ?? item.imgUrl ?? "",
        type: classifyRelease(item),
        year: releaseYear ? String(releaseYear) : "",
      });
    }

    total = response.totalLength ?? response.total ?? albums.length;
    offset += limit;
    onProgress?.(albums.length, total);
  }

  return albums;
}

// ---------------------------------------------------------------------------
// 3b. Export Saved Albums Helper & Spicetify Global/Profile Menu Integration
// ---------------------------------------------------------------------------
async function exportSavedAlbums(format = "json") {
  try {
    let albums = savedAlbumCache;
    if (!albums || albums.length === 0) {
      Spicetify.showNotification?.("Fetching saved albums for export\u2026");
      albums = await fetchAllSavedAlbums();
      savedAlbumCache = albums;
    }

    if (!albums || albums.length === 0) {
      Spicetify.showNotification?.("No saved albums found to export.");
      return;
    }

    const cleanAlbums = albums.map((a) => ({
      uri: a.uri,
      name: a.name,
      artist: a.artist,
      year: a.year || "",
      type: a.type || "album",
      imageUrl: a.imageUrl || "",
    }));

    let content, filename, mimeType;
    if (format === "csv") {
      let csv = "\uFEFFArtist,Album,Year,Type,URI,ImageURL\n";
      for (const a of cleanAlbums) {
        const artist = `"${String(a.artist || "").replace(/"/g, '""')}"`;
        const name = `"${String(a.name || "").replace(/"/g, '""')}"`;
        const year = `"${String(a.year || "").replace(/"/g, '""')}"`;
        const type = `"${String(a.type || "").replace(/"/g, '""')}"`;
        const uri = `"${String(a.uri || "").replace(/"/g, '""')}"`;
        const img = `"${String(a.imageUrl || "").replace(/"/g, '""')}"`;
        csv += `${artist},${name},${year},${type},${uri},${img}\n`;
      }
      content = csv;
      filename = "spotify_saved_albums.csv";
      mimeType = "text/csv;charset=utf-8;";
    } else {
      content = JSON.stringify(cleanAlbums, null, 2);
      filename = "spotify_saved_albums.json";
      mimeType = "application/json";
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1500);

    Spicetify.showNotification?.(`Exported ${cleanAlbums.length} saved albums to ${filename}!`);
  } catch (err) {
    console.error("[Random Library] Failed to export saved albums:", err);
    Spicetify.showNotification?.(`Export failed: ${err.message || err}`);
  }
}

let exportMenuRegistered = false;

function registerExportMenu() {
  if (exportMenuRegistered) return;
  if (typeof Spicetify === "undefined" || !Spicetify.Menu) return;

  try {
    const jsonItem = new Spicetify.Menu.Item(
      "Export as JSON (.json)",
      false,
      () => exportSavedAlbums("json")
    );
    const csvItem = new Spicetify.Menu.Item(
      "Export as CSV (.csv)",
      false,
      () => exportSavedAlbums("csv")
    );

    if (Spicetify.Menu.SubMenu) {
      const subMenu = new Spicetify.Menu.SubMenu("Export Saved Albums", [jsonItem, csvItem]);
      subMenu.register();
    } else {
      jsonItem.register();
      csvItem.register();
    }
    exportMenuRegistered = true;
  } catch (e) {
    console.warn("[Random Library] Could not register export menu:", e);
  }
}

// Initialize export menu in Spicetify Profile Menu
(function initExportMenu() {
  if (typeof Spicetify !== "undefined" && Spicetify.Menu && (Spicetify.Menu.SubMenu || Spicetify.Menu.Item)) {
    registerExportMenu();
  } else {
    setTimeout(initExportMenu, 500);
  }
})();

// ---------------------------------------------------------------------------
// 4. Followed Artists Fetcher (Instant Local Database)
// ---------------------------------------------------------------------------
async function fetchAllFollowedArtists(onProgress) {
  const artists = [];
  const limit = 50;
  let offset = 0;
  let total = Infinity;
  const seenIds = new Set();

  while (offset < total) {
    const response = await Spicetify.Platform.LibraryAPI.getContents({
      filters: ["1"], // "1" = Artists in library
      sortOrder: "RECENTLY_ADDED",
      limit,
      offset,
    });

    if (!response || !response.items || response.items.length === 0) break;

    for (const item of response.items) {
      const id = item.uri ? item.uri.split(":").pop() : item.id;
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        artists.push({
          id,
          uri: item.uri || `spotify:artist:${id}`,
          name: item.name,
          imageUrl: item.images?.[0]?.url ?? item.imgUrl ?? "",
        });
      }
    }

    total = response.totalLength ?? response.total ?? artists.length;
    offset += limit;
    onProgress?.(artists.length, total);
  }

  return artists;
}

// ---------------------------------------------------------------------------
// 5. On-Demand Artist Discography Fetcher (Web API + Search + Cosmos + GraphQL)
// ---------------------------------------------------------------------------
const artistDiscographyCache = new Map();

// Helper to obtain Spotify access token across various desktop CEF / Spicetify versions
async function getSpotifyAccessToken() {
  try {
    const authState = Spicetify.Platform?.AuthorizationAPI?.getState?.();
    if (authState?.token?.accessToken) return authState.token.accessToken;
    if (authState?.accessToken) return authState.accessToken;
    if (Spicetify.Platform?.AuthorizationAPI?._tokenProvider?._lastToken) {
      return Spicetify.Platform.AuthorizationAPI._tokenProvider._lastToken;
    }
    if (Spicetify.Platform?.Session?.accessToken) {
      return Spicetify.Platform.Session.accessToken;
    }
    if (typeof Spicetify.Platform?.AuthorizationAPI?.getAccessToken === "function") {
      const res = await Spicetify.Platform.AuthorizationAPI.getAccessToken();
      if (res) return typeof res === "string" ? res : res.accessToken || res.token || "";
    }
    if (typeof Spicetify.Platform?.Session?.getAccessToken === "function") {
      const res = await Spicetify.Platform.Session.getAccessToken();
      if (res) return typeof res === "string" ? res : res.accessToken || res.token || "";
    }
    if (typeof Spicetify.Platform?.UserAPI?.getAccessToken === "function") {
      const res = await Spicetify.Platform.UserAPI.getAccessToken();
      if (res) return typeof res === "string" ? res : res.accessToken || res.token || "";
    }
  } catch (err) {
    console.warn("[Random Library] Access token fetch error:", err);
  }
  return "";
}

// Resilient Web API requester: tries Bearer fetch, with automatic fallback to CosmosAsync
async function fetchWebApiJson(url, token) {
  if (token) {
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Fall through to CosmosAsync
    }
  }
  if (Spicetify.CosmosAsync?.get) {
    try {
      return await Spicetify.CosmosAsync.get(url);
    } catch {
      // ignore
    }
  }
  return null;
}

// Build sanitized search queries for Spotify Web API (/v1/search uses Lucene syntax)
// Reserved Lucene characters [+ - && || ! ( ) { } [ ] ^ " ~ * ? : \ /] break searches or act as NOT operators
function buildSearchQueries(artistName) {
  if (!artistName || !artistName.trim()) return [];

  const raw = artistName.trim();
  const queries = new Set();

  // 1. Cleaned for Lucene: replace Lucene reserved characters with spaces so they don't break the query parser
  const luceneCleaned = raw
    .replace(/[+\-&|!(){}\[\]^"~*?:\\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (luceneCleaned) {
    queries.add(`artist:"${luceneCleaned}"`);
    queries.add(`"${luceneCleaned}"`);
  }

  // 2. Punctuation stripped completely (e.g. "JU!iE" -> "JUiE", "AC/DC" -> "ACDC")
  const stripped = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

  if (stripped && stripped.toLowerCase() !== luceneCleaned.toLowerCase()) {
    queries.add(`artist:"${stripped}"`);
  }

  // 3. Compact alphanumeric if distinct
  const compact = raw.replace(/[^\p{L}\p{N}]/gu, "");
  if (compact && compact.length >= 3 && compact.toLowerCase() !== stripped.toLowerCase()) {
    queries.add(`artist:"${compact}"`);
  }

  return Array.from(queries);
}

// Compare release artist credits with target artist (handles special characters, full-width, and features)
function isItemMatchingArtist(item, artistId, artistName) {
  if (!item) return false;

  // 1. ID or URI match
  if (artistId && item.artists?.some((a) => a.id === artistId || a.uri === `spotify:artist:${artistId}`)) {
    return true;
  }

  // 2. Normalized name match (ignoring accents, punctuation, casing)
  if (artistName) {
    const normTarget = normalizeSearchString(artistName);
    const compactTarget = normTarget.replace(/[^\p{L}\p{N}]/gu, "");

    const artistNameMatches = item.artists?.some((a) => {
      if (!a?.name) return false;
      const aNorm = normalizeSearchString(a.name);
      if (aNorm === normTarget) return true;
      const aCompact = aNorm.replace(/[^\p{L}\p{N}]/gu, "");
      return compactTarget && aCompact === compactTarget;
    });

    if (artistNameMatches) return true;

    // 3. Title credits match (e.g. "feat. JU!iE", "with JU!iE")
    if (item.name && matchesSearchQuery(item.name, artistName)) {
      return true;
    }
  }

  return false;
}

async function fetchArtistReleases(artistUri, artistName = "") {
  if (artistDiscographyCache.has(artistUri)) {
    return artistDiscographyCache.get(artistUri);
  }

  const releases = [];
  const artistId = artistUri.split(":").pop();
  const seenUris = new Set();

  const addRelease = (rel) => {
    if (rel?.uri && !seenUris.has(rel.uri)) {
      seenUris.add(rel.uri);
      releases.push(rel);
    }
  };

  // Obtain authorization token
  const token = await getSpotifyAccessToken();

  // Layer 1: Spotify Web API - Artist Catalog Groups
  // Strictly queries ["album", "single", "compilation"] (NO appears_on)
  try {
    const groups = ["album", "single", "compilation"];
    const fetchGroup = async (group) => {
      let nextUrl = `https://api.spotify.com/v1/artists/${artistId}/albums?include_groups=${group}&limit=50`;
      while (nextUrl) {
        try {
          const data = await fetchWebApiJson(nextUrl, token);
          if (!data?.items || data.items.length === 0) break;

          for (const item of data.items) {
            addRelease({
              uri: item.uri,
              name: item.name,
              artist: item.artists?.map((a) => a.name).join(", ") || artistName,
              imageUrl: item.images?.[0]?.url || item.images?.[1]?.url || "",
              type: classifyRelease(item, group),
              releaseDate: item.release_date || item.releaseDate || "",
            });
          }
          nextUrl = data.next;
        } catch {
          break;
        }
      }
    };

    await Promise.all(groups.map((g) => fetchGroup(g)));
  } catch (err) {
    console.warn("[Random Library] Web API catalog fetch error:", err);
  }

  // Layer 2: Spotify Web API - Search Discovery (captures collabs & primary releases with Lucene-safe queries)
  if (artistName) {
    try {
      const searchQueries = buildSearchQueries(artistName);

      for (const query of searchQueries) {
        let offset = 0;
        let total = Infinity;
        while (offset < total && offset < 300) {
          const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=album&limit=50&offset=${offset}`;
          try {
            const data = await fetchWebApiJson(url, token);
            const albums = data?.albums;
            if (!albums?.items || albums.items.length === 0) break;

            total = albums.total ?? albums.items.length;
            for (const item of albums.items) {
              if (isItemMatchingArtist(item, artistId, artistName)) {
                const groupHint = item.album_group || item.album_type || "album";
                addRelease({
                  uri: item.uri,
                  name: item.name,
                  artist: item.artists?.map((a) => a.name).join(", ") || artistName,
                  imageUrl: item.images?.[0]?.url || item.images?.[1]?.url || "",
                  type: classifyRelease(item, groupHint),
                  releaseDate: item.release_date || item.releaseDate || "",
                });
              }
            }
            offset += 50;
          } catch {
            break;
          }
        }
      }
    } catch (err) {
      console.warn("[Random Library] Web API search discovery error:", err);
    }
  }

  // Layer 3: Cosmos hm:// protocol (Spotify desktop native service)
  try {
    const res = await Spicetify.CosmosAsync?.get?.(`hm://artist/v1/${artistId}/desktop?format=json`);
    if (res?.releases) {
      const addCosmosReleases = (list, groupType) => {
        if (!list) return;
        for (const item of list) {
          const imageHash = item.cover?.uri ? item.cover.uri.split(":").pop() : null;
          addRelease({
            uri: item.uri,
            name: item.name,
            artist: item.artists?.map((a) => a.name).join(", ") || artistName || res.name || "",
            imageUrl: imageHash ? `https://i.scdn.co/image/${imageHash}` : "",
            type: classifyRelease({ ...item, album_group: groupType }, groupType),
            releaseDate: item.year ? String(item.year) : (item.publishDate || ""),
          });
        }
      };

      addCosmosReleases(res.releases.albums?.releases, "album");
      addCosmosReleases(res.releases.singles?.releases, "single");
      addCosmosReleases(res.releases.compilations?.releases, "compilation");
    }
  } catch (err) {
    console.warn("[Random Library] Cosmos discography fetch error:", err);
  }

  // Layer 4: Spicetify GraphQL Discography Queries
  if (Spicetify.GraphQL?.Request) {
    const extractGraphQLItems = (collection, groupType) => {
      if (!collection?.items) return 0;
      for (const entry of collection.items) {
        const rel = entry.releases?.items?.[0] || entry;
        if (rel?.uri) {
          const relType = rel.type || rel.albumType || groupType || "";
          const totalTracks = rel.tracks?.totalCount || rel.tracks?.items?.length || 1;
          const artistsList = rel.artists?.items?.map((a) => a.profile?.name || a.name).filter(Boolean).join(", ");
          const imgUrl = rel.coverArt?.sources?.[0]?.url || rel.images?.[0]?.url || "";
          const relDate = rel.date?.year ? String(rel.date.year) : (rel.date?.isoString || rel.releaseDate || "");

          addRelease({
            uri: rel.uri,
            name: rel.name,
            artist: artistsList || artistName,
            imageUrl: imgUrl,
            type: classifyRelease(
              { ...rel, type: relType, total_tracks: totalTracks },
              groupType
            ),
            releaseDate: relDate,
          });
        }
      }
      return collection.totalCount ?? collection.items.length;
    };

    // 4a. Artist Overview Query (fetches initial albums, singles, compilations)
    try {
      const overviewDef =
        Spicetify.GraphQL.Definitions?.queryArtistOverview || {
          name: "queryArtistOverview",
          operation: "query",
          sha256Hash: "ae0e2958a4ab645b35ca19ac04d0495ae12d9c5d7b7286217674801a9aab281a",
          value: null,
        };

      const { data } = await Spicetify.GraphQL.Request(overviewDef, {
        uri: artistUri,
        locale: Spicetify.Locale?.getLocale?.() || "en",
      });

      const discog = data?.artistUnion?.discography;
      if (discog) {
        extractGraphQLItems(discog.albums, "album");
        extractGraphQLItems(discog.singles, "single");
        extractGraphQLItems(discog.compilations, "compilation");
        extractGraphQLItems(discog.all, "");
        extractGraphQLItems(discog.popularReleasesAlbums, "album");
      }
    } catch (err) {
      console.warn("[Random Library] GraphQL overview query error:", err);
    }

    // 4b. Paginated Discography Queries (requires order: "DATE_DESC")
    const paginatedDefs = [
      Spicetify.GraphQL.Definitions?.queryArtistDiscographyAll || {
        name: "queryArtistDiscographyAll",
        operation: "query",
        sha256Hash: "5e07d323febb57b4a56a42abbf781490e58764aa45feb6e3dc0591564fc56599",
        value: null,
      },
      Spicetify.GraphQL.Definitions?.queryArtistDiscographyAlbums,
      Spicetify.GraphQL.Definitions?.queryArtistDiscographySingles,
      Spicetify.GraphQL.Definitions?.queryArtistDiscographyCompilations,
    ].filter(Boolean);

    for (const def of paginatedDefs) {
      try {
        let offset = 0;
        let total = Infinity;
        while (offset < total && offset < 500) {
          const { data } = await Spicetify.GraphQL.Request(def, {
            uri: artistUri,
            offset,
            limit: 100,
            order: "DATE_DESC",
          });

          const discog = data?.artistUnion?.discography;
          if (!discog) break;

          const t1 = extractGraphQLItems(discog.all, "");
          const t2 = extractGraphQLItems(discog.albums, "album");
          const t3 = extractGraphQLItems(discog.singles, "single");
          const t4 = extractGraphQLItems(discog.compilations, "compilation");

          total = Math.max(t1, t2, t3, t4, 0);
          if (total === 0 || offset >= total) break;
          offset += 100;
        }
      } catch (err) {
        console.warn("[Random Library] GraphQL discography query error:", err);
      }
    }
  }

  artistDiscographyCache.set(artistUri, releases);
  return releases;
}

// Module-level caches
let savedAlbumCache = null;
let savedShuffledCache = null;
let followedArtistCache = null;
let followedArtistShuffledCache = null;

const STORAGE_ACTIVE_MODE = "random-library:active-mode";
const STORAGE_SELECTED_ARTIST = "random-library:selected-artist";
const STORAGE_RELEASE_FILTER = "random-library:release-filter";
const STORAGE_HISTORY_STACK = "random-library:history-stack";
const STORAGE_HISTORY_INDEX = "random-library:history-index";

// ---------------------------------------------------------------------------
// 6. Styles & Design Tokens (Spotify Native Aesthetic)
// ---------------------------------------------------------------------------
const STYLES = {
  page: {
    padding: "48px 32px 32px",
    maxWidth: "100%",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "20px",
    gap: "16px",
    flexWrap: "wrap",
  },
  titleGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  title: {
    fontSize: "26px",
    fontWeight: "800",
    color: "var(--spice-text)",
    letterSpacing: "-0.5px",
  },
  subtitle: {
    fontSize: "13px",
    color: "var(--spice-subtext)",
  },
  headerControls: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
  },
  modeToggleGroup: {
    display: "inline-flex",
    background: "rgba(255, 255, 255, 0.07)",
    borderRadius: "500px",
    padding: "3px",
    border: "1px solid rgba(255, 255, 255, 0.1)",
  },
  modeBtn: (active) => ({
    background: active ? "var(--spice-text)" : "transparent",
    color: active ? "var(--spice-main, #121212)" : "var(--spice-subtext)",
    border: "none",
    borderRadius: "500px",
    padding: "6px 14px",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer",
    transition: "all 0.15s ease",
  }),
  shuffleBtn: {
    background: "var(--spice-button, #1ed760)",
    color: "var(--spice-text, #000)",
    border: "none",
    borderRadius: "500px",
    padding: "8px 20px",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    transition: "transform 0.1s ease, filter 0.2s ease",
  },
  actionBtn: {
    background: "rgba(255, 255, 255, 0.1)",
    color: "var(--spice-text)",
    border: "1px solid rgba(255, 255, 255, 0.15)",
    borderRadius: "500px",
    padding: "8px 16px",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    transition: "background 0.2s ease, transform 0.1s ease",
  },
  historyNavGroup: {
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
    background: "rgba(255,255,255,0.06)",
    borderRadius: "500px",
    padding: "2px",
    border: "1px solid rgba(255,255,255,0.1)",
  },
  historyBtn: (enabled) => ({
    background: "transparent",
    color: enabled ? "var(--spice-text)" : "rgba(255,255,255,0.25)",
    border: "none",
    borderRadius: "500px",
    width: "28px",
    height: "28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: enabled ? "pointer" : "default",
    transition: "background 0.15s ease, color 0.15s ease",
  }),
  backBtn: {
    background: "transparent",
    color: "var(--spice-subtext)",
    border: "none",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 0",
  },
  artistBanner: {
    display: "flex",
    alignItems: "center",
    gap: "20px",
    marginBottom: "28px",
    padding: "16px 20px",
    background: "rgba(255,255,255,0.04)",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.08)",
  },
  artistBannerAvatar: {
    width: "72px",
    height: "72px",
    borderRadius: "50%",
    objectFit: "cover",
  },
  artistBannerName: {
    fontSize: "22px",
    fontWeight: "800",
    color: "var(--spice-text)",
  },
  artistBannerSub: {
    fontSize: "13px",
    color: "var(--spice-subtext)",
    marginTop: "2px",
  },
  filterSection: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    marginBottom: "24px",
  },
  filterPillRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },
  pill: (active) => ({
    background: active ? "var(--spice-text)" : "rgba(255,255,255,0.08)",
    color: active ? "var(--spice-main, #121212)" : "var(--spice-text)",
    border: active ? "1px solid var(--spice-text)" : "1px solid rgba(255,255,255,0.1)",
    borderRadius: "500px",
    padding: "6px 14px",
    fontSize: "12px",
    fontWeight: "700",
    cursor: "pointer",
    transition: "all 0.15s ease",
    display: "flex",
    alignItems: "center",
    gap: "6px",
  }),
  pillCount: (active) => ({
    fontSize: "10px",
    opacity: active ? 0.7 : 0.5,
    fontWeight: "600",
  }),
  controlsRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
  },
  searchWrapper: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    minWidth: "260px",
    maxWidth: "460px",
    flex: "1 1 280px",
  },
  searchIcon: {
    position: "absolute",
    left: "12px",
    color: "var(--spice-subtext)",
    pointerEvents: "none",
    zIndex: 2,
  },
  searchInput: {
    background: "rgba(255,255,255,0.07)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "500px",
    color: "var(--spice-text)",
    fontSize: "13px",
    padding: "8px 16px 8px 34px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    textOverflow: "ellipsis",
    transition: "border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease",
  },
  selectWrapper: {
    position: "relative",
    display: "flex",
    alignItems: "center",
  },
  selectChevron: {
    position: "absolute",
    right: "10px",
    color: "var(--spice-subtext)",
    pointerEvents: "none",
  },
  select: {
    appearance: "none",
    background: "var(--spice-card, #282828)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "500px",
    color: "var(--spice-text)",
    fontSize: "13px",
    padding: "7px 28px 7px 12px",
    outline: "none",
    cursor: "pointer",
    colorScheme: "dark",
  },
  clearBtn: {
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: "500px",
    color: "var(--spice-subtext)",
    fontSize: "12px",
    padding: "6px 12px",
    cursor: "pointer",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(max(var(--grid-column-min-width, 170px), 140px), 1fr))",
    gap: "var(--grid-gap, 20px)",
  },
  card: {
    cursor: "pointer",
    position: "relative",
    borderRadius: "8px",
    padding: "12px",
    background: "rgba(255,255,255,0.03)",
    transition: "background 0.2s ease, transform 0.15s ease",
  },
  imageWrapper: {
    position: "relative",
    width: "100%",
    paddingBottom: "100%",
    marginBottom: "10px",
    borderRadius: "6px",
    overflow: "hidden",
  },
  artistAvatarWrapper: {
    position: "relative",
    width: "100%",
    paddingBottom: "100%",
    marginBottom: "10px",
    borderRadius: "50%",
    overflow: "hidden",
  },
  image: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  badge: (type) => ({
    position: "absolute",
    top: "6px",
    left: "6px",
    fontSize: "9px",
    fontWeight: "800",
    textTransform: "uppercase",
    padding: "2px 6px",
    borderRadius: "4px",
    letterSpacing: "0.5px",
    color: "#fff",
    background:
      type === "single"
        ? "#1db954"
        : type === "compilation"
        ? "#f59b23"
        : type === "appears_on"
        ? "#4b917d"
        : "rgba(0, 0, 0, 0.65)",
    border: type === "album" || !type ? "1px solid rgba(255, 255, 255, 0.2)" : "none",
    backdropFilter: "blur(6px)",
    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.4)",
    zIndex: 3,
  }),
  editionInlineChip: (label) => {
    const isDeluxe = /deluxe|director'?s cut|expanded|complete|special/i.test(label);
    const isRemaster = /remaster|anniversary|re-?issue/i.test(label);
    return {
      display: "inline-flex",
      alignItems: "center",
      fontSize: "9px",
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
      padding: "1px 5px",
      borderRadius: "3px",
      marginLeft: "6px",
      verticalAlign: "middle",
      background: isDeluxe
        ? "linear-gradient(135deg, rgba(138, 35, 135, 0.4), rgba(233, 64, 87, 0.4))"
        : isRemaster
        ? "rgba(0, 168, 255, 0.3)"
        : "rgba(255, 255, 255, 0.15)",
      color: isDeluxe ? "#ff758c" : isRemaster ? "#70a1ff" : "var(--spice-subtext)",
      border: isDeluxe
        ? "1px solid rgba(233, 64, 87, 0.5)"
        : isRemaster
        ? "1px solid rgba(0, 168, 255, 0.5)"
        : "1px solid rgba(255, 255, 255, 0.2)",
    };
  },
  inLibraryBadge: {
    position: "absolute",
    top: "6px",
    right: "6px",
    width: "20px",
    height: "20px",
    borderRadius: "50%",
    background: "var(--spice-button, #1ed760)",
    color: "#121212",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
    zIndex: 3,
  },
  editionBadge: (isUpgrade) => ({
    position: "absolute",
    bottom: "6px",
    left: "6px",
    fontSize: "9px",
    fontWeight: "800",
    textTransform: "uppercase",
    padding: "3px 7px",
    borderRadius: "4px",
    letterSpacing: "0.5px",
    color: "#fff",
    background: isUpgrade
      ? "linear-gradient(135deg, #8a2387, #e94057, #f27121)"
      : "rgba(30, 30, 30, 0.85)",
    backdropFilter: "blur(6px)",
    boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
    border: isUpgrade ? "1px solid rgba(255,255,255,0.3)" : "1px solid rgba(255,255,255,0.15)",
    display: "flex",
    alignItems: "center",
    gap: "4px",
    cursor: "pointer",
    zIndex: 4,
    transition: "transform 0.15s ease",
  }),
  editionDropdown: {
    position: "absolute",
    bottom: "32px",
    left: "6px",
    right: "6px",
    background: "rgba(20, 20, 20, 0.95)",
    backdropFilter: "blur(12px)",
    borderRadius: "8px",
    border: "1px solid rgba(255, 255, 255, 0.15)",
    padding: "6px",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.8)",
    zIndex: 10,
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    maxHeight: "160px",
    overflowY: "auto",
  },
  editionItem: (isActive) => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 8px",
    borderRadius: "4px",
    background: isActive ? "rgba(255, 255, 255, 0.12)" : "transparent",
    color: "var(--spice-text)",
    fontSize: "11px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "background 0.1s ease",
    textAlign: "left",
    border: "none",
    width: "100%",
  }),
  albumName: {
    fontSize: "14px",
    fontWeight: "700",
    color: "var(--spice-text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  artistName: {
    fontSize: "12px",
    color: "var(--spice-subtext)",
    marginTop: "2px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  artistCardName: {
    fontSize: "14px",
    fontWeight: "700",
    color: "var(--spice-text)",
    textAlign: "center",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    marginTop: "6px",
  },
  artistLabel: {
    fontSize: "12px",
    color: "var(--spice-subtext)",
    textAlign: "center",
    marginTop: "2px",
  },
  playBtn: {
    position: "absolute",
    bottom: "8px",
    right: "8px",
    width: "44px",
    height: "44px",
    borderRadius: "50%",
    background: "#1ed760",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 8px 12px rgba(0,0,0,.4)",
    transition: "transform 0.2s ease, opacity 0.2s ease",
  },
  loadingContainer: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "45vh",
    gap: "16px",
    color: "var(--spice-subtext)",
  },
};

// ---------------------------------------------------------------------------
// 7. Components
// ---------------------------------------------------------------------------

function AlbumCard({ album, isSaved = false }) {
  const [hovered, setHovered] = useState(false);
  const [showEditions, setShowEditions] = useState(false);

  function handleClick() {
    if (showEditions) return;
    const albumId = album.uri.split(":").pop();
    Spicetify.Platform.History.push("/album/" + albumId);
  }

  function handlePlay(e) {
    e.stopPropagation();
    Spicetify.Player.playUri(album.uri);
  }

  function handleEditionClick(e, ed) {
    e.stopPropagation();
    setShowEditions(false);
    const albumId = ed.uri.split(":").pop();
    Spicetify.Platform.History.push("/album/" + albumId);
  }

  const hasEditions = Boolean(album.editions && album.editions.length > 1);

  return React.createElement(
    "div",
    {
      style: {
        ...STYLES.card,
        background: hovered ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
        position: "relative",
      },
      onClick: handleClick,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => {
        setHovered(false);
        setShowEditions(false);
      },
      title: `${album.name} – ${album.artist}${isSaved ? " (In Library)" : ""}`,
    },
    React.createElement(
      "div",
      { style: STYLES.imageWrapper },
      album.imageUrl
        ? React.createElement("img", {
            src: album.imageUrl,
            alt: album.name,
            style: STYLES.image,
            loading: "lazy",
          })
        : React.createElement("div", {
            style: { ...STYLES.image, background: "var(--spice-card, #333)" },
          }),
      // Top Left: Always show release type badge (Album, Single / EP, Compilation, Appears On)
      React.createElement(
        "div",
        { style: STYLES.badge(album.type || "album") },
        album.type === "single"
          ? "Single / EP"
          : album.type === "compilation"
          ? "Compilation"
          : album.type === "appears_on"
          ? "Appears On"
          : "Album"
      ),
      // Bottom Left: Edition status at a glance (Deluxe Available or N Editions) ONLY if multi-editions exist
      hasEditions && React.createElement(
        "div",
        {
          style: STYLES.editionBadge(album.hasUpgradeAvailable),
          onClick: (e) => {
            e.stopPropagation();
            setShowEditions((prev) => !prev);
          },
          title: "Click to view and switch editions",
        },
        React.createElement(
          "svg",
          { width: "10", height: "10", viewBox: "0 0 24 24", fill: "currentColor" },
          React.createElement("path", { d: "M13 2L3 14h9l-1 8 10-12h-9l1-8z" })
        ),
        album.hasUpgradeAvailable
          ? "Deluxe Available"
          : `${album.editions.length} Editions ▾`
      ),
      isSaved && React.createElement(
        "div",
        {
          style: STYLES.inLibraryBadge,
          title: "In your Library",
          "aria-label": "In your Library",
        },
        React.createElement(
          "svg",
          { width: "12", height: "12", viewBox: "0 0 16 16", fill: "currentColor" },
          React.createElement("path", {
            d: "M13.985 2.383L5.674 12.14 1.34 7.805l1.414-1.414 2.92 2.92 6.897-8.106 1.414 1.178z",
          })
        )
      ),
      React.createElement(
        "button",
        {
          style: {
            ...STYLES.playBtn,
            opacity: hovered && !showEditions ? 1 : 0,
            transform: hovered && !showEditions ? "scale(1) translateY(0)" : "scale(0.8) translateY(6px)",
          },
          onClick: handlePlay,
          title: "Play " + album.name,
          "aria-label": "Play " + album.name,
        },
        React.createElement(
          "svg",
          { width: "20", height: "20", viewBox: "0 0 24 24", fill: "#000" },
          React.createElement("path", { d: "M8 5v14l11-7z" })
        )
      ),
      showEditions && hasEditions && React.createElement(
        "div",
        {
          style: STYLES.editionDropdown,
          onClick: (e) => e.stopPropagation(),
        },
        React.createElement(
          "div",
          { style: { fontSize: "10px", color: "var(--spice-subtext)", padding: "2px 4px 4px 4px", fontWeight: "800", letterSpacing: "0.5px" } },
          "AVAILABLE EDITIONS"
        ),
        album.editions.map((ed) => {
          const isCurrent = ed.uri === album.uri;
          return React.createElement(
            "button",
            {
              key: ed.uri,
              style: STYLES.editionItem(isCurrent),
              onClick: (e) => handleEditionClick(e, ed),
              title: `Open ${ed.name}`,
            },
            React.createElement(
              "span",
              { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: "6px" } },
              ed.name
            ),
            ed.isSaved && React.createElement(
              "span",
              { style: { color: "#1ed760", fontSize: "11px", fontWeight: "bold" }, title: "In Library" },
              "✓"
            )
          );
        })
      )
    ),
    React.createElement("div", { style: STYLES.albumName }, album.name),
    React.createElement(
      "div",
      {
        style: {
          ...STYLES.artistName,
          cursor: "pointer",
        },
        onClick: (e) => {
          e.stopPropagation();
          let artistUri = album.artistUri;
          if (!artistUri && followedArtistCache && followedArtistCache.length > 0) {
            const match = followedArtistCache.find(
              (a) => a.name && a.name.toLowerCase() === (album.artist || "").toLowerCase()
            );
            if (match) artistUri = match.uri;
          }

          if (artistUri) {
            const id = artistUri.split(":").pop();
            Spicetify.Platform.History.push("/artist/" + id);
          } else if (album.artist) {
            Spicetify.Platform.History.push("/search/" + encodeURIComponent(album.artist));
          }
        },
        onMouseEnter: (e) => (e.currentTarget.style.textDecoration = "underline"),
        onMouseLeave: (e) => (e.currentTarget.style.textDecoration = "none"),
        title: `Go to ${album.artist || "Artist"}'s Spotify page`,
      },
      album.artist
    )
  );
}

function ArtistCard({ artist, onClick }) {
  const [hovered, setHovered] = useState(false);

  function handlePlay(e) {
    e.stopPropagation();
    Spicetify.Player.playUri(artist.uri);
  }

  function handleOpenSpotifyPage(e) {
    e.stopPropagation();
    const id = artist.uri ? artist.uri.split(":").pop() : artist.id;
    if (id) {
      Spicetify.Platform.History.push("/artist/" + id);
    }
  }

  return React.createElement(
    "div",
    {
      style: {
        ...STYLES.card,
        background: hovered ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
        textAlign: "center",
      },
      onClick: () => onClick(artist),
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      title: `${artist.name} (Click to open discography in Random Library)`,
    },
    React.createElement(
      "div",
      { style: STYLES.artistAvatarWrapper },
      artist.imageUrl
        ? React.createElement("img", {
            src: artist.imageUrl,
            alt: artist.name,
            style: STYLES.image,
            loading: "lazy",
          })
        : React.createElement("div", {
            style: { ...STYLES.image, background: "var(--spice-card, #333)" },
          }),
      React.createElement(
        "button",
        {
          style: {
            ...STYLES.playBtn,
            opacity: hovered ? 1 : 0,
            transform: hovered ? "scale(1) translateY(0)" : "scale(0.8) translateY(6px)",
          },
          onClick: handlePlay,
          title: "Play " + artist.name,
          "aria-label": "Play " + artist.name,
        },
        React.createElement(
          "svg",
          { width: "20", height: "20", viewBox: "0 0 24 24", fill: "#000" },
          React.createElement("path", { d: "M8 5v14l11-7z" })
        )
      )
    ),
    React.createElement("div", { style: STYLES.artistCardName }, artist.name),
    React.createElement(
      "div",
      {
        style: {
          ...STYLES.artistLabel,
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          cursor: "pointer",
          padding: "2px 8px",
          borderRadius: "12px",
          transition: "all 0.15s ease",
        },
        onClick: handleOpenSpotifyPage,
        onMouseEnter: (e) => {
          e.currentTarget.style.color = "var(--spice-text)";
          e.currentTarget.style.background = "rgba(255,255,255,0.1)";
        },
        onMouseLeave: (e) => {
          e.currentTarget.style.color = "var(--spice-subtext)";
          e.currentTarget.style.background = "transparent";
        },
        title: `Open ${artist.name}'s official Spotify profile`,
      },
      "Artist",
      React.createElement(
        "svg",
        { width: "10", height: "10", viewBox: "0 0 24 24", fill: "currentColor" },
        React.createElement("path", {
          d: "M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
        })
      )
    )
  );
}

function FilterPills({ activeFilter, onFilterChange, typeCounts }) {
  const filters = [
    { key: "all", label: "All" },
    { key: "saved", label: "In Library", iconCheck: true },
    { key: "album", label: "Albums" },
    { key: "single", label: "Singles & EPs" },
    { key: "compilation", label: "Compilations" },
    { key: "has_editions", label: "Alternative Editions", icon: true },
  ];

  return React.createElement(
    "div",
    { style: STYLES.filterPillRow },
    filters.map((f) => {
      const active = activeFilter === f.key;
      const count = typeCounts[f.key] ?? 0;
      const isZero = count === 0;

      return React.createElement(
        "button",
        {
          key: f.key,
          style: {
            ...STYLES.pill(active),
            ...(isZero && !active ? { opacity: 0.55 } : {}),
            ...(f.key === "saved" && !active
              ? {
                  border: isZero ? "1px solid rgba(255, 255, 255, 0.08)" : "1px solid rgba(30, 215, 96, 0.4)",
                  background: isZero ? "transparent" : "rgba(30, 215, 96, 0.08)",
                  color: isZero ? "var(--spice-subtext)" : "#1ed760",
                }
              : {}),
            ...(f.key === "has_editions" && !active
              ? {
                  border: isZero ? "1px solid rgba(255, 255, 255, 0.08)" : "1px solid rgba(233, 64, 87, 0.4)",
                  background: isZero ? "transparent" : "rgba(233, 64, 87, 0.08)",
                  color: isZero ? "var(--spice-subtext)" : "#ff758c",
                }
              : {}),
          },
          onClick: () => onFilterChange(f.key),
          title: `${f.label} (${count})`,
        },
        f.icon && React.createElement(
          "svg",
          { width: "12", height: "12", viewBox: "0 0 24 24", fill: "currentColor" },
          React.createElement("path", { d: "M13 2L3 14h9l-1 8 10-12h-9l1-8z" })
        ),
        f.iconCheck && React.createElement(
          "svg",
          {
            width: "12",
            height: "12",
            viewBox: "0 0 16 16",
            fill: "currentColor",
            style: { marginRight: "4px" },
          },
          React.createElement("path", {
            d: "M13.985 2.383L5.674 12.14 1.34 7.805l1.414-1.414 2.92 2.92 6.897-8.106 1.414 1.178z",
          })
        ),
        f.label,
        React.createElement("span", { style: STYLES.pillCount(active) }, count)
      );
    })
  );
}

// Module-level caches for search, sort, and navigation history persistence
let cachedMainSearchQuery = "";
let cachedArtistSearchQuery = "";
let cachedSortBy = "shuffle";
let cachedHistoryStack = null;
let cachedHistoryIndex = null;

// ---------------------------------------------------------------------------
// 8. Main Application Component
// ---------------------------------------------------------------------------
function RandomLibraryApp() {
  const [mode, setMode] = useState(() => {
    return Spicetify.LocalStorage.get(STORAGE_ACTIVE_MODE) || "albums";
  });

  const [savedAlbums, setSavedAlbums] = useState(savedAlbumCache || []);
  const [savedShuffled, setSavedShuffled] = useState(savedShuffledCache || []);

  const [followedArtists, setFollowedArtists] = useState(followedArtistCache || []);
  const [followedArtistsShuffled, setFollowedArtistsShuffled] = useState(followedArtistShuffledCache || []);

  // Persisted selected artist (restores exact artist when navigating back!)
  const [selectedArtist, setSelectedArtist] = useState(() => {
    try {
      const stored = Spicetify.LocalStorage.get(STORAGE_SELECTED_ARTIST);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  // In-app History Stack (persisted across app navigation and restarts!)
  const [historyStack, setHistoryStack] = useState(() => {
    if (cachedHistoryStack !== null) return cachedHistoryStack;
    try {
      const stored = Spicetify.LocalStorage.get(STORAGE_HISTORY_STACK);
      const parsed = stored ? JSON.parse(stored) : null;
      if (Array.isArray(parsed) && parsed.length > 0) {
        cachedHistoryStack = parsed;
        return parsed;
      }
    } catch {}
    try {
      const stored = Spicetify.LocalStorage.get(STORAGE_SELECTED_ARTIST);
      const parsed = stored ? JSON.parse(stored) : null;
      const initial = parsed ? [parsed] : [];
      cachedHistoryStack = initial;
      return initial;
    } catch {
      return [];
    }
  });

  const [historyIndex, setHistoryIndex] = useState(() => {
    if (cachedHistoryIndex !== null) return cachedHistoryIndex;
    try {
      const stored = Spicetify.LocalStorage.get(STORAGE_HISTORY_INDEX);
      if (stored !== null && stored !== undefined && stored !== "") {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed)) {
          cachedHistoryIndex = parsed;
          return parsed;
        }
      }
    } catch {}
    try {
      const stored = Spicetify.LocalStorage.get(STORAGE_SELECTED_ARTIST);
      const idx = stored ? 0 : -1;
      cachedHistoryIndex = idx;
      return idx;
    } catch {
      return -1;
    }
  });

  const [artistReleases, setArtistReleases] = useState([]);
  const [artistReleasesLoading, setArtistReleasesLoading] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Persisted release filter (persists across random artist rolls!)
  const [releaseFilter, setReleaseFilter] = useState(() => {
    return Spicetify.LocalStorage.get(STORAGE_RELEASE_FILTER) || "all";
  });

  // Separate search states for main page vs. inside artist discography (persisted)
  const [mainSearchQuery, setMainSearchQuery] = useState(() => cachedMainSearchQuery);
  const [debouncedMainQuery, setDebouncedMainQuery] = useState(() => cachedMainSearchQuery);
  const [artistSearchQuery, setArtistSearchQuery] = useState(() => cachedArtistSearchQuery);
  const [debouncedArtistQuery, setDebouncedArtistQuery] = useState(() => cachedArtistSearchQuery);
  const [sortBy, setSortBy] = useState(() => cachedSortBy);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    cachedMainSearchQuery = mainSearchQuery;
    const timer = setTimeout(() => setDebouncedMainQuery(mainSearchQuery), 150);
    return () => clearTimeout(timer);
  }, [mainSearchQuery]);

  useEffect(() => {
    cachedArtistSearchQuery = artistSearchQuery;
    const timer = setTimeout(() => setDebouncedArtistQuery(artistSearchQuery), 150);
    return () => clearTimeout(timer);
  }, [artistSearchQuery]);

  const handleFilterChange = useCallback((newFilter) => {
    setReleaseFilter(newFilter);
    Spicetify.LocalStorage.set(STORAGE_RELEASE_FILTER, newFilter);
  }, []);

  const handleModeChange = (newMode) => {
    setMode(newMode);
    setSelectedArtist(null);
    Spicetify.LocalStorage.remove(STORAGE_SELECTED_ARTIST);
    setArtistSearchQuery("");
    cachedArtistSearchQuery = "";
    Spicetify.LocalStorage.set(STORAGE_ACTIVE_MODE, newMode);
  };

  // Manual Refresh / Sync Button Handler
  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);

    // Clear caches & in-app history stack
    savedAlbumCache = null;
    savedShuffledCache = null;
    followedArtistCache = null;
    followedArtistShuffledCache = null;
    artistDiscographyCache.clear();

    if (selectedArtist) {
      setHistoryStack([selectedArtist]);
      setHistoryIndex(0);
      cachedHistoryStack = [selectedArtist];
      cachedHistoryIndex = 0;
      try {
        Spicetify.LocalStorage.set(STORAGE_HISTORY_STACK, JSON.stringify([selectedArtist]));
        Spicetify.LocalStorage.set(STORAGE_HISTORY_INDEX, "0");
      } catch {}
    } else {
      setHistoryStack([]);
      setHistoryIndex(-1);
      cachedHistoryStack = [];
      cachedHistoryIndex = -1;
      try {
        Spicetify.LocalStorage.remove(STORAGE_HISTORY_STACK);
        Spicetify.LocalStorage.remove(STORAGE_HISTORY_INDEX);
      } catch {}
    }

    try {
      const [albums, artists] = await Promise.all([
        fetchAllSavedAlbums(),
        fetchAllFollowedArtists(),
      ]);

      savedAlbumCache = albums;
      const shufAlbums = fisherYatesShuffle(albums);
      savedShuffledCache = shufAlbums;
      setSavedAlbums(albums);
      setSavedShuffled(shufAlbums);

      followedArtistCache = artists;
      const shufArtists = fisherYatesShuffle(artists);
      followedArtistShuffledCache = shufArtists;
      setFollowedArtists(artists);
      setFollowedArtistsShuffled(shufArtists);

      if (selectedArtist) {
        setArtistReleasesLoading(true);
        const freshReleases = await fetchArtistReleases(selectedArtist.uri, selectedArtist.name);
        setArtistReleases(freshReleases);
        setArtistReleasesLoading(false);
      }
    } catch (err) {
      console.error("[Random Library] Error during refresh:", err);
    } finally {
      setTimeout(() => setRefreshing(false), 350);
    }
  }, [refreshing, selectedArtist]);

  // Open Artist Discography View (tracks in-app history stack for instant back/forward navigation)
  const handleOpenArtist = useCallback(async (artist, recordHistory = true, preserveQuery = false) => {
    setSelectedArtist(artist);
    if (!preserveQuery) {
      setArtistSearchQuery("");
      cachedArtistSearchQuery = "";
    }
    setArtistReleasesLoading(true);
    Spicetify.LocalStorage.set(STORAGE_SELECTED_ARTIST, JSON.stringify(artist));

    if (recordHistory) {
      setHistoryStack((prev) => {
        const upToCurrent = prev.slice(0, historyIndex + 1);
        if (upToCurrent.length > 0 && upToCurrent[upToCurrent.length - 1].uri === artist.uri) {
          return upToCurrent;
        }
        const next = [...upToCurrent, artist];
        const nextIdx = next.length - 1;
        setHistoryIndex(nextIdx);
        cachedHistoryStack = next;
        cachedHistoryIndex = nextIdx;
        try {
          Spicetify.LocalStorage.set(STORAGE_HISTORY_STACK, JSON.stringify(next));
          Spicetify.LocalStorage.set(STORAGE_HISTORY_INDEX, String(nextIdx));
        } catch {}
        return next;
      });
    }

    try {
      const releases = await fetchArtistReleases(artist.uri, artist.name);
      setArtistReleases(releases);
    } catch (err) {
      console.error("[Random Library] Error opening artist discography:", err);
    } finally {
      setArtistReleasesLoading(false);
    }
  }, [historyIndex]);

  const handleCloseArtist = useCallback(() => {
    setSelectedArtist(null);
    setArtistSearchQuery("");
    cachedArtistSearchQuery = "";
    Spicetify.LocalStorage.remove(STORAGE_SELECTED_ARTIST);
  }, []);

  // In-App History Back & Forward Navigation Controls
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex >= 0 && historyIndex < historyStack.length - 1;

  const handleHistoryBack = useCallback(() => {
    if (historyIndex > 0) {
      const prevIdx = historyIndex - 1;
      const target = historyStack[prevIdx];
      setHistoryIndex(prevIdx);
      cachedHistoryIndex = prevIdx;
      try {
        Spicetify.LocalStorage.set(STORAGE_HISTORY_INDEX, String(prevIdx));
      } catch {}
      handleOpenArtist(target, false);
    }
  }, [historyIndex, historyStack, handleOpenArtist]);

  const handleHistoryForward = useCallback(() => {
    if (historyIndex < historyStack.length - 1) {
      const nextIdx = historyIndex + 1;
      const target = historyStack[nextIdx];
      setHistoryIndex(nextIdx);
      cachedHistoryIndex = nextIdx;
      try {
        Spicetify.LocalStorage.set(STORAGE_HISTORY_INDEX, String(nextIdx));
      } catch {}
      handleOpenArtist(target, false);
    }
  }, [historyIndex, historyStack, handleOpenArtist]);

  // Restore active artist on boot if present without clearing search query
  useEffect(() => {
    if (selectedArtist) {
      handleOpenArtist(selectedArtist, false, true);
    }
  }, []);

  // Load Saved Library
  const loadSavedLibrary = useCallback(async () => {
    try {
      if (savedAlbumCache && savedAlbumCache.length > 0) {
        setSavedAlbums(savedAlbumCache);
        if (!savedShuffledCache) {
          savedShuffledCache = fisherYatesShuffle(savedAlbumCache);
        }
        setSavedShuffled(savedShuffledCache);
        return;
      }
      const data = await fetchAllSavedAlbums();
      savedAlbumCache = data;
      setSavedAlbums(data);

      const restored = fisherYatesShuffle(data);
      savedShuffledCache = restored;
      setSavedShuffled(restored);
    } catch (err) {
      console.error("[Random Library] Failed to load saved library:", err);
    }
  }, []);

  // Load Followed Artists
  const loadFollowedArtists = useCallback(async () => {
    try {
      if (followedArtistCache && followedArtistCache.length > 0) {
        setFollowedArtists(followedArtistCache);
        if (!followedArtistShuffledCache) {
          followedArtistShuffledCache = fisherYatesShuffle(followedArtistCache);
        }
        setFollowedArtistsShuffled(followedArtistShuffledCache);
        return;
      }
      const data = await fetchAllFollowedArtists();
      followedArtistCache = data;
      setFollowedArtists(data);

      const restored = fisherYatesShuffle(data);
      followedArtistShuffledCache = restored;
      setFollowedArtistsShuffled(restored);
    } catch (err) {
      console.error("[Random Library] Failed to load followed artists:", err);
    }
  }, []);

  useEffect(() => {
    registerExportMenu();
    Promise.all([loadSavedLibrary(), loadFollowedArtists()])
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [loadSavedLibrary, loadFollowedArtists]);

  // Random Artist Pick (persists active release filter & pushes to history!)
  const handlePickRandomArtist = useCallback(() => {
    if (!followedArtists || followedArtists.length === 0) return;
    const randomArtist = followedArtists[Math.floor(Math.random() * followedArtists.length)];
    handleOpenArtist(randomArtist, true);
  }, [followedArtists, handleOpenArtist]);

  // Random Album Pick (picks and opens a random saved album!)
  const handlePickRandomAlbum = useCallback(() => {
    if (!savedAlbums || savedAlbums.length === 0) return;
    const randomAlbum = savedAlbums[Math.floor(Math.random() * savedAlbums.length)];
    const albumId = getSpotifyId(randomAlbum.uri);
    if (albumId) Spicetify.Platform.History.push("/album/" + albumId);
  }, [savedAlbums]);

  // Reshuffle
  const handleReshuffle = useCallback(() => {
    if (mode === "albums") {
      const fresh = fisherYatesShuffle(savedAlbums);
      savedShuffledCache = fresh;
      setSavedShuffled(fresh);
    } else {
      const fresh = fisherYatesShuffle(followedArtists);
      followedArtistShuffledCache = fresh;
      setFollowedArtistsShuffled(fresh);
    }
  }, [mode, savedAlbums, followedArtists]);

  // Filter & Sort: Albums Mode
  const displayedSavedAlbums = useMemo(() => {
    let list = sortBy === "shuffle" ? [...savedShuffled] : [...savedAlbums];

    if (sortBy === "name-asc") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === "name-desc") list.sort((a, b) => b.name.localeCompare(a.name));
    else if (sortBy === "artist-asc") list.sort((a, b) => a.artist.localeCompare(b.artist));
    else if (sortBy === "artist-desc") list.sort((a, b) => b.artist.localeCompare(a.artist));

    if (debouncedMainQuery.trim()) {
      const q = debouncedMainQuery.trim();
      list = list.filter(
        (a) => matchesSearchQuery(a.name, q) || matchesSearchQuery(a.artist, q)
      );
    }

    return list;
  }, [savedShuffled, savedAlbums, sortBy, debouncedMainQuery]);

  // Filter & Sort: Artists Mode
  const displayedArtists = useMemo(() => {
    let list = sortBy === "shuffle" ? [...followedArtistsShuffled] : [...followedArtists];

    if (sortBy === "artist-asc" || sortBy === "name-asc") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === "artist-desc" || sortBy === "name-desc") list.sort((a, b) => b.name.localeCompare(a.name));

    if (debouncedMainQuery.trim()) {
      const q = debouncedMainQuery.trim();
      list = list.filter((a) => matchesSearchQuery(a.name, q));
    }

    return list;
  }, [followedArtistsShuffled, followedArtists, sortBy, debouncedMainQuery]);

  // Fast lookup set of saved album URIs and normalized titles for fuzzy cross-edition saved matching
  const savedUriSet = useMemo(() => {
    return new Set(savedAlbums.map((a) => a.uri));
  }, [savedAlbums]);

  const savedNameSet = useMemo(() => {
    const set = new Set();
    for (const a of savedAlbums) {
      const norm = normalizeAlbumTitle(a.name);
      const normArtist = normalizeAlbumTitle(a.artist);
      if (norm && normArtist) {
        set.add(`${normArtist}:${norm}`);
      }
    }
    return set;
  }, [savedAlbums]);

  // Exact unmodified saved album names scoped to artist
  const savedExactNameSet = useMemo(() => {
    const set = new Set();
    for (const a of savedAlbums) {
      const normArtist = normalizeAlbumTitle(a.artist);
      if (a.name && normArtist) {
        set.add(`${normArtist}:${a.name.toLowerCase().trim()}`);
      }
    }
    return set;
  }, [savedAlbums]);

  const isAlbumSaved = useCallback(
    (album) => {
      if (!album) return false;
      if (savedUriSet.has(album.uri)) return true;
      const norm = normalizeAlbumTitle(album.name);
      const normArtist = normalizeAlbumTitle(album.artist || (selectedArtist ? selectedArtist.name : ""));
      if (norm && normArtist) {
        return savedNameSet.has(`${normArtist}:${norm}`);
      }
      return false;
    },
    [savedUriSet, savedNameSet, selectedArtist]
  );

  // Deduplicate releases in artist discography, prioritize saved version, or newest/expanded edition
  const deduplicatedArtistReleases = useMemo(() => {
    const map = new Map();

    for (const album of artistReleases) {
      const norm = normalizeAlbumTitle(album.name) || album.name.toLowerCase().trim();
      const key = norm;
      const normArtist = normalizeAlbumTitle(album.artist || (selectedArtist ? selectedArtist.name : ""));
      const isExactEditionSaved = savedUriSet.has(album.uri) || (
        normArtist ? savedExactNameSet.has(`${normArtist}:${album.name.toLowerCase().trim()}`) : false
      );
      const edition = getEditionInfo(album.name);

      const entry = {
        uri: album.uri,
        name: album.name,
        imageUrl: album.imageUrl,
        type: album.type || "album",
        releaseDate: album.releaseDate || "",
        editionLabel: edition.label,
        isDeluxe: edition.isDeluxe,
        isRemaster: edition.isRemaster,
        isSaved: isExactEditionSaved,
      };

      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          ...album,
          baseTitle: norm,
          editions: [entry],
        });
      } else {
        if (!existing.editions.some((e) => e.uri === album.uri)) {
          existing.editions.push(entry);
        }
        if (existing.type !== "album" && album.type === "album") {
          existing.type = "album";
        }
      }
    }

    return Array.from(map.values()).map((album) => {
      const editions = album.editions || [];
      const hasEditions = editions.length > 1;

      // 1. Check if user has an edition saved in their library
      const savedEdition = editions.find((e) => e.isSaved);

      // 2. Select primary edition:
      // - If in library: use the saved edition
      // - If not in library: prefer Deluxe/Expanded > Remaster > Newest Release Date
      let selectedEdition;
      if (savedEdition) {
        selectedEdition = savedEdition;
      } else {
        const sorted = [...editions].sort((a, b) => {
          if (a.isDeluxe !== b.isDeluxe) return a.isDeluxe ? -1 : 1;
          if (a.isRemaster !== b.isRemaster) return a.isRemaster ? -1 : 1;
          const dateA = String(a.releaseDate || "");
          const dateB = String(b.releaseDate || "");
          return dateB.localeCompare(dateA);
        });
        selectedEdition = sorted[0] || album;
      }

      const hasDeluxeEdition = editions.some((e) => e.isDeluxe || e.isRemaster);
      const savedIsDeluxe = savedEdition && (savedEdition.isDeluxe || savedEdition.isRemaster);
      // Upgrade is true when multiple editions exist, you have an edition saved, but it's not the deluxe version
      const hasUpgrade = hasEditions && Boolean(savedEdition) && !savedIsDeluxe && hasDeluxeEdition;

      return {
        ...album,
        uri: selectedEdition.uri,
        name: selectedEdition.name,
        imageUrl: selectedEdition.imageUrl || album.imageUrl,
        isSaved: Boolean(savedEdition),
        hasAlternativeEditions: hasEditions,
        hasUpgradeAvailable: hasUpgrade,
        editions,
      };
    });
  }, [artistReleases, savedUriSet, savedExactNameSet]);

  // Filter & Sort: Discography View
  const typeCounts = useMemo(() => {
    const counts = { all: deduplicatedArtistReleases.length, saved: 0, has_editions: 0 };
    for (const a of deduplicatedArtistReleases) {
      const t = a.type || "album";
      counts[t] = (counts[t] || 0) + 1;
      if (a.isSaved) {
        counts.saved = (counts.saved || 0) + 1;
      }
      if (a.hasAlternativeEditions) {
        counts.has_editions = (counts.has_editions || 0) + 1;
      }
    }
    return counts;
  }, [deduplicatedArtistReleases]);

  const displayedArtistReleases = useMemo(() => {
    let list = [...deduplicatedArtistReleases];

    if (releaseFilter === "saved") {
      list = list.filter((a) => a.isSaved);
    } else if (releaseFilter === "has_editions") {
      list = list.filter((a) => a.hasAlternativeEditions);
    } else if (releaseFilter !== "all") {
      list = list.filter((a) => a.type === releaseFilter);
    }

    if (debouncedArtistQuery.trim()) {
      const q = debouncedArtistQuery.trim();
      list = list.filter((a) => matchesSearchQuery(a.name, q));
    }

    return list;
  }, [deduplicatedArtistReleases, releaseFilter, debouncedArtistQuery]);

  const hasArtistFilters = artistSearchQuery.trim() !== "" || releaseFilter !== "all";
  const hasMainFilters = mainSearchQuery.trim() !== "" || sortBy !== "shuffle";

  function handleClearArtistFilters() {
    setArtistSearchQuery("");
    cachedArtistSearchQuery = "";
    handleFilterChange("all");
  }

  function handleClearMainFilters() {
    setMainSearchQuery("");
    cachedMainSearchQuery = "";
    setSortBy("shuffle");
    cachedSortBy = "shuffle";
  }

  if (loading) {
    return React.createElement(
      "div",
      { style: STYLES.loadingContainer },
      React.createElement("div", { style: { fontSize: "16px" } }, "Loading your library\u2026")
    );
  }

  if (error) {
    return React.createElement(
      "div",
      { style: { ...STYLES.loadingContainer, color: "#f15e6c" } },
      "Error: " + error
    );
  }

  return React.createElement(
    "div",
    { style: STYLES.page },

    // Header
    React.createElement(
      "div",
      { style: STYLES.header },
      // Left: Title, Subtitle, and Standardized Mode Toggles (Anchored)
      React.createElement(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "24px", flexWrap: "wrap" } },
        React.createElement(
          "div",
          { style: STYLES.titleGroup },
          React.createElement("div", { style: STYLES.title }, "Random Library"),
          React.createElement(
            "div",
            { style: STYLES.subtitle },
            selectedArtist
              ? `${displayedArtistReleases.length} releases for ${selectedArtist.name}`
              : mode === "albums"
              ? `${displayedSavedAlbums.length} saved albums ${sortBy === "shuffle" ? "shuffled" : "listed"}`
              : `${displayedArtists.length} followed artists ${sortBy === "shuffle" ? "shuffled" : "listed"}`
          )
        ),
        // Standardized Mode switch pills
        React.createElement(
          "div",
          { style: STYLES.modeToggleGroup },
          React.createElement(
            "button",
            {
              style: STYLES.modeBtn(mode === "albums"),
              onClick: () => handleModeChange("albums"),
            },
            "Albums"
          ),
          React.createElement(
            "button",
            {
              style: STYLES.modeBtn(mode === "artists"),
              onClick: () => handleModeChange("artists"),
            },
            "Artists"
          )
        )
      ),

      // Right: Action buttons (Symmetric)
      React.createElement(
        "div",
        { style: STYLES.headerControls },
        // Random Album Button (in Albums mode)
        mode === "albums" && React.createElement(
          "button",
          {
            style: STYLES.actionBtn,
            onClick: handlePickRandomAlbum,
          },
          React.createElement(
            "svg",
            { width: "16", height: "16", viewBox: "0 0 24 24", fill: "currentColor" },
            React.createElement("path", {
              d: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z",
            })
          ),
          "Random Album"
        ),

        // Random Artist Button (in Artists mode) with in-app History navigation
        mode === "artists" && React.createElement(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "6px" } },
          historyStack.length > 1 && React.createElement(
            "div",
            { style: STYLES.historyNavGroup },
            React.createElement(
              "button",
              {
                style: STYLES.historyBtn(canGoBack),
                onClick: handleHistoryBack,
                disabled: !canGoBack,
                title: canGoBack ? `Previous: ${historyStack[historyIndex - 1]?.name}` : "No previous history",
                "aria-label": "Previous Artist",
              },
              React.createElement(
                "svg",
                { width: "16", height: "16", viewBox: "0 0 24 24", fill: "currentColor" },
                React.createElement("path", { d: "M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" })
              )
            ),
            React.createElement(
              "button",
              {
                style: STYLES.historyBtn(canGoForward),
                onClick: handleHistoryForward,
                disabled: !canGoForward,
                title: canGoForward ? `Next: ${historyStack[historyIndex + 1]?.name}` : "No forward history",
                "aria-label": "Next Artist",
              },
              React.createElement(
                "svg",
                { width: "16", height: "16", viewBox: "0 0 24 24", fill: "currentColor" },
                React.createElement("path", { d: "M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" })
              )
            )
          ),
          React.createElement(
            "button",
            {
              style: STYLES.actionBtn,
              onClick: handlePickRandomArtist,
            },
            React.createElement(
              "svg",
              { width: "16", height: "16", viewBox: "0 0 24 24", fill: "currentColor" },
              React.createElement("path", {
                d: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
              })
            ),
            "Random Artist"
          )
        ),

        // Refresh / Sync button
        React.createElement(
          "button",
          {
            style: {
              ...STYLES.actionBtn,
              opacity: refreshing ? 0.6 : 1,
              cursor: refreshing ? "default" : "pointer",
            },
            onClick: handleRefresh,
            disabled: refreshing,
            title: "Sync latest library & artist changes",
            "aria-label": "Refresh Library",
          },
          React.createElement(
            "svg",
            {
              width: "14",
              height: "14",
              viewBox: "0 0 24 24",
              fill: "currentColor",
              style: {
                animation: refreshing ? "rl-spin 0.8s linear infinite" : "none",
                display: "block",
              },
            },
            React.createElement("path", {
              d: "M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
            })
          ),
          refreshing ? "Syncing\u2026" : "Refresh"
        ),

        // Shuffle button
        React.createElement(
          "button",
          {
            style: STYLES.shuffleBtn,
            onClick: handleReshuffle,
            onMouseDown: (e) => { e.currentTarget.style.transform = "scale(0.95)"; },
            onMouseUp: (e) => { e.currentTarget.style.transform = "scale(1)"; },
            onMouseLeave: (e) => { e.currentTarget.style.transform = "scale(1)"; },
          },
          React.createElement(
            "svg",
            { width: "16", height: "16", viewBox: "0 0 16 16", fill: "currentColor" },
            React.createElement("path", {
              d: "M4.5 6.8l.7-.8C4.1 4.7 2.5 4 .9 4v1c1.3 0 2.6.6 3.5 1.6l.1.2zm7.5 4.7c-1.2 0-2.3-.5-3.2-1.3l-.6.8c1 1 2.4 1.5 3.8 1.5V14l3.5-2-3.5-2v1.5zm0-6V7l3.5-2L12 3v1.5c-1.6 0-3.2.7-4.2 2l-3.4 3.9c-.9 1-2.2 1.6-3.5 1.6v1c1.6 0 3.2-.7 4.2-2l3.4-3.9c.9-1 2.2-1.6 3.5-1.6z",
            })
          ),
          "Shuffle"
        )
      )
    ),

    // -----------------------------------------------------------------------
    // VIEW 1: Specific Artist Discography (When an artist is selected)
    // -----------------------------------------------------------------------
    selectedArtist && React.createElement(
      "div",
      null,
      // Top navigation bar with Back button and In-app History Navigation
      React.createElement(
        "div",
        { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" } },
        React.createElement(
          "button",
          {
            style: STYLES.backBtn,
            onClick: handleCloseArtist,
          },
          React.createElement(
            "svg",
            { width: "16", height: "16", viewBox: "0 0 24 24", fill: "currentColor" },
            React.createElement("path", { d: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" })
          ),
          "Back to Artists"
        ),
        historyStack.length > 1 && React.createElement(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "8px" } },
          React.createElement(
            "span",
            { style: { fontSize: "11px", color: "var(--spice-subtext)", fontWeight: "600" } },
            `${historyIndex + 1} of ${historyStack.length}`
          ),
          React.createElement(
            "div",
            { style: STYLES.historyNavGroup },
            React.createElement(
              "button",
              {
                style: STYLES.historyBtn(canGoBack),
                onClick: handleHistoryBack,
                disabled: !canGoBack,
                title: canGoBack ? `Previous: ${historyStack[historyIndex - 1]?.name}` : "No previous artist",
                "aria-label": "Previous Artist",
              },
              React.createElement(
                "svg",
                { width: "16", height: "16", viewBox: "0 0 24 24", fill: "currentColor" },
                React.createElement("path", { d: "M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" })
              )
            ),
            React.createElement(
              "button",
              {
                style: STYLES.historyBtn(canGoForward),
                onClick: handleHistoryForward,
                disabled: !canGoForward,
                title: canGoForward ? `Next: ${historyStack[historyIndex + 1]?.name}` : "No forward history",
                "aria-label": "Next Artist",
              },
              React.createElement(
                "svg",
                { width: "16", height: "16", viewBox: "0 0 24 24", fill: "currentColor" },
                React.createElement("path", { d: "M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" })
              )
            )
          )
        )
      ),

      // Artist Banner
      React.createElement(
        "div",
        { style: STYLES.artistBanner },
        selectedArtist.imageUrl && React.createElement("img", {
          src: selectedArtist.imageUrl,
          alt: selectedArtist.name,
          style: { ...STYLES.artistBannerAvatar, cursor: "pointer" },
          onClick: () => {
            const id = selectedArtist.uri ? selectedArtist.uri.split(":").pop() : selectedArtist.id;
            if (id) Spicetify.Platform.History.push("/artist/" + id);
          },
          title: `Go to ${selectedArtist.name}'s Spotify profile`,
        }),
        React.createElement(
          "div",
          { style: { flex: 1 } },
          React.createElement(
            "div",
            {
              style: { ...STYLES.artistBannerName, cursor: "pointer", display: "inline-block" },
              onClick: () => {
                const id = selectedArtist.uri ? selectedArtist.uri.split(":").pop() : selectedArtist.id;
                if (id) Spicetify.Platform.History.push("/artist/" + id);
              },
              onMouseEnter: (e) => (e.currentTarget.style.textDecoration = "underline"),
              onMouseLeave: (e) => (e.currentTarget.style.textDecoration = "none"),
              title: `Go to ${selectedArtist.name}'s Spotify profile`,
            },
            selectedArtist.name
          ),
          React.createElement(
            "div",
            { style: STYLES.artistBannerSub },
            `${displayedArtistReleases.length} releases available`
          )
        ),
        React.createElement(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" } },
          React.createElement(
            "button",
            {
              style: STYLES.actionBtn,
              onClick: () => {
                const id = selectedArtist.uri ? selectedArtist.uri.split(":").pop() : selectedArtist.id;
                if (id) Spicetify.Platform.History.push("/artist/" + id);
              },
              title: `Open ${selectedArtist.name}'s official Spotify profile`,
            },
            React.createElement(
              "svg",
              { width: "16", height: "16", viewBox: "0 0 24 24", fill: "currentColor" },
              React.createElement("path", {
                d: "M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
              })
            ),
            "Artist Page"
          ),
          React.createElement(
            "button",
            {
              style: STYLES.shuffleBtn,
              onClick: () => Spicetify.Player.playUri(selectedArtist.uri),
            },
            "Play Artist"
          )
        )
      ),

      // Filter Section for Artist Discography
      React.createElement(
        "div",
        { style: STYLES.filterSection },
        React.createElement(FilterPills, {
          activeFilter: releaseFilter,
          onFilterChange: handleFilterChange,
          typeCounts,
        }),
        React.createElement(
          "div",
          { style: STYLES.controlsRow },
          React.createElement(
            "div",
            { style: STYLES.searchWrapper },
            React.createElement(
              "svg",
              { style: STYLES.searchIcon, width: "14", height: "14", viewBox: "0 0 24 24", fill: "currentColor" },
              React.createElement("path", {
                d: "M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
              })
            ),
            React.createElement("input", {
              type: "text",
              placeholder: `Search in ${selectedArtist.name} releases\u2026`,
              value: artistSearchQuery,
              onChange: (e) => setArtistSearchQuery(e.target.value),
              style: STYLES.searchInput,
            })
          ),
          hasArtistFilters && React.createElement(
            "button",
            { style: STYLES.clearBtn, onClick: handleClearArtistFilters },
            "Clear filters"
          )
        )
      ),

      // Loading state for discography
      artistReleasesLoading && React.createElement(
        "div",
        { style: STYLES.loadingContainer },
        "Loading artist discography\u2026"
      ),

      // Discography Grid
      !artistReleasesLoading && displayedArtistReleases.length > 0 && React.createElement(
        "div",
        { style: STYLES.grid, className: "rl-grid main-gridContainer-gridContainer" },
        displayedArtistReleases.map((album, i) =>
          React.createElement(AlbumCard, {
            key: `${album.uri}-${i}`,
            album,
            isSaved: Boolean(album.isSaved || isAlbumSaved(album)),
          })
        )
      ),

      !artistReleasesLoading && displayedArtistReleases.length === 0 && React.createElement(
        "div",
        { style: STYLES.loadingContainer },
        "No releases match your filter."
      )
    ),

    // -----------------------------------------------------------------------
    // VIEW 2: Artists Grid (When no artist is selected)
    // -----------------------------------------------------------------------
    !selectedArtist && mode === "artists" && React.createElement(
      "div",
      null,
      // Search & Sort bar
      React.createElement(
        "div",
        { style: STYLES.filterSection },
        React.createElement(
          "div",
          { style: STYLES.controlsRow },
          React.createElement(
            "div",
            { style: STYLES.searchWrapper },
            React.createElement(
              "svg",
              { style: STYLES.searchIcon, width: "14", height: "14", viewBox: "0 0 24 24", fill: "currentColor" },
              React.createElement("path", {
                d: "M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
              })
            ),
            React.createElement("input", {
              type: "text",
              placeholder: "Search followed artists\u2026",
              value: mainSearchQuery,
              onChange: (e) => setMainSearchQuery(e.target.value),
              style: STYLES.searchInput,
            })
          ),

          React.createElement(
            "div",
            { style: STYLES.selectWrapper },
            React.createElement(
              "select",
              {
                value: sortBy,
                onChange: (e) => {
                  setSortBy(e.target.value);
                  cachedSortBy = e.target.value;
                },
                style: STYLES.select,
              },
              React.createElement("option", { value: "shuffle" }, "Shuffled"),
              React.createElement("option", { value: "artist-asc" }, "Artist A\u2013Z"),
              React.createElement("option", { value: "artist-desc" }, "Artist Z\u2013A")
            ),
            React.createElement(
              "svg",
              { style: STYLES.selectChevron, width: "12", height: "12", viewBox: "0 0 24 24", fill: "currentColor" },
              React.createElement("path", { d: "M7 10l5 5 5-5z" })
            )
          ),

          hasMainFilters && React.createElement(
            "button",
            { style: STYLES.clearBtn, onClick: handleClearMainFilters },
            "Clear filters"
          )
        )
      ),

      // Artists Grid
      displayedArtists.length > 0 && React.createElement(
        "div",
        { style: STYLES.grid, className: "rl-grid main-gridContainer-gridContainer" },
        displayedArtists.map((artist, i) =>
          React.createElement(ArtistCard, {
            key: `${artist.uri}-${i}`,
            artist,
            onClick: handleOpenArtist,
          })
        )
      ),

      displayedArtists.length === 0 && React.createElement(
        "div",
        { style: STYLES.loadingContainer },
        "No followed artists found matching your search."
      )
    ),

    // -----------------------------------------------------------------------
    // VIEW 3: Albums Grid
    // -----------------------------------------------------------------------
    !selectedArtist && mode === "albums" && React.createElement(
      "div",
      null,
      // Search & Sort bar
      React.createElement(
        "div",
        { style: STYLES.filterSection },
        React.createElement(
          "div",
          { style: STYLES.controlsRow },
          React.createElement(
            "div",
            { style: STYLES.searchWrapper },
            React.createElement(
              "svg",
              { style: STYLES.searchIcon, width: "14", height: "14", viewBox: "0 0 24 24", fill: "currentColor" },
              React.createElement("path", {
                d: "M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
              })
            ),
            React.createElement("input", {
              type: "text",
              placeholder: "Search albums or artists\u2026",
              value: mainSearchQuery,
              onChange: (e) => setMainSearchQuery(e.target.value),
              style: STYLES.searchInput,
            })
          ),

          React.createElement(
            "div",
            { style: STYLES.selectWrapper },
            React.createElement(
              "select",
              {
                value: sortBy,
                onChange: (e) => {
                  setSortBy(e.target.value);
                  cachedSortBy = e.target.value;
                },
                style: STYLES.select,
              },
              React.createElement("option", { value: "shuffle" }, "Shuffled"),
              React.createElement("option", { value: "name-asc" }, "Album A\u2013Z"),
              React.createElement("option", { value: "name-desc" }, "Album Z\u2013A"),
              React.createElement("option", { value: "artist-asc" }, "Artist A\u2013Z"),
              React.createElement("option", { value: "artist-desc" }, "Artist Z\u2013A")
            ),
            React.createElement(
              "svg",
              { style: STYLES.selectChevron, width: "12", height: "12", viewBox: "0 0 24 24", fill: "currentColor" },
              React.createElement("path", { d: "M7 10l5 5 5-5z" })
            )
          ),

          hasMainFilters && React.createElement(
            "button",
            { style: STYLES.clearBtn, onClick: handleClearMainFilters },
            "Clear filters"
          )
        )
      ),

      // Albums Grid
      displayedSavedAlbums.length > 0 && React.createElement(
        "div",
        { style: STYLES.grid, className: "rl-grid main-gridContainer-gridContainer" },
        displayedSavedAlbums.map((album, i) =>
          React.createElement(AlbumCard, {
            key: `${album.uri}-${i}`,
            album,
            isSaved: true,
          })
        )
      ),

      displayedSavedAlbums.length === 0 && React.createElement(
        "div",
        { style: STYLES.loadingContainer },
        "No saved albums match your search."
      )
    )
  );
}

// ---------------------------------------------------------------------------
// Entry Point
// ---------------------------------------------------------------------------
function render() {
  return React.createElement(RandomLibraryApp);
}
