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

By default, Home opens after sign-in and Offline music opens when the phone is disconnected or set to offline-only playback. On Home, combine Library and Discover sections, such as recently added albums, recently played songs, Top picks for you, or genres. In a screen’s editor, add or remove a section and use the arrows to reorder it. The sliders beside a section control its preview and display.

Each section can show its contents directly on the screen. Choose **List** or **Grid** and set **Columns** from one to six. Items divide the available width evenly, including on phones. **Row density** sets the spacing and **Preview rows** sets how many rows appear inline. For example, Top picks can show two rows of six covers while Recently played uses one song per row. Tap an item to open it, or tap the section heading to browse the full collection with its filters and actions.

Library shelves also work with music saved on this device. Add **Library genres** to Home or Library for a genre shelf. Saved song filters use local track details, and album or artist rules use matches DN has already confirmed. Recently added uses DN’s addition dates when available. Recently played and Discover recommendations need a connection.

Open **Library** for Playlists, Artists, Albums, Tracks and Genres. Albums and playlists start as two-column grids, artists as three-column portraits, and tracks and genres as lists. Use the toolbar to sort, filter, search, select items, or switch views. The gear adjusts the display for that category. More items load as you scroll. Opening a detail and going back keeps your place. **Library sections** opens your custom shelves.

Use **Library → Library sections → New filtered section**, or set filters while browsing and choose **Save filters as section**. For a five-star songs shelf, choose Songs, set the minimum rating to five and give it a name. Add the saved section to Home or Library in either screen’s layout editor. The two placements share the saved criteria and can use different row counts and display styles.

Use **Select** or hold a library item to start a selection. The actions at the top let you play your choices, play them next, add them to the queue or a playlist, or save them on the device. **Select loaded** selects the items displayed so far. Album and artist actions resolve their full track lists.

### Arrange the expanded player

Open **Settings → Edit Now Playing layout**, or tap the settings control on the expanded player. The editor shows a sample album, song, queue and lyrics. You can edit with an empty queue or while your own music plays. Tap **Preview** to see the current draft at player size. **Back to editing** returns to the same spot with your edits in place. Android Back leaves the preview, then closes any open field or row before exiting the editor. Saving or canceling returns you to Now Playing.

Choose **Add row**, set its column count, then tap **+** in each empty column to choose what goes there. A row can have up to six columns. **Arrange five playback controls** puts shuffle, previous, play/pause, next and repeat on one row in a single step. Empty columns keep their place when you save. Tap a row heading to change its column widths and see how much space each one uses.

Tap a field in the sample to edit its padding, horizontal and vertical alignment, or size. Set padding to zero for a tight layout. Action buttons can use a different icon and show or hide their label. Track title, artist and album are individual fields. Each can display text, an icon, or both. Choose how many lines to allow and whether to reserve those lines even when a title is short. Custom text accepts values such as `{artist} · {album}` or `{position}/{count}`.

Drag a row by its heading, or drag a field by its grip to move it immediately. The **Header** row accepts the same fields, column widths and spacing as any other row. **Done** closes the field or row settings. Placement controls are also available for moving a field without dragging. **Share player layout** exports the draft as JSON or imports a layout for preview before saving. The compact mini-player has a fixed layout.

Layouts are stored on the phone for each DN server and account. **Settings → Content preferences** controls the account-wide visibility of DN’s Home and Discover content. Administrators can also configure sidebar visibility there. DN reports when a section depends on an unavailable integration.

## Listening and library coverage

