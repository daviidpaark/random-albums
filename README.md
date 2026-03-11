# random-albums

A Spicetify custom app that displays your saved Spotify albums in a shuffled grid. Find it in the left sidebar under the shuffle icon.

## Features

- **Persistent shuffle** — the shuffle order is saved to localStorage and restored the next time you open Spotify, so you always pick up where you left off
- **Session caching** — navigating away and back within the same session preserves the current order without re-fetching your library
- **Smart sync** — on each visit the app checks your library total; it only re-fetches if albums were added or removed, keeping things fast
- **Reshuffle** — the **Shuffle** button generates a new random order and picks up any albums you've saved since the last visit
- **Search** — filter the grid by album name or artist in real time
- **Sort** — choose from Shuffled, Album A–Z, Album Z–A, Artist A–Z, or Artist Z–A
- **Load progress** — a progress bar shows how many albums have been fetched while your library loads for the first time
- **Click to open** — click any album card to go to its Spotify album page
- **Play on hover** — hover over a card and click the green play button to start playback

## Requirements

- [Spicetify](https://spicetify.app) installed and configured (`spicetify backup` run at least once)
- Spotify desktop app

## Install

The install scripts work whether you run them as a one-liner from the web or from a local clone of this repo. If run locally, files are copied directly; otherwise they are downloaded from GitHub.

**Windows (PowerShell)**
```powershell
iwr -useb "https://raw.githubusercontent.com/daviidpaark/random-albums/main/install.ps1" | iex
```

**macOS / Linux**
```bash
bash <(curl -s "https://raw.githubusercontent.com/daviidpaark/random-albums/main/install.sh")
```

The script will:
1. Verify `spicetify` is in your PATH and that `config-xpui.ini` exists
2. Copy or download `index.js` and `manifest.json` into your Spicetify `CustomApps/random-albums/` folder
3. Register the app in `config-xpui.ini`
4. Run `spicetify apply`

Restart Spotify if it was already open.

## Uninstall

**Windows (PowerShell)**
```powershell
iwr -useb "https://raw.githubusercontent.com/daviidpaark/random-albums/main/uninstall.ps1" | iex
```

**macOS / Linux**
```bash
bash <(curl -s "https://raw.githubusercontent.com/daviidpaark/random-albums/main/uninstall.sh")
```

The script will:
1. Delete the `CustomApps/random-albums/` folder
2. Remove the entry from `config-xpui.ini`
3. Run `spicetify apply`

## File Structure

```
random-albums/
├── install.ps1          # Windows installer
├── install.sh           # macOS/Linux installer
├── uninstall.ps1        # Windows uninstaller
├── uninstall.sh         # macOS/Linux uninstaller
└── random-albums/
    ├── index.js         # App source (vanilla JS + Spicetify React)
    └── manifest.json    # App name and sidebar icon
```
