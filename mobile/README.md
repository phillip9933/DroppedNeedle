# DroppedNeedle Mobile

The Android and iOS apps connect to your DroppedNeedle v3 server. Browse your library, find an album, request an edition, and play the files when they arrive.

## Connect your phone

1. Enter the HTTPS address that opens DroppedNeedle. Include the path if your server uses one.
2. Choose **Continue in browser** if your server offers it. Sign in to DroppedNeedle as usual and select **Connect this phone**. If the browser stays open, select **Return to the app**.
3. If your server offers OIDC but still needs the mobile pairing page, **Open web player** takes you to its existing browser player. To use the native player on that server, you can also use an existing DN v3 device session token or a server password if your account has one.

For OIDC, including authentik, enter the public DroppedNeedle address served by your reverse proxy. The browser uses the provider and callback already configured in DroppedNeedle. After you approve the phone, the app verifies its own device session with your server. If the connection drops during that step, reopen the app or select **Retry connection** within ten minutes. You can revoke phone access from **Profile > Sessions** in the web app.

Server administrators can add browser sign-in by building the DN web frontend with the `feat/mobile-browser-pairing` change. It provides `/connect/mobile` and `/mobile-pairing.json`. The marker should return JSON containing `"droppedneedle_mobile_pairing": 1`. The phone must be able to reach the DN API and media endpoints using its DN device session. A proxy that requires a separate browser session on those routes needs a compatible access policy.

## Find and play an album

**Library** shows recently added albums. Open a cover and select **Play album** or an individual track. Tap the mini-player to open the artwork, seek bar, playback controls, and queue. You can switch tracks from the queue or use the phone's media controls with the screen locked. On Android, Back closes the queue first, then returns you to your place in the library. Playback controls also reflect temporary interruptions when another app takes audio focus.

Choose **Library > Playlists** to open a saved DN playlist. **Play playlist** queues the tracks available in your DN library in their saved order, including repeats. Unavailable entries stay visible in the list.

In **Search**, enter an artist, album, or song. For an album you do not own, open it, choose an edition, and select **Request album**. **Requests** shows the status and refreshes while open. When the album is imported, open the request and play the local copy. The server applies the same request permissions and approval settings as it does on the web.

The player streams files from this server's local library. It needs a connection to the server. Queue state lasts for the current playback process.

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
