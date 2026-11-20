# DroppedNeedle Mobile

The Android and iOS apps connect to your DroppedNeedle v3 server. Play music from your DN library, manage your queue and playlists, and request albums or songs from the same server. Android is the primary tested platform.

## Connect your phone

1. Enter the HTTPS address that opens DroppedNeedle. Include the path if your server uses one.
2. Choose **Continue in browser** if your server offers it. Sign in to DroppedNeedle as usual and select **Connect this phone**. If the browser stays open, select **Return to the app**.
3. If your server offers OIDC but still needs the mobile pairing page, **Open web player** takes you to its existing browser player. To use the native player on that server, you can also use an existing DN v3 device session token or a server password if your account has one.

For OIDC, including authentik, enter the public DroppedNeedle address served by your reverse proxy. The browser uses the provider and callback already configured in DroppedNeedle. After you approve the phone, the app verifies its own device session with your server. If the connection drops during that step, reopen the app or select **Retry connection** within ten minutes. You can revoke phone access from **Profile > Sessions** in the web app.

Server administrators can add browser sign-in by building the DN web frontend with the `feat/mobile-browser-pairing` change. It provides `/connect/mobile` and `/mobile-pairing.json`. The marker should return JSON containing `"droppedneedle_mobile_pairing": 1`. The phone must be able to reach the DN API and media endpoints using its DN device session. A proxy that requires a separate browser session on those routes needs a compatible access policy.

## Customize your screens

Open **Settings → Screen layouts** and choose Home, Library, Discover, or Now Playing. Each screen has its own saved layout. **Restore default layout** loads a fresh draft, **Save layout** applies it, and **Cancel** discards it.

Home opens after sign-in. Offline music opens on Android when the phone has no network or you have enabled offline-only playback. Combine Library and Discover sections there, such as recently added albums, recently played songs, Top picks for you, or genres. In a screen’s editor, add or remove a section and use the arrows to reorder it. The sliders beside a section control its preview and display.

Each section can show its contents directly on the screen. Choose **List** or **Grid**, a maximum column count, column size, and row density. **Preview rows** sets how many rows appear inline. For example, use a two-row cover grid for Top picks and a compact single-column list for recently played songs. Fewer columns fit on a narrow screen. Tap an item to open it, or tap the section heading to browse the full collection with its filters and actions. Existing saved layouts keep their visibility choices. Turn on **Show a preview** for any section that previously showed only a heading.

Use **Library → New filtered section**, or set filters while browsing and choose **Save filters as section**. For a five-star songs shelf, choose Songs, set the minimum rating to five and give it a name. Add the saved section to Home or Library in either screen’s layout editor. The two placements share the saved criteria and can use different row counts and display styles.

Use **Select** or hold a library item to start a selection. The actions at the top let you play your choices, play them next, add them to the queue or a playlist, or save them on the device. **Select loaded** selects the items displayed so far. Album and artist actions resolve their full track lists.

### Arrange the expanded player

Open **Settings → Edit Now Playing layout**, or tap the settings control on the expanded player. The editor shows a sample album, song, queue and lyrics. You can edit with an empty queue or while your own music plays. Saving, canceling, or pressing Android Back returns you to Now Playing.

Tap a field in the sample player. Drag its grip beside another field to place them on one row, or to the top or bottom edge of a row to make a new one. Drag its resize corner to adjust its width and the row’s minimum height. The inspector also lets you enter dimensions, choose a column width, align text, and change text size. **Move to row**, **Row position**, and the left and right buttons offer the same placement choices by tap. A row can hold three fields. **Swap with** trades places with a field in a full row.

**Split into separate fields** turns a group into individually movable controls. For example, place the artist beside the album, put the duration beside the title, or move Favorite and Add to playlist next to playback controls. **Header controls** lets you place the queue, audio output, settings and close controls at either end of the header, in a player row, or hide them. A player menu provides an exit when Close moves out of the header.

**Try side-by-side layout** loads an example. **Add Custom text** creates a field that follows the current song. It accepts text and values such as `{artist} · {album}` or `{position}/{count}`. **Share player layout** exports the draft as JSON or loads a shared layout before saving. These controls customize the expanded player. The compact mini-player has a fixed layout.

