# DroppedNeedle Mobile

The Android and iOS apps connect to your DroppedNeedle v3 server. Play music from your DN library, manage your queue and playlists, and request albums or songs from the same server. Android is the primary tested platform.

## Connect your phone

1. Enter the HTTPS address that opens DroppedNeedle. Include the path if your server uses one.
2. Choose **Continue in browser** if your server offers it. Sign in to DroppedNeedle as usual and select **Connect this phone**. If the browser stays open, select **Return to the app**.
3. If your server offers OIDC but still needs the mobile pairing page, **Open web player** takes you to its existing browser player. To use the native player on that server, you can also use an existing DN v3 device session token or a server password if your account has one.

For OIDC, including authentik, enter the public DroppedNeedle address served by your reverse proxy. The browser uses the provider and callback already configured in DroppedNeedle. After you approve the phone, the app verifies its own device session with your server. If the connection drops during that step, reopen the app or select **Retry connection** within ten minutes. You can revoke phone access from **Profile > Sessions** in the web app.

Server administrators can add browser sign-in by building the DN web frontend with the `feat/mobile-browser-pairing` change. It provides `/connect/mobile` and `/mobile-pairing.json`. The marker should return JSON containing `"droppedneedle_mobile_pairing": 1`. The phone must be able to reach the DN API and media endpoints using its DN device session. A proxy that requires a separate browser session on those routes needs a compatible access policy.

## Arrange Home, Library and Discover

Home opens after sign-in. It starts with recently added albums, your recent plays and a shortcut to your top picks. Tap a section heading to open the full collection. In Library or Discover, **Add to Home** copies that section to the end of Home.

Choose **Edit** on any of the three screens. Under **Add sections**, choose an item to set its title, position and preview. Turn **Show a preview** off for a single browse row. Use the arrows to move an item, its sliders to change it, or the minus button to take it off that screen. Select **Save layout** when ready. **Cancel** discards the draft. **Restore default layout** sets up a new draft for the current screen.

Home can use any Library or Discover section. Library and Discover each have their own order, visibility, titles and preview choices. The app saves these layouts on this phone for the signed-in DN account and server. DN still decides which recommendation data and integrations are available for that account.

## Listening and library coverage

| Area | On the phone |
| --- | --- |
| Library | Browse albums, artists and songs. Open a section to filter, sort, or show favorites. Open a library artist to browse their albums. |
| Now Playing | Tap the mini-player for artwork, playback, seeking, lyrics and the queue. Synced lyrics highlight the current line when DN supplies timings. Android media controls work with the screen locked. |
| Queue | Play next, append, move or remove individual entries, shuffle upcoming tracks, and repeat a song or the queue. Android restores the last queue and position paused when you reopen the app after the playback process exits. |
| Playlists | Create, rename and delete playlists. Add a song or album, reorder tracks, remove one occurrence of a repeated song, and share with viewers or editors. Unavailable entries stay visible. |
| Search and requests | Search for albums, artists and songs. Choose an album edition or request an individual recording. View active requests and history, withdraw eligible requests, and manage server downloads. Administrators can approve or reject requests. |
| Discover | Browse recommendations, genres, popular albums, trending artists and personal charts. Open an artist for releases and top songs. Follow artists to see new releases and concerts. Library radio builds a queue from DN files related to an artist, album or genre. |
| Account | In **Settings > Account on DroppedNeedle**, change your display name, listening visibility and scrobble preferences, or sign out another device. Administrators can check library health and start an incremental scan. |

From **Requests > Downloads**, review eligible search candidates and choose a release. Advanced download and import tools open your server’s web app in the browser, which uses its own sign-in. The listener’s role and the server’s acquisition policy determine the available actions.

The player streams your server’s local files and requires a connection. A download in **Requests > Downloads** is a transfer into the server library. Android reports playback to DN for listening history and linked scrobbling services. Playback reporting and queue restoration after process exit are currently Android features.

Account security, linking a music service, full server configuration and advanced library management (including matching, duplicates and bulk edits) open in the DN web app. In the phone app, **Settings > Account on DroppedNeedle > Profile** links to the pages your account can use.

## Change the appearance

Open **Settings > Appearance** and choose **Studio** or **Paper**. Under **Edit or share theme**, copy the current JSON to share it or paste a theme and select **Apply theme**. The app validates the values before it saves them on the phone. Select a preset to restore its defaults.

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
