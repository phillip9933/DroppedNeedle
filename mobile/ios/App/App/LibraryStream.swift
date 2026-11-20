import AVFoundation
import UniformTypeIdentifiers

/// AVFoundation asks for byte ranges while seeking. Stream those bytes from DN
/// through an ephemeral session so credentials never enter a media URL or cookie jar.
final class LibraryStream: NSObject, AVAssetResourceLoaderDelegate, URLSessionDataDelegate {
    private let token: String
    private let url: URL
    private var pending: [Int: AVAssetResourceLoadingRequest] = [:]
    private var tasks: [ObjectIdentifier: URLSessionDataTask] = [:]
    private var session: URLSession?
    private var conversion: ConvertedTrack?
    private(set) var errorMessage: String?
    let asset: AVURLAsset

    init(url: URL, token: String, profile: StreamProfile) {
        self.url = url
        self.token = token
        var parts = URLComponents()
        parts.scheme = "dnlibrary"
        parts.host = "track"
        parts.path = "/" + UUID().uuidString
        self.asset = AVURLAsset(url: parts.url!)
        super.init()
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.urlCredentialStorage = nil
        session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
        asset.resourceLoader.setDelegate(self, queue: .main)
        if let converted = profile.convertedURL(url) {
            conversion = ConvertedTrack(original: url, converted: converted, token: token, direct: { [weak self] url, loading in
                _ = self?.loadDirect(loading, from: url)
            }, error: { [weak self] message in self?.errorMessage = message })
        }
    }

    func close() {
        conversion?.close()
        conversion = nil
        session?.invalidateAndCancel()
        session = nil
        pending.removeAll()
        tasks.removeAll()
    }

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader,
                        shouldWaitForLoadingOfRequestedResource loading: AVAssetResourceLoadingRequest) -> Bool {
        if let conversion {
            conversion.request(loading)
            return true
        }
        return loadDirect(loading, from: url)
    }

    private func loadDirect(_ loading: AVAssetResourceLoadingRequest, from url: URL) -> Bool {
        guard let session else { return false }
        var request = URLRequest(url: url)
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        if let data = loading.dataRequest {
            let offset = max(data.requestedOffset, data.currentOffset)
            let end = data.requestedOffset + Int64(data.requestedLength) - 1
            request.setValue(data.requestsAllDataToEndOfResource ? "bytes=\(offset)-" : "bytes=\(offset)-\(end)",
                             forHTTPHeaderField: "Range")
        } else {
            request.setValue("bytes=0-1", forHTTPHeaderField: "Range")
        }
        let task = session.dataTask(with: request)
        tasks[ObjectIdentifier(loading)] = task
        pending[task.taskIdentifier] = loading
        task.resume()
        return true
    }

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader, didCancel loading: AVAssetResourceLoadingRequest) {
        conversion?.cancel(loading)
        if let task = tasks.removeValue(forKey: ObjectIdentifier(loading)) {
            pending.removeValue(forKey: task.taskIdentifier)
            task.cancel()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let loading = pending[dataTask.taskIdentifier], let http = response as? HTTPURLResponse,
              [200, 206].contains(http.statusCode) else {
            completionHandler(.cancel)
            return
        }
        let range = http.value(forHTTPHeaderField: "Content-Range")
        let offset = max(loading.dataRequest?.requestedOffset ?? 0, loading.dataRequest?.currentOffset ?? 0)
        if http.statusCode == 200 && offset > 0 {
            completionHandler(.cancel)
            return
        }
        if let info = loading.contentInformationRequest {
            if let mime = response.mimeType { info.contentType = UTType(mimeType: mime)?.identifier }
            if let length = range?.split(separator: "/").last.flatMap({ Int64($0) }) {
                info.contentLength = length
            } else if response.expectedContentLength >= 0 {
                info.contentLength = response.expectedContentLength
            }
            info.isByteRangeAccessSupported = http.statusCode == 206 || http.value(forHTTPHeaderField: "Accept-Ranges") == "bytes"
        }
        if loading.dataRequest == nil {
            tasks.removeValue(forKey: ObjectIdentifier(loading))
            pending.removeValue(forKey: dataTask.taskIdentifier)
            loading.finishLoading()
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        pending[dataTask.taskIdentifier]?.dataRequest?.respond(with: data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let loading = pending.removeValue(forKey: task.taskIdentifier) else { return }
        tasks.removeValue(forKey: ObjectIdentifier(loading))
        if let error { loading.finishLoading(with: error) } else { loading.finishLoading() }
    }
}
