// @ts-check
// NAME: Random Albums
// AUTHOR: david
// DESCRIPTION: Displays your saved albums in a shuffled grid.

const { React } = Spicetify;
const { useState, useEffect, useCallback, useMemo } = React;

// ---------------------------------------------------------------------------
// Fisher-Yates shuffle – produces an unbiased random permutation in O(n).
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
// Fetch every saved album from the user's library, handling pagination.
// ---------------------------------------------------------------------------
async function fetchAllSavedAlbums(onProgress) {
  const albums = [];
  const limit = 50;
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const response = await Spicetify.Platform.LibraryAPI.getContents({
      filters: ["0"], // "0" = Albums filter in the library
      sortOrder: "RECENTLY_ADDED",
      limit,
      offset,
    });

    if (!response || !response.items) break;

    for (const item of response.items) {
      albums.push({
        uri: item.uri,
        name: item.name,
        artist: item.artists?.map((a) => a.name).join(", ") ?? "Unknown Artist",
        imageUrl: item.images?.[0]?.url ?? item.imgUrl ?? "",
      });
    }

    total = response.totalLength ?? response.total ?? albums.length;
    offset += limit;
    onProgress?.(albums.length, total);
  }

  return albums;
}

// Module-level cache – survives navigation away and back.
let albumCache = null;
let shuffledCache = null;
let syncInFlight = false;

const STORAGE_KEY = "random-albums:shuffled-uris";

// Persist the shuffled URI order so it survives a full Spotify relaunch.
function saveShuffleOrder(shuffled) {
  try {
    Spicetify.LocalStorage.set(STORAGE_KEY, JSON.stringify(shuffled.map((a) => a.uri)));
  } catch (_) {}
}