| Area | On the phone |
| --- | --- |
| Library | Browse playlists, artists, albums, tracks and genres. Filter by device availability, rating, favorites or format where applicable. Open an artist for albums, guest appearances and credited songs. |
| Now Playing | Tap the mini-player for artwork, playback, seeking, lyrics and the queue. Tap a timed lyric to seek, or tap the album or artist to browse that part of your library. Back returns to the player. Track tools show audio information and let you favorite, rate, download or add a track to a playlist. Android media controls work with the screen locked. Set a sleep timer for 1–240 minutes or the end of the current song from Now Playing or Queue. |
| Queue | Play next, append, move or remove individual entries, shuffle or clear upcoming tracks without interrupting the current song, and repeat a song or the queue. Android restores the last queue paused at its saved position for the signed-in account. |
| Playlists | Create, rename and delete playlists, or import an M3U, M3U8 or CSV file and review which tracks DN matched. Add a song or album, reorder tracks, remove one occurrence of a repeated song, and share with viewers or editors. Create a device smart playlist using text, favorites, ratings, formats, sort and a track limit. Its contents update whenever you open or play it. |
| Search and requests | Choose Top results, Artists, Albums, Songs, Genres or Playlists below the search box. Switching category keeps the query. Choose an album edition or request an individual recording. View active requests and history, withdraw eligible requests, and manage server downloads. The download queue groups activity by stage and shows status text, icons, progress and file counts when DN supplies them. Administrators can approve or reject requests. |
| Discover | Browse recommendations, genres, popular albums, trending artists and personal charts. Open an artist for releases and top songs. Follow artists to see new releases and concerts. Library radio builds a queue from DN files related to an artist, album or genre. |
| Account | In **Settings > Account on DroppedNeedle**, change your display name, username, email, listening visibility, scrobble preferences and personal-mix settings. Inspect linked services or sign out another device. |

Under **Requests → Activity → Wanted watches**, see what DN is monitoring and manage watches your account can change. **Requests → Downloads** puts items needing a decision first, followed by in-progress transfers, queued work, scheduled retries, and download history. **Review matches** separates recommended and possible candidates from those outside your download settings. Select one to inspect its files and review the action.

**Review held files** opens files from that task inside the app. **Review all held files** opens the entries available to your account. Listen to the opening audio, inspect why a file was held, and select the files to act on. DN supplies the eligible actions. You can confirm a replacement or discard, and trusted listeners and administrators can match files to an album or check an edition. Edition review compares editions against the library, then retries the selected held files. Bulk imports, quality upgrades and advanced server administration are available in Web tools.

A download in **Requests → Downloads** brings music into the DN server library. **Save offline** keeps a copy on the phone. Android reports playback to DN for listening history and linked scrobbling services when the server is reachable.

**Settings → Library statistics** shows collection size, formats and favorites. Administrators also have native library scans, server diagnostics, release types and edition preferences. **Settings → Web tools** searches the DN pages available to your role. Account security, linking services, backups, plugins, matching, duplicates and bulk edits use the server’s browser interface. Album, artist and playlist details also link directly to their DN web pages.

The phone uses the device volume controls. On Android, **Settings → Playback → Equalizer** uses DN’s playback audio session. Available bands depend on the device. The mobile queue plays tracks regardless of their rating. Use rating filters in Library to choose what goes into a new queue.

On the Tracks page, **Play all** and **Shuffle all** can continue through the entire filtered collection. For a large library, the player loads the next 100 tracks as you listen and keeps up to 50 earlier tracks at each refill. Queue shows where you are in the whole collection. Saving the loaded queue to a playlist or editing its order uses the tracks currently on the phone. Android restores its place in the collection after you reopen the app.

In **Edit queue** or **Edit playlist**, drag a track by its grip, or tap the grip to enter an exact position. With a keyboard, use the arrow keys on the grip. Moving an entry keeps the current song playing, even when a playlist contains two copies.

On Android, pressing Play on a headset can resume your saved queue after the playback service has stopped. This works with the screen locked after the first device unlock. Open the signed-in app once after upgrading to make an older queue available to your headset.

## Playback and storage

**Settings → Streaming and fades** has separate Wi-Fi and cellular profiles on this device for the signed-in DN account. Each can use the original file or request MP3 or Opus from 64 to 320 kbps. New accounts start with original audio on both connections. An earlier single quality setting becomes the starting point for both profiles. Each new track download checks the connection, including tracks already in the queue. A track that is buffering or playing keeps the representation it started with for seeking and retries. Ethernet uses the Wi-Fi profile. An unknown transport uses the cellular profile.

DN’s web player has its own preference in **Settings → Personalize → Playback**. On iOS, AVFoundation uses MP3 at the requested bitrate if the device cannot play Ogg Opus. Converted tracks are staged privately for seeking.

