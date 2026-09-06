# random-library

A Spicetify custom app that displays your saved Spotify albums and followed artists in a fast, shuffled, filterable grid with on-demand discography exploration, smart edition prioritization, and random discovery. Find it in the left sidebar under the shuffle icon.

## Features

- **Standardized Modes**
  - **`Albums`** — Instant local library view of all your saved albums.
  - **`Artists`** — Shuffled grid of all the artists you follow with instant local loading.
- **Symmetric Randomization**
  - In **Albums** mode: Click **`Random Album`** to pick and open a random album from your saved collection.
  - In **Artists** mode: Click **`Random Artist`** to pick a random followed artist and open their complete discography.
- **In-App Random Navigation History (`◀ Previous` / `Next ▶`)**
  - Seamlessly step backward and forward through your past random artist rolls without exiting the app.
  - Interactive step counter (e.g. `3 of 5`) and instant 0ms cached loading.
- **On-Demand Artist Discography & Native Release Filters**
  - Click any followed artist to open their complete discography right inside the app.
  - Native Spotify catalog categories:
    - `All`
    - `✓ In Library` (Isolates all releases by this artist saved in your library)
    - `Albums` (Studio albums)
    - `Singles & EPs`
    - `Compilations`
    - `Alternative Editions` (Releases featuring multiple expanded or deluxe editions)
- **Smart Edition & Deluxe Prioritization**
  - Automatically deduplicates multiple versions of the same album (standard, deluxe, expanded, anniversary, remastered).
  - Prioritizes your exact saved library version if present; otherwise defaults to the most complete Deluxe/Expanded edition.
  - Includes an interactive **`Edition ▾`** dropdown on album cards to switch between alternative releases on the fly.
  - Visual **`✓`** badge on covers and dropdown items indicating library status.
- **Continuous Filter Randomization** — Selected release filters (e.g. *Albums*, *Singles & EPs*, or *In Library*) persist across **Random Artist** rolls, enabling continuous randomized discovery within a specific category.
- **Instant Library Sync / Refresh** — Click **`Refresh`** to sync newly saved albums and followed artists from Spotify in real time (also clears random navigation history).
- **Fluid Responsive Grid Scaling** — Cards, icons, and avatars automatically scale from ultra-wide & 4K displays down to compact split-screen windows.
- **Persistent Shuffle** — Shuffle order is preserved across app relaunches and sessions.
- **Search & Sort**
  - Real-time debounced search by album title or artist name.
  - Multi-column sort options: *Shuffled*, *Album A–Z / Z–A*, or *Artist A–Z / Z–A*.
- **Play on Hover** — Hover over any album or artist card and click the green play button to start playback immediately.

## Requirements

- [Spicetify](https://spicetify.app) installed and configured (`spicetify backup` run at least once)
- Spotify desktop app

## Install

**Windows (PowerShell)**
```powershell
iwr -useb "https://raw.githubusercontent.com/daviidpaark/random-library/main/install.ps1" | iex
```

**macOS / Linux**
```bash
curl -fsSL "https://raw.githubusercontent.com/daviidpaark/random-library/main/install.sh" | bash
```

The script will:
1. Verify `spicetify` is in your PATH and locate your `config-xpui.ini`
2. Copy or download `index.js` and `manifest.json` into your Spicetify `CustomApps/random-library/` folder
3. Clean legacy `random-albums` registrations and register `random-library` in `config-xpui.ini`
4. Run `spicetify apply`

Restart Spotify if it was already open.

## Uninstall

**Windows (PowerShell)**
```powershell
iwr -useb "https://raw.githubusercontent.com/daviidpaark/random-library/main/uninstall.ps1" | iex
```

**macOS / Linux**
```bash
curl -fsSL "https://raw.githubusercontent.com/daviidpaark/random-library/main/uninstall.sh" | bash
```

---

## Disclaimer

This project is an independent, open-source custom app and is not affiliated with, sponsored by, or endorsed by Spotify. Spotify is a registered trademark of Spotify AB.

---

## AI Disclosure & Personal Project Note

> [!NOTE]
> This project was developed as a personal project with the assistance of **GitHub Copilot (Claude Sonnet / Opus)** and **Google Antigravity (Gemini Flash / Pro)** AI pair programming. It is shared publicly for the benefit of the community and other Spotify and Spicetify users. Contributions, feedback, and issue reports are always welcome!

---

## License

MIT License. See [LICENSE](LICENSE) for details.