// Restore a previous shuffle order by re-mapping URIs back to full album objects.
function loadShuffleOrder(albumList) {
  try {
    const raw = Spicetify.LocalStorage.get(STORAGE_KEY);
    if (!raw) return null;
    const uris = JSON.parse(raw);
    const byUri = new Map(albumList.map((a) => [a.uri, a]));
    const restored = uris.map((u) => byUri.get(u)).filter(Boolean);
    // If the library shrank significantly the stored order may be stale – discard it.
    if (restored.length < albumList.length * 0.5) return null;
    // Append any albums not present in the stored order (newly saved ones).
    const restoredSet = new Set(uris);
    for (const a of albumList) {
      if (!restoredSet.has(a.uri)) restored.push(a);
    }
    return restored;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sync albums with the library.
//  • No cache      → full fetch.
//  • Same total    → use cache instantly (no API calls after first load).
//  • More albums   → incrementally fetch only the new ones from the front.
//  • Fewer albums  → full re-fetch (something was removed).
// ---------------------------------------------------------------------------
async function syncAlbums(onProgress) {
  if (syncInFlight) return albumCache;
  syncInFlight = true;
  try {
  if (!albumCache) {
    albumCache = await fetchAllSavedAlbums(onProgress);
    return albumCache;
  }

  // One lightweight call to check the current total.
  const first = await Spicetify.Platform.LibraryAPI.getContents({
    filters: ["0"],
    sortOrder: "RECENTLY_ADDED",
    limit: 50,
    offset: 0,
  });
  if (!first?.items) return albumCache;

  const total = first.totalLength ?? first.total ?? albumCache.length;

  // Nothing changed – serve from cache.
  if (total === albumCache.length) return albumCache;

  // Albums were removed – full re-fetch.
  if (total < albumCache.length) {
    albumCache = await fetchAllSavedAlbums(onProgress);
    return albumCache;
  }

  // Albums were added – collect only the new ones.
  const cacheSet = new Set(albumCache.map((a) => a.uri));
  const newAlbums = [];
  let offset = 0;
  let hitExisting = false;

  while (!hitExisting && offset < total) {
    const page =
      offset === 0
        ? first
        : await Spicetify.Platform.LibraryAPI.getContents({
            filters: ["0"],
            sortOrder: "RECENTLY_ADDED",
            limit: 50,
            offset,
          });
    if (!page?.items) break;
    for (const item of page.items) {
      if (cacheSet.has(item.uri)) { hitExisting = true; break; }
      newAlbums.push({
        uri: item.uri,
        name: item.name,
        artist: item.artists?.map((a) => a.name).join(", ") ?? "Unknown Artist",
        imageUrl: item.images?.[0]?.url ?? item.imgUrl ?? "",
      });
    }
    offset += 50;
  }

  albumCache = [...newAlbums, ...albumCache];
  return albumCache;
  } finally {
    syncInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Styles – mirrors Spotify's native card grid as closely as possible.
// ---------------------------------------------------------------------------
const STYLES = {
  page: {
    padding: "64px 32px 24px",
    maxWidth: "100%",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "24px",
    position: "relative",
    zIndex: 1,
  },
  title: {
    fontSize: "24px",
    fontWeight: "700",
    color: "var(--spice-text)",
  },
  subtitle: {
    fontSize: "14px",
    color: "var(--spice-subtext)",
    marginTop: "4px",
  },
  shuffleBtn: {
    background: "var(--spice-button)",
    color: "var(--spice-text)",
    border: "none",
    borderRadius: "500px",
    padding: "10px 24px",
    fontSize: "14px",
    fontWeight: "700",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    transition: "transform 0.1s ease, background 0.2s ease",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: "24px",
  },
  card: {
    cursor: "pointer",
    position: "relative",
  },
  imageWrapper: {
    position: "relative",
    width: "100%",
    paddingBottom: "100%",
    marginBottom: "12px",
    borderRadius: "6px",
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
    marginTop: "4px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  playBtn: {
    position: "absolute",
    bottom: "8px",
    right: "8px",
    width: "48px",
    height: "48px",
    borderRadius: "50%",
    background: "#1ed760",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 8px 8px rgba(0,0,0,.3)",
    transition: "transform 0.2s ease, opacity 0.2s ease",
  },
  filterBar: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "24px",
    flexWrap: "wrap",
  },
  searchWrapper: {
    position: "relative",
    display: "flex",
    alignItems: "center",
  },
  searchIcon: {
    position: "absolute",
    left: "10px",
    color: "var(--spice-subtext)",
    pointerEvents: "none",
  },
  searchInput: {
    background: "rgba(255,255,255,0.07)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "500px",
    color: "var(--spice-text)",
    fontSize: "14px",
    padding: "8px 16px 8px 34px",
    outline: "none",
    width: "220px",
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
    padding: "8px 30px 8px 14px",
    outline: "none",
    cursor: "pointer",
    colorScheme: "dark",
  },
  clearBtn: {
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: "500px",
    color: "var(--spice-subtext)",
    fontSize: "13px",
    padding: "7px 14px",
    cursor: "pointer",
  },
  loading: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    height: "60vh",
    color: "var(--spice-subtext)",
    fontSize: "16px",
  },
  error: {
    color: "var(--spice-notification-error, #f15e6c)",
    padding: "48px",
    textAlign: "center",
    fontSize: "14px",
  },
};

// ---------------------------------------------------------------------------
// FilterBar component – search and sort controls.
// ---------------------------------------------------------------------------
function FilterBar({ searchQuery, onSearchChange, sortBy, onSortChange, hasActiveFilters, onClear }) {
  return React.createElement(
    "div",
    { style: STYLES.filterBar },
    // Search input
    React.createElement(
      "div",
      { style: STYLES.searchWrapper },
      React.createElement(
        "svg",
        { style: STYLES.searchIcon, width: "16", height: "16", viewBox: "0 0 24 24", fill: "currentColor" },
        React.createElement("path", { d: "M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" })
      ),
      React.createElement("input", {
        type: "text",
        placeholder: "Search albums or artists\u2026",
        value: searchQuery,
        onChange: (e) => onSearchChange(e.target.value),
        style: STYLES.searchInput,
      })
    ),
    // Sort dropdown
    React.createElement(
      "div",
      { style: STYLES.selectWrapper },
      React.createElement(
        "select",
        { value: sortBy, onChange: (e) => onSortChange(e.target.value), style: STYLES.select },
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
    // Clear filters
    hasActiveFilters && React.createElement(
      "button",
      { style: STYLES.clearBtn, onClick: onClear },
      "Clear filters"
    )
  );
}

// ---------------------------------------------------------------------------
// AlbumCard component – individual album tile in the grid.
// ---------------------------------------------------------------------------
function AlbumCard({ album }) {
  const [hovered, setHovered] = useState(false);

  function handleClick() {
    const albumId = album.uri.split(":").pop();
    Spicetify.Platform.History.push("/album/" + albumId);
  }

  function handlePlay(e) {
    e.stopPropagation();
    Spicetify.Player.playUri(album.uri);
  }

  return React.createElement(
    "div",
    {
      style: STYLES.card,
      onClick: handleClick,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      title: album.name + " \u2013 " + album.artist,
    },
    // Album art
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
      // Play button – fades in on hover
      React.createElement(
        "button",
        {
          style: {
            ...STYLES.playBtn,
            opacity: hovered ? 1 : 0,
            transform: hovered
              ? "scale(1) translateY(0)"
              : "scale(0.8) translateY(6px)",
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
      )
    ),
    React.createElement("div", { style: STYLES.albumName }, album.name),
    React.createElement("div", { style: STYLES.artistName }, album.artist)
  );
}

// ---------------------------------------------------------------------------
// Main page component.
// ---------------------------------------------------------------------------
function RandomAlbumsPage() {
  const [albums, setAlbums] = useState(albumCache ?? []);
  const [shuffled, setShuffled] = useState(shuffledCache ?? []);
  const [loading, setLoading] = useState(shuffledCache === null);
  const [error, setError] = useState(null);
  const [fetchProgress, setFetchProgress] = useState(null); // { done, total } during library load
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("shuffle");
  useEffect(() => {
    syncAlbums((done, total) => setFetchProgress({ done, total }))
      .then((data) => {
        setAlbums(data);
        // Restore persisted order, fall back to a fresh shuffle on first ever load.
        if (!shuffledCache) {
          shuffledCache = loadShuffleOrder(data) ?? fisherYatesShuffle(data);
          saveShuffleOrder(shuffledCache);
        }
        setShuffled(shuffledCache);
        setFetchProgress(null);
      })
      .catch((err) => {
        console.error("[Random Albums]", err);
        setError("Failed to load your library. " + (err.message || ""));
      })
      .finally(() => setLoading(false));
  }, []);

  const handleShuffle = useCallback(() => {
    // Sync first so any newly saved albums are included before reshuffling.
    syncAlbums()
      .then((data) => {
        shuffledCache = fisherYatesShuffle(data);
        saveShuffleOrder(shuffledCache);
        setAlbums(data);
        setShuffled(shuffledCache);
      })
      .catch(() => {
        // Fall back to reshuffling what we already have.
        shuffledCache = fisherYatesShuffle(albums);
        saveShuffleOrder(shuffledCache);
        setShuffled(shuffledCache);
      });
  }, [albums]);

  // Apply all active filters + sort on top of the shuffled/sorted base list.
  const displayed = useMemo(() => {
    let list = sortBy === "shuffle" ? [...shuffled] : [...albums];
    if (sortBy === "name-asc")         list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === "name-desc")   list.sort((a, b) => b.name.localeCompare(a.name));
    else if (sortBy === "artist-asc")  list.sort((a, b) => a.artist.localeCompare(b.artist));
    else if (sortBy === "artist-desc") list.sort((a, b) => b.artist.localeCompare(a.artist));
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((a) => a.name.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q));
    }
    return list;
  }, [shuffled, albums, sortBy, searchQuery]);

  const hasActiveFilters = searchQuery.trim() !== "" || sortBy !== "shuffle";

  function handleClearFilters() {
    setSearchQuery("");
    setSortBy("shuffle");
  }

  if (loading) {
    return React.createElement(
      "div",
      { style: STYLES.loading },
      React.createElement(
        "div",
        { style: { textAlign: "center" } },
        React.createElement("div", { style: { marginBottom: "16px", color: "var(--spice-subtext)", fontSize: "16px" } },
          fetchProgress && fetchProgress.total > 0
            ? "Loading your albums\u2026 " + fetchProgress.done + " / " + fetchProgress.total
            : "Loading your albums\u2026"
        ),
        fetchProgress && fetchProgress.total > 0 && React.createElement(
          "div",
          { style: { width: "240px", height: "4px", background: "rgba(255,255,255,0.1)", borderRadius: "2px", overflow: "hidden" } },
          React.createElement("div", {
            style: {
              width: Math.round((fetchProgress.done / fetchProgress.total) * 100) + "%",
              height: "100%",
              background: "#1ed760",
              borderRadius: "2px",
              transition: "width 0.2s ease",
            },
          })
        )
      )
    );
  }

  if (error) {
    return React.createElement("div", { style: STYLES.error }, error);
  }

  if (albums.length === 0) {
    return React.createElement(
      "div",
      { style: STYLES.loading },
      "No saved albums found in your library."
    );
  }

  const subtitleText = hasActiveFilters
    ? "Showing " + displayed.length + " of " + albums.length + " albums"
    : albums.length + " albums shuffled";

  return React.createElement(
    "div",
    { style: STYLES.page },
    // Header row
    React.createElement(
      "div",
      { style: STYLES.header },
      React.createElement(
        "div",
        null,
        React.createElement("div", { style: STYLES.title }, "Random Albums"),
        React.createElement("div", { style: STYLES.subtitle }, subtitleText)
      ),
      React.createElement(
        "button",
        {
          style: STYLES.shuffleBtn,
          onClick: handleShuffle,
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
    ),
    // Filter bar
    React.createElement(FilterBar, {
      searchQuery,
      onSearchChange: setSearchQuery,
      sortBy,
      onSortChange: setSortBy,
      hasActiveFilters,
      onClear: handleClearFilters,
    }),
    // Empty state when active filters yield no results
    displayed.length === 0 && React.createElement(
      "div",
      { style: STYLES.loading },
      "No albums match your filters."
    ),
    // Album grid
    displayed.length > 0 && React.createElement(
      "div",
      { style: STYLES.grid, className: "main-gridContainer-gridContainer" },
      displayed.map((album, i) =>
        React.createElement(AlbumCard, { key: album.uri + "-" + i, album })
      )
    )
  );
}

// ---------------------------------------------------------------------------
// Entry point – Spicetify calls render() whenever the user opens this app.
// ---------------------------------------------------------------------------
function render() {
  return React.createElement(RandomAlbumsPage);
}
