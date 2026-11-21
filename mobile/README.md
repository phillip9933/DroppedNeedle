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

Open **Library** for Playlists, Artists, Albums, Tracks and Genres. Albums and playlists start as two-column grids, artists as three-column portraits, and tracks and genres as lists. Use the toolbar to sort, filter, search, select items, or switch views. **Collection options** controls the number of columns and spacing for that category. More items load as you scroll. Opening a detail and going back keeps your place. **Library sections** opens your custom shelves.

Use **Library → Library sections → New filtered section**, or set filters while browsing and choose **Save filters as section**. For a five-star songs shelf, choose Songs, set the minimum rating to five and give it a name. Add the saved section to Home or Library in either screen’s layout editor. The two placements share the saved criteria and can use different row counts and display styles.

Hold a library item to select it. While selecting, hold another item and drag through a range to add it. Starting on a selected item removes that range. Hold at the top or bottom edge to scroll. Tap the selection button again to cancel. The actions at the top let you play your choices, play them next, add them to the queue or a playlist, or save them on the device. **Select loaded** selects the items displayed so far. Album and artist actions resolve their full track lists.

### Arrange the expanded player

Open **Settings → Edit Now Playing layout**, or tap the settings control on the expanded player. The editor shows a sample album, song, queue and lyrics. You can edit with an empty queue or while your own music plays. Tap **Preview** to see the current draft at player size. **Back to editing** returns to the same spot with your edits in place. Android Back leaves the preview, then closes any open field or row before exiting the editor. Saving or canceling returns you to Now Playing. If the app restarts while you’re editing, reopen the editor to recover your unfinished layout. The live player changes when you choose **Save layout**. **Cancel** or Android Back from the main editor discards the draft.

Choose **Add row**, set its column count, then tap **+** to choose what goes in each column. A row can have up to six columns. For example, place shuffle, previous, play/pause, next and repeat across one row. Split an individual column into sub-rows to stack fields such as track title and artist beside a single play button. Empty positions keep their place when you save. Tap a row heading to change column widths. The live player fits the screen in portrait and landscape.

Tap a field to edit its padding, alignment or size. The padding field shows its current pixel value and accepts zero. The play button can fill the available space in its row. Set an action’s **Label** to **Show** to name it and place the text above or below the icon. Track title, artist and album are individual fields. Choose how many lines to allow and whether to reserve those lines even when the text is short. Custom text accepts values such as `{artist} · {album}` or `{position}/{count}`.

Swipe normally to scroll the editor. Hold a row or field until it lifts, then drag it to move it. The **Header** row accepts the same fields, column widths and spacing as any other row. **Done** closes the field or row settings. **Undo** and **Redo** let you step through the last 30 edits to the open draft. Placement controls also let you move a field without dragging. **Share player layout** lets you save the draft as a JSON file or copy its text. Choose a layout file or paste its JSON to review the rows and fields. **Load into editor** lets you try it, and **Save layout** applies it. File sharing works offline.

Set the playback bar to a standard line, animated wave or the song’s measured waveform. Elapsed time, track length and time remaining can each be shown independently. On Android the waveform uses the saved file when available. Otherwise, choosing that style can read an additional stream using your Wi-Fi or cellular profile. The seek bar stays available if a waveform cannot be read. Add **Audio quality** to show the playing format and any reported sample rate, bit depth or bitrate. If only the library format is known, the readout identifies it as the source.

Layouts are stored on the phone for each DN server and account. **Settings → Content preferences** controls the account-wide visibility of DN’s Home and Discover content. Administrators can also configure sidebar visibility there. DN reports when a section depends on an unavailable integration.

## Listening and library coverage

| Area | On the phone |
| --- | --- |
| Library | Browse playlists, artists, albums, tracks and genres. Filter by device availability, rating, favorites or format where applicable. Open an artist for albums, guest appearances and credited songs. |
| Now Playing | Swipe down to minimize, up to open the queue, and down again from the queue to return. Tap the track title for details or the album or artist to open it in your library. The Lyrics button switches the artwork to lyrics and back. Its layout setting can open full-screen lyrics instead. **More actions** opens favorites, ratings, playlists, downloads and other actions for the song. Open **Sleep timer** to choose 1–240 minutes or 1–99 tracks. **Finish last track** lets the playing song end after the countdown. Android media controls also work with the screen locked. |
| Queue | Play next, append, move or remove individual entries, shuffle or clear upcoming tracks without interrupting the current song, and repeat a song or the queue. Android restores the last queue paused at its saved position for the signed-in account. |
| Playlists | Create, rename and delete playlists, or import an M3U, M3U8 or CSV file and review which tracks DN matched. Add a song or album, reorder tracks, remove one occurrence of a repeated song, and share with viewers or editors. Create a device smart playlist using text, favorites, ratings, formats, sort and a track limit. Its contents update whenever you open or play it. |
| Search and requests | Choose Top results, Artists, Albums, Songs, Genres or Playlists below the search box. Switching category keeps the query. Choose an album edition or request an individual recording. View active requests and history, withdraw eligible requests, and manage server downloads. The download queue groups activity by stage and shows status text, icons, progress and file counts when DN supplies them. Administrators can approve or reject requests. |
| Discover | Browse recommendations, genres, popular albums, trending artists and personal charts. Open an artist for releases and top songs. Follow artists to see new releases and concerts. Library radio builds a queue from DN files related to an artist, album or genre. |
| Account | In **Settings > Account on DroppedNeedle**, change your display name, username, email, listening visibility, scrobble preferences and personal-mix settings. Inspect linked services or sign out another device. |

