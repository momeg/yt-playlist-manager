# YT Playlist Manager — Chrome Extension

Bulk manage and clean up your YouTube playlists. Delete watched, old, or partially viewed videos in one click.

**Zero setup. No API keys. No sign-in. Just install and go.**

## Features

- **Bulk delete** videos from any YouTube playlist
- **Filter by watch status**: fully watched, partially watched
- **Remove unavailable videos**: private, deleted, or region-locked
- **Works everywhere**: Watch Later, Liked Videos, custom playlists
- **Preview before delete**: see exactly which videos match before removing
- **No API key needed**: works entirely via DOM automation

## Install

1. Open Chrome → navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked** → select this project folder
4. Done! The extension icon appears in your toolbar.

## Usage

1. Navigate to any YouTube playlist page:
   - [Watch Later](https://www.youtube.com/playlist?list=WL)
   - [Liked Videos](https://www.youtube.com/playlist?list=LL)
   - Any custom playlist
2. Click the **YT Playlist Manager** extension icon
3. Toggle your filter criteria:
   - **Fully watched** — videos with ≥90% progress (red bar)
   - **Started watching** — partially watched (5–90%)
   - **Unavailable** — private/deleted/region-locked
4. Click **Scan Playlist** — the extension scrolls and loads all items
5. Review matched videos, uncheck any you want to keep
6. Click **Delete Selected** → confirm → done!

## How It Works

The extension works **entirely via DOM scraping** — no YouTube API, no OAuth, no external services.

1. **Content script** is injected on YouTube playlist pages
2. **Scanning**: auto-scrolls to load all items, then reads each video's:
   - Title, channel, thumbnail
   - Watch progress (from the red progress bar overlay)
   - Availability status
3. **Deletion**: simulates clicking the 3-dot menu → "Remove from [playlist]" for each selected video

## Tips

- **Keep the playlist tab open** during deletion — don't navigate away
- **YouTube must be in English** for the "Remove from" button detection
- Deletion runs at ~1 video per second for safety
- For very large playlists (500+), scanning may take a minute as it scrolls to load everything

## Project Structure

```
yt-playlist-manager/
├── manifest.json          # Extension configuration
├── background.js          # Service worker (message routing)
├── popup/
│   ├── popup.html         # Extension popup UI
│   ├── popup.css          # Styling
│   └── popup.js           # UI logic
├── content/
│   ├── content.js         # DOM scraping & automation
│   └── content.css        # Injected visual feedback
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Limitations

- **DOM-dependent**: if YouTube changes their page structure, the extension may need updating
- **English only**: menu item detection relies on English text ("Remove from...")
- **Watch progress**: detected from the red progress bar — requires videos to have been played in the browser

## License

MIT