The server’s **Settings → Connect Apps → On-the-fly transcoding** switch, ffmpeg and bitrate ceiling govern conversion for all clients. If DN falls back to an original, that file plays at its source bitrate. Track fades run locally at track boundaries. Choose 0.5, 2, 4 or 8 seconds. They are off by default.

On Android, choose **Save offline** on an album, track or selection to keep the music on the phone. **Library → Availability** lets you browse all offline music, your downloads, automatic saves or playback cache. You can also change it inside any category under **Collection filters**. The choice follows you across all five categories and is saved for this DN account on this device. Badges identify each source. Albums and other groups can contain more than one source. A regular playlist is available offline after its membership has been opened and at least one track saved. Use **Menu → Offline music** to manage the files.

Under **Settings → Offline and cache**, automatic downloads can keep up to 25 recent additions or favorites. They start switched off. Manual downloads stay until you remove them. Playback cache keeps completed files under its own size limit. Set transfer limits, choose unmetered connections or enable offline-only playback here. Keep the app open while saving explicit downloads. The player prefers a complete copy on the device.

Cover artwork and lyrics you have opened have separate device caches. Their settings show usage and let you change the limits or clear each cache for this account. Timed lyrics keep their seek controls offline. The browser preview uses IndexedDB for media and keeps sign-in in memory.

Timed lyrics follow the playing line inside the lyrics panel. Scroll to read ahead, then tap **Follow current line** to catch up. Tapping a timed line seeks to it and follows the song from there.

You can favorite or rate a saved song while offline. Library and device smart playlists use the change immediately. The app sends it back to the same DN account after it reconnects and you turn off offline-only playback. Offline music shows pending changes and lets you retry a failed sync.

On Android, **Settings → Offline and cache → Offline listening history** shows how many listens are waiting for DN. Turn off **Record offline listens** to pause recording and submission, or discard the pending listens. DN accepts offline listens for up to 14 days. If the phone sends a listen and loses the reply, it skips resending that listen to avoid counting it twice. That listen may be missing from your history.

Search also works without a connection. Its Songs, Artists, Albums, Genres and Playlists selectors use the completed music on this device. Opening a result keeps your search and place in the list. If DN stops responding while you’re on Wi-Fi, Search offers device results and a way to retry the server.

Use **Track tools → Save offline** to keep the playing song. If it is already cached or automatically saved, keeping it makes it a manual download using the file on the phone. Tap **Downloaded** to manage that copy. To put the same button elsewhere, add the **Offline download** field in the Now Playing editor.

Use the cast icon in Now Playing or **Menu → Cast and audio output**. On Android, choose a Google Cast device, or use **Find network speakers** for a DLNA/UPnP receiver on the same local network. Google Cast uses Google Play services on the phone. Sonos and other compatible DLNA/UPnP speakers can use **Find network speakers** directly. Keep the phone connected during playback. The receiver reads the current song from the phone, and the phone authenticates to DN. Stopping the cast returns the queue to the phone paused. Android also offers display mirroring. On iOS, the output button opens the system AirPlay picker.

## Change the appearance

Open **Settings → Themes** to choose DN’s **Dark**, **Light**, **Midnight** or **System**. The mobile build reads the web theme definitions. System follows the phone’s appearance. Use **Use account theme on this device** or **Save device theme to account** to copy a built-in theme in either direction.

Under **Settings → Interface and navigation**, choose **Solid Theme Color** for opaque buttons and panels, **Glass** for a clear tint and reflective edge, or **Blur** for a frosted background with adjustable strength. Dock or float the navigation bar and pin up to five destinations. Tap the top-left menu or swipe right from the left edge for hidden destinations, offline music, settings and audio output. Screen transitions can use a quick or gentle fade, or be switched off. They respect the device’s reduced-motion preference.

Swipe left on the expanded artwork or mini-player for the next track. Swipe right for the previous-track action. A tap on the mini-player opens Now Playing. You can turn off track swipes under **Player gestures** in the interface settings.

Choose **Start screen** in the same settings to open Home, Library or Now Playing when the app launches. **Now Playing** opens the restored song at its saved position and takes you to Library when the queue is empty. **Automatic** opens Home when connected and Offline music when offline. Each listener can choose a start screen for their DN server on this device.

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