Layouts are stored on the phone for each DN server and account. **Settings → Content preferences** controls the account-wide visibility of DN’s Home and Discover content. Administrators can also configure sidebar visibility there. DN reports when a section depends on an unavailable integration.

## Listening and library coverage

| Area | On the phone |
| --- | --- |
| Library | Browse albums, artists and songs. Filter and sort albums and songs by favorites, audio format or personal rating. Open a library artist for albums, guest appearances and credited songs. Play or shuffle all filtered songs across pages, up to 2,000 tracks and 1 MiB of queue metadata. |
| Now Playing | Tap the mini-player for artwork, playback, seeking, lyrics and the queue. Tap a timed lyric to seek. Track tools show audio information and let you favorite, rate or add a track to a playlist. Android media controls work with the screen locked. |
| Queue | Play next, append, move or remove individual entries, shuffle or clear upcoming tracks without interrupting the current song, and repeat a song or the queue. Android restores the last queue and position paused when you reopen the app after the playback process exits. |
| Playlists | Create, rename and delete playlists, or import an M3U, M3U8 or CSV file and review which tracks DN matched. Add a song or album, reorder tracks, remove one occurrence of a repeated song, and share with viewers or editors. Unavailable entries stay visible. |
| Search and requests | Choose Top results, Artists, Albums, Songs, Genres or Playlists below the search box. Switching category keeps the query. Choose an album edition or request an individual recording. View active requests and history, withdraw eligible requests, and manage server downloads. The download queue groups activity by stage and shows status text, icons, progress and file counts when DN supplies them. Administrators can approve or reject requests. |
| Discover | Browse recommendations, genres, popular albums, trending artists and personal charts. Open an artist for releases and top songs. Follow artists to see new releases and concerts. Library radio builds a queue from DN files related to an artist, album or genre. |
| Account | In **Settings > Account on DroppedNeedle**, change your display name, username, email, listening visibility, scrobble preferences and personal-mix settings. Inspect linked services or sign out another device. |

Under **Requests → Activity → Wanted watches**, see what DN is monitoring and manage watches your account can change. **Requests → Downloads** puts items needing a decision first, followed by in-progress transfers, queued work, scheduled retries, and download history. **Review matches** separates recommended and possible candidates from those outside your download settings. Select one to inspect its files and review the action.

**Review held files** opens files from that task inside the app. **Review all held files** opens the entries available to your account. Listen to the opening audio, inspect why a file was held, and select the files to act on. DN supplies the eligible actions. You can confirm a replacement or discard, and trusted listeners and administrators can match files to an album or check an edition. Edition review compares editions against the library, then retries the selected held files. Bulk imports, quality upgrades and advanced server administration are available in Web tools.

A download in **Requests → Downloads** brings music into the DN server library. **Save offline** keeps a copy on the phone. Android reports playback to DN for listening history and linked scrobbling services. Playback reporting and queue restoration after process exit are currently Android features.

**Settings → Library statistics** shows collection size, formats and favorites. Administrators also have native library scans, server diagnostics, release types and edition preferences. **Settings → Web tools** searches the DN pages available to your role. Account security, linking services, backups, plugins, matching, duplicates and bulk edits use the server’s browser interface. Album, artist and playlist details also link directly to their DN web pages.

The phone uses the device volume controls. On Android, **Settings → Playback → Equalizer** uses DN’s playback audio session. Available bands depend on the device. The mobile queue plays tracks regardless of their rating. Use rating filters in Library to choose what goes into a new queue.

## Playback and storage

**Settings → Streaming and fades** has separate Wi-Fi and cellular profiles on this device for the signed-in DN account. Each can use the original file or request MP3 or Opus from 64 to 320 kbps. New accounts start with original audio on both connections. An earlier single quality setting becomes the starting point for both profiles. Each new track download checks the connection, including tracks already in the queue. A track that is buffering or playing keeps the representation it started with for seeking and retries. Ethernet uses the Wi-Fi profile. An unknown transport uses the cellular profile.

DN’s web player has its own preference in **Settings → Personalize → Playback**. On iOS, AVFoundation uses MP3 at the requested bitrate if the device cannot play Ogg Opus. Converted tracks are staged privately for seeking.

The server’s **Settings → Connect Apps → On-the-fly transcoding** switch, ffmpeg and bitrate ceiling govern conversion for all clients. If DN falls back to an original, that file plays at its source bitrate. Track fades run locally at track boundaries. Choose 0.5, 2, 4 or 8 seconds. They are off by default.

