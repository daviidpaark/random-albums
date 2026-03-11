# random-albums

A Spicetify custom app that displays your saved Spotify albums in a shuffled grid.

- Loads your library once and caches it for the session
- Navigating away and back preserves the current shuffle order
- Pressing **Shuffle** reorders the grid and picks up any newly saved albums
- New albums are detected automatically on each visit

## Install

> Requires [spicetify](https://spicetify.app) to already be installed and backed up.

**Windows (PowerShell)**
```powershell
iwr -useb "https://raw.githubusercontent.com/daviidpaark/random-albums/main/install.ps1" | iex
```

**macOS / Linux**
```bash
bash <(curl -s "https://raw.githubusercontent.com/daviidpaark/random-albums/main/install.sh")
```

That's it. Restart Spotify if it's already running.

## Uninstall

**Windows (PowerShell)**
```powershell
iwr -useb "https://raw.githubusercontent.com/daviidpaark/random-albums/main/uninstall.ps1" | iex
```

**macOS / Linux**
```bash
bash <(curl -s "https://raw.githubusercontent.com/daviidpaark/random-albums/main/uninstall.sh")
```