Open a DN playlist and choose **Export playlist** to save an M3U8 or CSV file. This also works for playlists shared with you as a viewer. For M3U8 you can set the path prefix to match the music folder on the receiving device. The app remembers it for this DN account. Android opens the system file picker so you can choose the destination. DN reports how many unavailable entries it skipped.

In **Requests**, switch between **Activity**, **Downloads**, and, for administrators, **Approvals**. Tap an album in Activity to open it, or use the three dots on a row for actions. Expand **Wanted watches** to see what DN is monitoring. You can filter and sort request history in place.

**Downloads** puts items needing a decision first, followed by in-progress transfers, queued work, scheduled retries, and download history. Tap a row marked **Review matches** or **Review held files** to open it. Match review groups candidates by how well they fit your download settings. Tap a candidate to inspect its files before choosing it.

**Review held files** opens files from that task inside the app. **Review all held files** opens the entries available to your account. Listen to the opening audio, inspect why a file was held, and select the files to act on. DN supplies the eligible actions. You can confirm a replacement or discard, and trusted listeners and administrators can match files to an album or check an edition. Edition review compares editions against the library, then retries the selected held files. Bulk imports, quality upgrades and advanced server administration are available in Web tools.

A download in **Requests → Downloads** brings music into the DN server library. **Save offline** keeps a copy on the phone. Android reports playback to DN for listening history and linked scrobbling services when the server is reachable.

**Settings → Library statistics** shows collection size, formats and favorites. Administrators also have native library scans, server diagnostics, release types and edition preferences. **Settings → Web tools** searches the DN pages available to your role. Account security, linking services, backups, plugins, matching, duplicates and bulk edits use the server’s browser interface. Album, artist and playlist details also link directly to their DN web pages.

The phone uses the device volume controls. On Android, **Settings → Playback → Equalizer** uses DN’s playback audio session. Available bands depend on the device. The mobile queue plays tracks regardless of their rating. Use rating filters in Library to choose what goes into a new queue.

On the Tracks page, **Play all** and **Shuffle all** can continue through the entire filtered collection. For a large library, the player loads the next 100 tracks as you listen and keeps up to 50 earlier tracks at each refill. Queue shows where you are in the whole collection. Saving the loaded queue to a playlist or editing its order uses the tracks currently on the phone. Android restores its place in the collection after you reopen the app.

In **Edit queue** or **Edit playlist**, drag a track by its grip, or tap the grip to enter an exact position. With a keyboard, use the arrow keys on the grip. Moving an entry keeps the current song playing, even when a playlist contains two copies.

On Android, pressing Play on a headset can resume your saved queue after the playback service has stopped. This works with the screen locked after the first device unlock. Open the signed-in app once after upgrading to make an older queue available to your headset.

## Playback and storage

In **Play queue**, shuffle the upcoming songs and tap the shuffle control again to restore their order. **Restore previous queue** brings back the queue you replaced. **Settings → Streaming and fades → Autoplay similar library music** continues a finished queue with songs from your DN library when DN can find a match.

**Playback speed** is available in **Streaming and fades** and in **More actions** on the player. On Android, **Volume normalization** applies track or album ReplayGain to local audio. Album mode uses track gain when the album tag is missing. Untagged songs keep their original level. Under **Settings → Equalizer**, enable a separate preset for the connected output to recall its curve when you reconnect.

To move music between Android and the web, enable **Player handoff** in mobile Settings and in the web player's Profile on the same DN account. **Move queue there** and **Continue here** preserve the song, position, order and paused state for fully loaded queues of up to 2,000 local tracks. You can also pause, play or skip on the other device. Keep both players open and connected. This requires the matching DN server and web build.