On Android, choose **Save offline** on an album, track or library selection. **More → Offline music** opens saved downloads and completed playback cache entries for the signed-in DN account. You can search, play, queue, keep a cached track or remove a copy. **Settings → Offline and cache** controls automatic caching, its size limit (128 MiB to 4 GiB), unmetered-only transfers and offline-only playback. The limit applies to the playback cache. Explicit downloads stay until removed. The app prefers a completed device copy during playback. Save offline fetches the original file or keeps an existing complete cached copy. Keep the app running until explicit downloads finish. Offline copies include the audio and track details. Artwork, lyrics and listening-history sync require a connection to DN. In the browser preview, offline storage uses IndexedDB and sign-in lasts for the current session.

Use the cast icon in Now Playing or **More → Cast and audio output**. On Android, choose a Google Cast device, or use **Find network speakers** for a DLNA/UPnP receiver on the same local network. Google Cast uses Google Play services on the phone. Sonos and other compatible DLNA/UPnP speakers can use **Find network speakers** directly. Keep the phone connected during playback. The receiver reads the current song from the phone, and the phone authenticates to DN. Stopping the cast returns the queue to the phone paused. Android also offers display mirroring. On iOS, the output button opens the system AirPlay picker. Device downloads and automatic caching are available on Android and in the browser preview.

## Change the appearance

Open **Settings → Themes** to choose DN’s **Dark**, **Light**, **Midnight** or **System**. The mobile build reads the web theme definitions. System follows the phone’s appearance. Use **Use account theme on this device** or **Save device theme to account** to copy a built-in theme in either direction.

Under **Settings → Interface and navigation**, choose DN web, Glass or Simple surfaces. Glass has an adjustable blur. Dock or float the navigation bar, reorder or hide destinations, and choose whether the header has a settings shortcut. **More** always includes Settings and the destinations you have hidden. Screen transitions can use a quick or gentle fade, or be switched off. They respect the device’s reduced-motion preference.

Use **Import colors from a web style** to preview compatible colors and corner radius from your current account CSS or a saved version. Choose the palette and select **Apply palette to this device**. The preview lists web rules that the phone does not support. Under **Edit or share theme**, copy or paste a custom theme as JSON and select **Apply theme**. Existing custom themes and the original Studio and Paper presets remain available. Custom JSON applies on this device. DN’s web CSS editor is available under **Settings → Web tools → Custom CSS and saved styles**.

| Field | Values |
| --- | --- |
| `version` and `name` | Use version `1` and a name of 1 to 40 characters. |
| `colors` | Set `bg`, `surface`, `raised`, `text`, `muted`, `accent`, `on-accent`, and `line` to six-digit hex colors. |
| `corners` | A radius from 0 to 24 pixels. |
| `spacing` | A gap from 8 to 24 pixels. |
| `typeface` | Use `sans`, `system`, or `serif`. |

## Build and test

From this directory, use the Node.js and pnpm versions in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm format:check
pnpm exec playwright install chromium
pnpm test:journey
pnpm sync
```

For Android, install JDK 21 and Android SDK Platform 36. Run `./gradlew assembleDebug` from `android/`. The APK is at `android/app/build/outputs/apk/debug/app-debug.apk`. For iOS, open the project with `pnpm exec cap open ios` on a Mac with Xcode and select a simulator or device. Run `pnpm sync` after you change the Svelte app. The native build reads the copied bundle.

## How the clients fit together

The mobile app is a separate Svelte entry point. It shares the v3 contract types, browser pairing format, font, and brand artwork with the web frontend. The mobile build bundles its UI on the device. Only the browser sign-in page requires a web frontend update. The app can connect directly to the existing Rust server for supported password and token methods.

Android uses a Media3 playback service. iOS uses AVQueuePlayer and a resource loader for authenticated byte-range requests. The native player owns the track queue. The Svelte view reads its current state when the user reopens the app. Native API and audio requests authenticate to the selected server. Native session credentials use Keychain or Android Keystore-backed storage. The web preview holds credentials in memory and fetches each track before play.

To check the native player, play a two-track album, lock the screen, and wait for track two. Pause from the lock screen, reopen the app, and check the title and play state. Also test seeking, a headset disconnect, a call interruption, and session revocation on the target OS.
