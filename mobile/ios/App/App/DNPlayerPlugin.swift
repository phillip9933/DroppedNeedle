import AVFoundation
import Capacitor
import MediaPlayer
import UIKit

private final class ArtworkSession: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

@objc(DNPlayerPlugin)
public final class DNPlayerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DNPlayerPlugin"
    public let jsName = "DNPlayer"
    public let pluginMethods: [CAPPluginMethod] = ["getState", "setQueue", "command"].map {
        CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
    }

    private let player = AVQueuePlayer()
    private var queue: [[String: Any]] = []
    private var urls: [URL] = []
    private var token = ""
    private var index = -1
    private var streams: [ObjectIdentifier: (index: Int, stream: LibraryStream)] = [:]
    private var observations: [NSKeyValueObservation] = []
    private var itemStatus: NSKeyValueObservation?
    private var listeners: [NSObjectProtocol] = []
    private var commands: [(MPRemoteCommand, Any)] = []
    private var error: String?
    private var wantsPlayback = false
    private var interrupted = false
    private var artwork: MPMediaItemArtwork?
    private var artworkTask: URLSessionDataTask?
    private lazy var artworkSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.urlCache = nil
        return URLSession(configuration: config, delegate: ArtworkSession(), delegateQueue: .main)
    }()

    public override func load() {
        DispatchQueue.main.async { [weak self] in self?.observePlayback() }
    }

    private func observePlayback() {
        observations.append(player.observe(\.currentItem, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.updateCurrentItem() }
        })
        observations.append(player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.publishNowPlaying() }
        })
        let center = NotificationCenter.default
        listeners.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            guard let self, let value = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt else { return }
            if value == AVAudioSession.InterruptionType.began.rawValue {
                self.interrupted = self.wantsPlayback
                self.player.pause()
            } else {
                let flags = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
                if self.interrupted && AVAudioSession.InterruptionOptions(rawValue: flags).contains(.shouldResume) {
                    do { try self.resume() } catch { self.error = "Audio playback is unavailable." }
                } else {
                    self.wantsPlayback = false
                }
                self.interrupted = false
            }
        })
        listeners.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            if let reason = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
               reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue {
                self?.pause()
            }
        })
        listeners.append(center.addObserver(forName: .AVPlayerItemFailedToPlayToEndTime, object: nil, queue: .main) { [weak self] note in
            guard let self, let item = note.object as? AVPlayerItem, self.streams[ObjectIdentifier(item)] != nil else { return }
            self.error = "This track could not be played."
            self.pause()
        })
        let remote = MPRemoteCommandCenter.shared()
        bind(remote.playCommand) { p, _ in try p.resume() }
        bind(remote.pauseCommand) { p, _ in p.pause() }
        bind(remote.togglePlayPauseCommand) { p, _ in try p.toggle() }
        bind(remote.nextTrackCommand) { p, _ in try p.move(to: p.index + 1) }
        bind(remote.previousTrackCommand) { p, _ in try p.previous() }
        bind(remote.changePlaybackPositionCommand) { p, event in
            if let position = event as? MPChangePlaybackPositionCommandEvent { p.seek(position.positionTime) }
        }
    }

    private func bind(_ command: MPRemoteCommand, _ action: @escaping (DNPlayerPlugin, MPRemoteCommandEvent) throws -> Void) {
        let target = command.addTarget { [weak self] event in
            guard let self else { return .commandFailed }
            DispatchQueue.main.async {
                do { try action(self, event) } catch { self.error = "Audio playback is unavailable." }
            }
            return .success
        }
        commands.append((command, target))
    }

    private func activateAudio() throws {
        let audio = AVAudioSession.sharedInstance()
        try audio.setCategory(.playback, mode: .default)
        try audio.setActive(true)
    }

    private func clearItems() {
        itemStatus = nil
        artworkTask?.cancel()
        artwork = nil
        pause()
        player.removeAllItems()
        for (_, entry) in streams { entry.stream.close() }
        streams.removeAll()
        interrupted = false
        error = nil
    }

    private func move(to position: Int) throws {
        guard queue.indices.contains(position) else { return }
        try activateAudio()
        clearItems()
        index = position
        append(position)
        if queue.indices.contains(position + 1) { append(position + 1) }
        updateCurrentItem()
        wantsPlayback = true
        player.play()
    }

    private func append(_ index: Int) {
        let stream = LibraryStream(url: urls[index], token: token)
        let item = AVPlayerItem(asset: stream.asset)
        streams[ObjectIdentifier(item)] = (index, stream)
        player.insert(item, after: player.items().last)
    }

    private func updateCurrentItem() {
        let retained = Set(player.items().map { ObjectIdentifier($0) })
        for key in Array(streams.keys) where !retained.contains(key) {
            streams.removeValue(forKey: key)?.stream.close()
        }
        guard let item = player.currentItem, let entry = streams[ObjectIdentifier(item)] else {
            wantsPlayback = false
            interrupted = false
            publishNowPlaying()
            return
        }
        let changed = index != entry.index || itemStatus == nil
        index = entry.index
        if changed {
            error = nil
            itemStatus = item.observe(\.status, options: [.initial, .new]) { [weak self, weak item] _, _ in
                DispatchQueue.main.async {
                    guard let self, let item, self.player.currentItem === item else { return }
                    if item.status == .failed {
                        self.error = "This track could not be played."
                        self.pause()
                    }
                    self.publishNowPlaying()
                }
            }
            loadArtwork()
        }
        if player.items().count == 1, queue.indices.contains(index + 1) { append(index + 1) }
        publishNowPlaying()
    }

    private func loadArtwork() {
        artworkTask?.cancel()
        artwork = nil
        guard let path = queue[index]["artworkUrl"] as? String, let url = URL(string: path) else { return }
        let track = index
        let credential = token
        var request = URLRequest(url: url)
        request.setValue("Bearer " + credential, forHTTPHeaderField: "Authorization")
        artworkTask = artworkSession.dataTask(with: request) { [weak self] data, response, _ in
            guard let self, self.index == track, self.token == credential, self.queue.indices.contains(track),
                  self.queue[track]["artworkUrl"] as? String == path,
                  let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let data, let image = UIImage(data: data) else { return }
            self.artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            self.publishNowPlaying()
        }
        artworkTask?.resume()
    }

    private var position: Double {
        let seconds = player.currentTime().seconds
        return seconds.isFinite ? max(0, seconds) : 0
    }

    private var duration: Double {
        if let seconds = player.currentItem?.duration.seconds, seconds.isFinite { return seconds }
        return queue.indices.contains(index) ? queue[index]["duration"] as? Double ?? 0 : 0
    }

    private func publishNowPlaying() {
        let remote = MPRemoteCommandCenter.shared()
        remote.nextTrackCommand.isEnabled = queue.indices.contains(index + 1)
        remote.previousTrackCommand.isEnabled = queue.indices.contains(index)
        guard queue.indices.contains(index) else { MPNowPlayingInfoCenter.default().nowPlayingInfo = nil; return }
        let track = queue[index]
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: track["title"] as? String ?? "",
            MPMediaItemPropertyArtist: track["artist"] as? String ?? "",
            MPMediaItemPropertyAlbumTitle: track["album"] as? String ?? "",
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPNowPlayingInfoPropertyPlaybackRate: player.rate
        ]
        if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func resume() throws {
        guard queue.indices.contains(index) else { return }
        if player.currentItem == nil || player.currentItem?.status == .failed || error != nil {
            try move(to: index)
        } else {
            try activateAudio()
            wantsPlayback = true
            player.play()
        }
    }

    private func pause() {
        wantsPlayback = false
        interrupted = false
        player.pause()
    }

    private func toggle() throws {
        if player.timeControlStatus == .paused { try resume() } else { pause() }
    }

    private func previous() throws {
        if position > 3 || index <= 0 { seek(0) } else { try move(to: index - 1) }
    }

    private func seek(_ value: Double) {
        guard value.isFinite else { return }
        player.seek(to: CMTime(seconds: max(0, value), preferredTimescale: 600)) { [weak self] _ in
            DispatchQueue.main.async { self?.publishNowPlaying() }
        }
    }

    @objc func getState(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(self.snapshot()) }
    }

    private func snapshot() -> [String: Any] {
        return ["tracks": queue, "index": index, "playing": player.timeControlStatus != .paused,
                "position": position, "duration": duration, "error": error as Any? ?? NSNull()]
    }

    @objc func setQueue(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let tracks = call.getArray("tracks", [String: Any].self), let index = call.getInt("index"),
                  tracks.indices.contains(index), let token = call.getString("token"), !token.isEmpty,
                  let address = call.getString("serverUrl"), let base = URL(string: address),
                  base.scheme == "https", base.host != nil, base.user == nil, base.password == nil else {
                call.reject("Choose a track from a connected DroppedNeedle library.")
                return
            }
            let path = base.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            let api = (path.isEmpty ? "" : "/" + path) + "/api/v3/"
            func allowed(_ string: String?, prefix: String) -> URL? {
                guard let string, let url = URL(string: string), url.scheme == "https",
                      url.host?.lowercased() == base.host?.lowercased(), (url.port ?? 443) == (base.port ?? 443),
                      url.user == nil, url.password == nil, url.standardized.path.hasPrefix(api + prefix) else { return nil }
                return url
            }
            var checked: [URL] = []
            for track in tracks {
                guard let stream = allowed(track["streamUrl"] as? String, prefix: "stream/local/") else {
                    call.reject("Invalid DroppedNeedle stream.")
                    return
                }
                if let art = track["artworkUrl"] as? String, allowed(art, prefix: "") == nil {
                    call.reject("Invalid DroppedNeedle artwork.")
                    return
                }
                checked.append(stream)
            }
            do {
                try self.activateAudio()
                self.queue = tracks
                self.urls = checked
                self.token = token
                try self.move(to: index)
                call.resolve(self.snapshot())
            } catch { call.reject("Audio playback is unavailable.") }
        }
    }

    @objc func command(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do {
                switch call.getString("action") {
                case "clear":
                    self.clearItems()
                    self.queue = []
                    self.urls = []
                    self.token = ""
                    self.index = -1
                    self.publishNowPlaying()
                    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
                case "toggle": try self.toggle()
                case "previous": try self.previous()
                case "next": try self.move(to: self.index + 1)
                case "skipTo": try self.move(to: call.getInt("value") ?? -1)
                case "seek": self.seek(call.getDouble("value") ?? 0)
                default: call.reject("Unknown playback command."); return
                }
                call.resolve(self.snapshot())
            } catch { call.reject("Audio playback is unavailable.") }
        }
    }

    deinit {
        player.pause()
        for (_, entry) in streams { entry.stream.close() }
        artworkSession.invalidateAndCancel()
        for listener in listeners { NotificationCenter.default.removeObserver(listener) }
        for (command, target) in commands { command.removeTarget(target) }
    }
}