**Settings → Streaming and fades** has separate Wi-Fi and cellular profiles on this device for the signed-in DN account. Each can use the original file or request MP3 or Opus from 64 to 320 kbps. New accounts start with original audio on both connections. An earlier single quality setting becomes the starting point for both profiles. Each new track download checks the connection, including tracks already in the queue. A track that is buffering or playing keeps the representation it started with for seeking and retries. Ethernet uses the Wi-Fi profile. An unknown transport uses the cellular profile.

DN’s web player has its own preference in **Settings → Personalize → Playback**. On iOS, AVFoundation uses MP3 at the requested bitrate if the device cannot play Ogg Opus. Converted tracks are staged privately for seeking.

The server’s **Settings → Connect Apps → On-the-fly transcoding** switch, ffmpeg and bitrate ceiling govern conversion for all clients. If DN falls back to an original, that file plays at its source bitrate. In **Streaming and fades**, set **Fade in** and **Fade out** independently to Off, 0.5, 2, 4 or 8 seconds. Both start off on a new installation. Upgrading copies your previous fade length to both controls.

**Smart fades** is optional and works with either manual fade turned off. The device measures the last and first eight seconds of adjacent songs in 100 ms windows. It compares the quiet ending and intro to choose an equal-power overlap of up to eight seconds, capped at half the length of either song. When both tracks have a clear, similarly spaced beat, it can align their pulses at the original tempo. Other loud transitions and consecutive numbered tracks on the same album keep their natural boundary. The manual lengths apply at the start and end of a queue and when the device cannot read the audio. Remote Cast and AirPlay receivers manage their own transitions.

On Android, choose **Save offline** on an album, track or selection to keep the music on the phone. **Library → Availability** lets you browse all offline music, your downloads, automatic saves or playback cache. You can also change it inside any category under **Collection filters**. The choice follows you across all five categories and is saved for this DN account on this device. Badges identify each source. Album and playlist details show each track’s source, how many playable entries are on the device and a **Track availability** filter for playback and selection. Playlist editing uses the full order, including repeated tracks. After a restart, a saved album can show the last playable-track count DN reported and the date it was observed. If the phone has never seen a reliable total, or now has more tracks than DN last reported, it shows how many tracks are on the device. A regular playlist is available offline after its membership has been opened and at least one track saved. Use **Library → Offline music** to manage the files.

On Android, **Save offline** queues the selected songs on the device. Downloads continue when you leave the app. The queue waits for an allowed network and pauses for offline-only playback. Tap the download notification or open **Library → Offline music** to see the current song, check which files failed, retry them, or cancel the remaining downloads. Completed songs stay on the device. If Android stops the queue, you can retry it here. **Settings → Offline and cache → Download notifications** shows whether Android allows progress notifications and opens the system control.

In **Settings → Offline and cache**, choose **Pin a collection** to keep several playlists, artists, saved library filters, recent additions or favorites on Android. The app checks on return and Android schedules another check about every six hours on allowed networks. You can also update immediately. Songs shared across collections take one copy. Manual downloads stay on the device when you unpin a collection. A failed membership check preserves existing copies.

**Download quality** lets you keep originals or request MP3 or Opus at a chosen bitrate for new manual and automatic downloads. You can stream originals on Wi-Fi, stream at a different rate on cellular, and still keep compact downloads for travel. Existing complete downloads keep their format until removed and downloaded again.

The same settings let you set storage limits, restrict transfers to unmetered connections or play only offline music. Manual downloads stay until you remove them. Playback cache keeps completed files under its own size limit. The player prefers a complete copy on the device.

Cover artwork and lyrics you have opened have separate device caches. Their settings show usage and let you change the limits or clear each cache for this account. Android’s lock screen and media notification can show a cover embedded in the saved song, even without a connection. Timed lyrics keep their seek controls offline. The browser preview uses IndexedDB for media and keeps sign-in in memory.

Timed lyrics follow the playing line inside the lyrics panel. Scroll to read ahead, then tap **Follow current line** to catch up. Tapping a timed line seeks to it and follows the song from there.

You can favorite or rate a saved song while offline. Library and device smart playlists use the change immediately. The app sends it back to the same DN account after it reconnects and you turn off offline-only playback. Offline music shows pending changes and lets you retry a failed sync.

On Android, **Settings → Offline and cache → Offline listening history** shows how many listens are waiting for DN. Turn off **Record offline listens** to pause recording and submission, or discard the pending listens. DN accepts offline listens for up to 14 days. If the phone sends a listen and loses the reply, it skips resending that listen to avoid counting it twice. That listen may be missing from your history.

