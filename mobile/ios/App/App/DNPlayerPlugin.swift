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
    private struct Track {
        let key = UUID()
        let data: [String: Any]
        let url: URL
    }
    private enum RepeatMode: String { case off, all, one }
    private var repeatMode: RepeatMode = .off
    private var queue: [Track] = []
    private var serverAddress = ""
    private weak var observedItem: AVPlayerItem?
    private var token = ""
    private var index = -1
    private var streams: [ObjectIdentifier: (key: UUID, stream: LibraryStream)] = [:]
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
        bind(remote.nextTrackCommand) { p, _ in try p.next() }
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

    private func move(to position: Int, play: Bool = true) throws {
        guard queue.indices.contains(position) else { return }
        if play { try activateAudio() }
        clearItems()
        index = position
        append(position)
        updateCurrentItem()
        wantsPlayback = play
        if play { player.play() }
    }

    private func append(_ index: Int) {
        let stream = LibraryStream(url: queue[index].url, token: token)
        let item = AVPlayerItem(asset: stream.asset)
        streams[ObjectIdentifier(item)] = (queue[index].key, stream)
        player.insert(item, after: player.items().last)
    }

    private func updateCurrentItem() {
        let retained = Set(player.items().map { ObjectIdentifier($0) })
        for key in Array(streams.keys) where !retained.contains(key) {
            streams.removeValue(forKey: key)?.stream.close()
        }
        guard let item = player.currentItem, let entry = streams[ObjectIdentifier(item)],
              let activeIndex = queue.firstIndex(where: { $0.key == entry.key }) else {
            wantsPlayback = false
            interrupted = false
            publishNowPlaying()
            return
        }
        index = activeIndex
        if observedItem !== item {
            observedItem = item
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
        let following = nextIndex(automatic: true)
        if let prepared = player.items().dropFirst().first,
           following.map({ queue[$0].key }) != streams[ObjectIdentifier(prepared)]?.key {
            player.remove(prepared)
            streams.removeValue(forKey: ObjectIdentifier(prepared))?.stream.close()
        }
        if player.items().count == 1, let following { append(following) }
        publishNowPlaying()
    }

    private func loadArtwork() {
        artworkTask?.cancel()
        artwork = nil
        guard let path = queue[index].data["artworkUrl"] as? String, let url = URL(string: path) else { return }
        let key = queue[index].key
        let credential = token
        var request = URLRequest(url: url)
        request.setValue("Bearer " + credential, forHTTPHeaderField: "Authorization")
        artworkTask = artworkSession.dataTask(with: request) { [weak self] data, response, _ in
            guard let self, self.token == credential, self.queue.indices.contains(self.index),
                  self.queue[self.index].key == key,
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
        return queue.indices.contains(index) ? queue[index].data["duration"] as? Double ?? 0 : 0
    }

    private func publishNowPlaying() {
        let remote = MPRemoteCommandCenter.shared()
        remote.nextTrackCommand.isEnabled = nextIndex(automatic: false) != nil
        remote.previousTrackCommand.isEnabled = queue.indices.contains(index)
        guard queue.indices.contains(index) else { MPNowPlayingInfoCenter.default().nowPlayingInfo = nil; return }
        let track = queue[index].data
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

    private func nextIndex(automatic: Bool) -> Int? {
        guard queue.indices.contains(index) else { return nil }
        if automatic && repeatMode == .one { return index }
        if queue.indices.contains(index + 1) { return index + 1 }
        return repeatMode == .all ? 0 : nil
    }

    private func next() throws {
        if let target = nextIndex(automatic: false) { try move(to: target) }
    }

    private func previous() throws {
        if position > 3 { seek(0) }
        else if index > 0 { try move(to: index - 1) }
        else if repeatMode == .all { try move(to: queue.count - 1) }
        else { seek(0) }
    }

    private func clearQueue() {
        clearItems()
        queue = []
        token = ""
        serverAddress = ""
        repeatMode = .off
        index = -1
        publishNowPlaying()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func edit(_ action: String, from: Int, to: Int) throws {
        guard queue.indices.contains(index) else { return }
        let current = queue[index].key
        switch action {
        case "cycleRepeat": repeatMode = repeatMode == .off ? .all : repeatMode == .all ? .one : .off
        case "shuffleUpcoming":
            queue[(index + 1)...].shuffle()
        case "move":
            guard queue.indices.contains(from), queue.indices.contains(to) else { return }
            let track = queue.remove(at: from)
            queue.insert(track, at: to)
        case "remove":
            guard queue.indices.contains(from) else { return }
            queue.remove(at: from)
            if queue.isEmpty { clearQueue(); return }
            if from == index {
                try move(to: min(from, queue.count - 1), play: wantsPlayback)
                return
            }
        default: return
        }
        if let kept = queue.firstIndex(where: { $0.key == current }) { index = kept }
        updateCurrentItem()
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
        return ["tracks": queue.map(\.data), "repeat": repeatMode.rawValue, "index": index, "playing": player.timeControlStatus != .paused,
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
            var checked: [Track] = []
            for track in tracks {
                guard let stream = allowed(track["streamUrl"] as? String, prefix: "stream/local/") else {
                    call.reject("Invalid DroppedNeedle stream.")
                    return
                }
                if let art = track["artworkUrl"] as? String, allowed(art, prefix: "") == nil {
                    call.reject("Invalid DroppedNeedle artwork.")
                    return
                }
                checked.append(Track(data: track, url: stream))
            }
            do {
                if let placement = call.getString("placement"), !self.queue.isEmpty {
                    guard self.token == token, self.serverAddress == address else {
                        call.reject("This queue belongs to a different session.")
                        return
                    }
                    self.updateCurrentItem()
                    let target = placement == "next" ? self.index + 1 : self.queue.count
                    self.queue.insert(contentsOf: checked, at: target)
                    self.updateCurrentItem()
                } else {
                    try self.activateAudio()
                    self.queue = checked
                    self.token = token
                    self.serverAddress = address
                    try self.move(to: index)
                }
                call.resolve(self.snapshot())
            } catch { call.reject("Audio playback is unavailable.") }
        }
    }

    @objc func command(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do {
                let action = call.getString("action") ?? ""
                self.updateCurrentItem()
                switch action {
                case "clear": self.clearQueue()
                case "cycleRepeat", "shuffleUpcoming", "move", "remove":
                    try self.edit(action, from: call.getInt("value") ?? -1, to: call.getInt("to") ?? -1)
                case "toggle": try self.toggle()
                case "previous": try self.previous()
                case "next": try self.next()
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
