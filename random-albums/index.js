// @ts-check
// NAME: Random Albums
// AUTHOR: david
// DESCRIPTION: Displays your saved albums in a shuffled grid.

const { React } = Spicetify;
const { useState, useEffect, useCallback } = React;

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
// Returns pre-save metadata for an item. isPreSave is true when the album
// has a future release date (i.e. saved before it's out).
// ---------------------------------------------------------------------------
function getPreSaveInfo(item) {
  const raw = item.release_date ?? item.releaseDate;
  if (!raw) return { isPreSave: false, releaseDate: null };
  const date = new Date(raw);
  return { isPreSave: date > new Date(), releaseDate: date };
}

// ---------------------------------------------------------------------------
// Fetch every saved album from the user's library, handling pagination.
// ---------------------------------------------------------------------------
async function fetchAllSavedAlbums() {
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
      const { isPreSave, releaseDate } = getPreSaveInfo(item);
      albums.push({
        uri: item.uri,
        name: item.name,
        artist: item.artists?.map((a) => a.name).join(", ") ?? "Unknown Artist",
        imageUrl: item.images?.[0]?.url ?? item.imgUrl ?? "",
        isPreSave,
        releaseDate,
      });
    }

    total = response.totalLength ?? response.total ?? albums.length;
    offset += limit;
  }

  return albums;
}

// Module-level cache – survives navigation away and back.
let albumCache = null;
let shuffledCache = null;
let syncInFlight = false;

// ---------------------------------------------------------------------------
// Sync albums with the library.
//  • No cache      → full fetch.
//  • Same total    → use cache instantly (no API calls after first load).
//  • More albums   → incrementally fetch only the new ones from the front.
//  • Fewer albums  → full re-fetch (something was removed).
// ---------------------------------------------------------------------------
async function syncAlbums() {
  if (syncInFlight) return albumCache;
  syncInFlight = true;
  try {
  if (!albumCache) {
    albumCache = await fetchAllSavedAlbums();
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
    albumCache = await fetchAllSavedAlbums();
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
      const { isPreSave, releaseDate } = getPreSaveInfo(item);
      newAlbums.push({
        uri: item.uri,
        name: item.name,
        artist: item.artists?.map((a) => a.name).join(", ") ?? "Unknown Artist",
        imageUrl: item.images?.[0]?.url ?? item.imgUrl ?? "",
        isPreSave,
        releaseDate,
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
  preSaveBadge: {
    position: "absolute",
    top: "8px",
    left: "8px",
    background: "rgba(0,0,0,0.7)",
    color: "#fff",
    fontSize: "10px",
    fontWeight: "700",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    padding: "3px 7px",
    borderRadius: "3px",
    pointerEvents: "none",
    backdropFilter: "blur(4px)",
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
    if (album.isPreSave) return;
    Spicetify.Player.playUri(album.uri);
  }

  const releaseDateLabel = album.isPreSave && album.releaseDate
    ? album.releaseDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : null;

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
      // Pre-save badge
      album.isPreSave && React.createElement(
        "div",
        { style: STYLES.preSaveBadge },
        releaseDateLabel ? "Pre-save \u00B7 " + releaseDateLabel : "Pre-save"
      ),
      // Play button – fades in on hover (hidden for pre-saves)
      !album.isPreSave && React.createElement(
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

  useEffect(() => {
    syncAlbums()
      .then((data) => {
        setAlbums(data);
        // Only generate a new shuffle on first load; preserve order on revisit.
        if (!shuffledCache) shuffledCache = fisherYatesShuffle(data);
        setShuffled(shuffledCache);
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
        setAlbums(data);
        setShuffled(shuffledCache);
      })
      .catch(() => {
        // Fall back to reshuffling what we already have.
        shuffledCache = fisherYatesShuffle(albums);
        setShuffled(shuffledCache);
      });
  }, [albums]);

  if (loading) {
    return React.createElement("div", { style: STYLES.loading }, "Loading your albums\u2026");
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
        React.createElement(
          "div",
          { style: STYLES.subtitle },
          shuffled.length + " albums shuffled"
        )
      ),
      // Shuffle – instant reorder; mount effect already synced new albums
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
    // Album grid
    React.createElement(
      "div",
      { style: STYLES.grid, className: "main-gridContainer-gridContainer" },
      shuffled.map((album, i) =>
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