Search also works without a connection. Its Songs, Artists, Albums, Genres and Playlists selectors use the completed music on this device. Opening a result keeps your search and place in the list. If DN stops responding while you’re on Wi-Fi, Search offers device results and a way to retry the server.

Use **More actions → Save offline** to keep the playing song. If it is already cached or automatically saved, keeping it makes it a manual download using the file on the phone. Tap **Downloaded** to manage that copy. To put the same button elsewhere, add the **Offline download** field in the Now Playing editor.

Use the cast icon in Now Playing or **Settings → Cast and audio output**. On Android, choose a Google Cast device, or use **Find network speakers** for a DLNA/UPnP receiver on the same local network. Google Cast uses Google Play services on the phone. Sonos and other compatible DLNA/UPnP speakers can use **Find network speakers** directly. Keep the phone connected during playback. The receiver reads the current song from the phone, and the phone authenticates to DN. Stopping the cast returns the queue to the phone paused. Android also offers display mirroring. On iOS, the output button opens the system AirPlay picker.

## Android Auto, speakers and library shortcuts

Android Auto can browse your DN library, playlists, favorites and saved music, and find songs by voice. Add the DroppedNeedle widget from the Android launcher for playback controls. Open a DN playlist in the app to pin a shortcut that returns to it under your account.

In **Cast and audio output → Find network speakers**, Sonos rooms show their groups. Select a room to adjust its volume, join another group or leave a group. Playback goes through the group coordinator.

Search remembers queries on this device for each DN account and offers suggestions as you type. The alphabetical rail in Artists and Albums also works with saved music. Smart playlist rules can combine rating, genre, year, number of plays and days since the last play. Listening-history rules require per-account play statistics from the matching DN server.

## Change the appearance

Open **Settings → Themes** to choose DN’s **Dark**, **Light**, **Midnight** or **System**. The mobile build reads the web theme definitions. System follows the phone’s appearance. Use **Use account theme on this device** or **Save device theme to account** to copy a built-in theme in either direction.

Under **Settings → Interface and navigation**, choose **Solid Theme Color** for opaque buttons and panels, **Glass** for a clear tint and reflective edge, or **Blur** for a frosted background with adjustable strength. Dock or float the navigation bar and pin up to five destinations, including individual Library categories and Settings. The menu icon on Home opens **Navigation**. Tap a destination there, or use the **Settings** groups below it. Choice fields expand in place. Select an option to apply it, or tap the field again or press Back to close it. Pinning Settings to the bar moves Home’s shortcut there. Screen transitions can use a quick or gentle fade, or be switched off. They respect the device’s reduced-motion preference.

Drag the mini-player up to open Now Playing. On Home you can also pull up from the heading or from the end of the feed. Pull Now Playing up to see the queue or down to return to browsing. Pull down from the top of the queue to return to the player. These screens and bottom sheets follow your finger. You can hold them halfway, reverse direction, or flick to finish.

Tap the mini-player to open it. Swipe left or right across the artwork or mini-player to skip forward or back. To dismiss a bottom sheet, pull its handle or drag down once its contents have scrolled to the top.

Under **Settings → Interface and navigation → Mini-player**, choose whether to show the cover and a track progress line. The second line can show the artist, album, both, or be hidden. The two positions beside Play/Pause can each hold Previous, Next or Queue, or be left empty. Opening Queue here and pressing Back takes you to the same place in your library. These choices are saved for this DN account on this device.

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

On a fresh checkout, install the dependencies in `frontend/` first. Its prepare script generates the TypeScript configuration for the shared sign-in code. From `mobile/`, use the Node.js and pnpm versions in `package.json`.

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

The mobile app is a separate Svelte entry point. It shares the v3 contract, browser pairing format, theme colors, EQ preset curves, artwork and player handoff controls with the web frontend. The mobile build bundles its UI on the device. Browser pairing uses the DN web sign-in page. Handoff uses two account-scoped v3 routes on the matching Rust server. Recent-play smart rules and server-provided ReplayGain tags use new optional catalog fields. An existing server can still provide library browsing and streaming.

Android uses a Media3 playback service. iOS uses AVQueuePlayer and a resource loader for authenticated byte-range requests. The native player owns the track queue. The Svelte view reads its current state when the user reopens the app. Native API and audio requests authenticate to the selected server. Native session credentials use Keychain or Android Keystore-backed storage. The web preview holds credentials in memory and fetches each track before play.

To check the native player, play a two-track album, lock the screen, and wait for track two. Pause from the lock screen, reopen the app, and check the title and play state. Also test seeking, a headset disconnect, a call interruption, and session revocation on the target OS.
