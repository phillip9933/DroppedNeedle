# DroppedNeedle Mobile

The Android and iOS apps connect to your DroppedNeedle v3 server. Play music from your DN library, manage your queue and playlists, and request albums or songs from the same server. Android is the primary tested platform.

## Connect your phone

1. Enter the HTTPS address that opens DroppedNeedle. Include the path if your server uses one.
2. Choose **Continue in browser** if your server offers it. Sign in to DroppedNeedle as usual and select **Connect this phone**. If the browser stays open, select **Return to the app**.
3. If your server offers OIDC but still needs the mobile pairing page, **Open web player** takes you to its existing browser player. To use the native player on that server, you can also use an existing DN v3 device session token or a server password if your account has one.

For OIDC, including authentik, enter the public DroppedNeedle address served by your reverse proxy. The browser uses the provider and callback already configured in DroppedNeedle. After you approve the phone, the app verifies its own device session with your server. If the connection drops during that step, reopen the app or select **Retry connection** within ten minutes. You can revoke phone access from **Profile > Sessions** in the web app.

Server administrators can add browser sign-in by building the DN web frontend with the `feat/mobile-browser-pairing` change. It provides `/connect/mobile` and `/mobile-pairing.json`. The marker should return JSON containing `"droppedneedle_mobile_pairing": 1`. The phone must be able to reach the DN API and media endpoints using its DN device session. A proxy that requires a separate browser session on those routes needs a compatible access policy.

## Customize your screens

Open **Settings → Screen layouts** and choose **Home**, **Library**, **Discover** or **Now Playing**. Add or remove sections, use the arrows to reorder them, and open a section’s sliders to rename it or change its display. **Save layout** applies your changes. **Cancel** discards the draft. **Restore default layout** puts the defaults in the editor for review.

Home opens after sign-in. It can show any combination of Library and Discover sections, including albums, artists, songs, recently added and recently played. Each screen keeps its own order, labels and previews. Tap a section heading to open the collection. The settings button in the expanded player opens its Now Playing editor directly.

### Arrange the expanded player

Choose **Try side-by-side layout** for a starting point, or tap a field in your existing layout. **Split into separate fields** makes the title, artist and album independently movable. The same action splits playback controls into Previous, Play/Pause and Next, or playback modes into Repeat and Shuffle.

Each row holds up to three fields. Use **Move to row** to combine text, artwork, a time readout or controls. Use the left and right arrows to change their order. In a full row, **Swap with** lets two fields trade places. Each field has a relative column width, alignment and text size. For example, give the title two shares of a row, place the duration on the right with one share, and place artist and album on the next row.

**Add Custom text** creates an additional text field. Type literal text or insert song and queue values, such as `{artist} · {album}` or `{position}/{count}`. The player updates these values as the track changes. **Share player layout** exports the draft as JSON or loads a layout someone shared with you. Select **Save layout** to use a draft or **Cancel** to return to your saved arrangement. The compact mini-player has a fixed layout.

Layouts are stored on the phone for each DN server and account. **Settings → Content preferences** controls the account-wide visibility of DN’s Home and Discover content. Administrators can also configure sidebar visibility there. DN reports when a section depends on an unavailable integration.

## Listening and library coverage

| Area | On the phone |
| --- | --- |
| Library | Browse albums, artists and songs. Filter and sort albums and songs by favorites, audio format or personal rating. Open a library artist for albums, guest appearances and credited songs. Play or shuffle all filtered songs across pages, up to 2,000 tracks and 1 MiB of queue metadata. |
| Now Playing | Tap the mini-player for artwork, playback, seeking, lyrics and the queue. Tap a timed lyric to seek. Track tools show audio information and let you favorite, rate or add a track to a playlist. Android media controls work with the screen locked. |
| Queue | Play next, append, move or remove individual entries, shuffle or clear upcoming tracks without interrupting the current song, and repeat a song or the queue. Android restores the last queue and position paused when you reopen the app after the playback process exits. |
| Playlists | Create, rename and delete playlists, or import an M3U, M3U8 or CSV file and review which tracks DN matched. Add a song or album, reorder tracks, remove one occurrence of a repeated song, and share with viewers or editors. Unavailable entries stay visible. |
| Search and requests | Search for albums, artists and songs. Choose an album edition or request an individual recording. View active requests and history, withdraw eligible requests, and manage server downloads. The download queue groups activity by stage and shows status text, icons, progress and file counts when DN supplies them. Administrators can approve or reject requests. |
| Discover | Browse recommendations, genres, popular albums, trending artists and personal charts. Open an artist for releases and top songs. Follow artists to see new releases and concerts. Library radio builds a queue from DN files related to an artist, album or genre. |
| Account | In **Settings > Account on DroppedNeedle**, change your display name, username, email, listening visibility, scrobble preferences and personal-mix settings. Inspect linked services or sign out another device. |

Under **Requests → Activity → Wanted watches**, see what DN is monitoring, inspect retries and manage watches your account can change. **Requests → Downloads** lets you review eligible search candidates and choose a release. Advanced download and import tools open your server’s web app in the browser, which uses its own sign-in. The listener’s role and the server’s acquisition policy determine the available actions.

The player streams your server’s local files and requires a connection. A download in **Requests > Downloads** is a transfer into the server library. Android reports playback to DN for listening history and linked scrobbling services. Playback reporting and queue restoration after process exit are currently Android features.

**Settings → Library statistics** shows collection size, formats and favorites. Administrators also have native library scans, server diagnostics, release types and edition preferences. **Settings → Web tools** searches the DN pages available to your role. Account security, linking services, backups, plugins, matching, duplicates and bulk edits use the server’s browser interface. Album, artist and playlist details also link directly to their DN web pages.

The phone uses the device volume controls. On Android, **Settings → Playback → Equalizer** uses DN’s playback audio session. Available bands depend on the device. The mobile queue plays tracks regardless of their rating. Use rating filters in Library to choose what goes into a new queue.

## Change the appearance

Open **Settings → Themes** to choose DN’s **Dark**, **Light**, **Midnight** or **System**. The mobile build reads the web theme definitions. System follows the phone’s appearance. Use **Use account theme on this device** or **Save device theme to account** to copy a built-in theme in either direction.

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
