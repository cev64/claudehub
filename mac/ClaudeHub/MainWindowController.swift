import AppKit
import WebKit

/// The one window: a WKWebView showing the dashboard, with an offline page while the agent is down.
///
/// Web app integration:
/// - The user agent ends in " ClaudeHubMac/1.0", so the web app can detect it runs in this app.
/// - `window.webkit.messageHandlers.copy.postMessage(text)` puts `text` on the clipboard
///   (main frame only). navigator.clipboard.writeText also works from a click, because
///   http://127.0.0.1 is a secure context; the bridge is a fallback that needs no user gesture.
/// - Links to other hosts, target=_blank links and window.open(url) open in the default browser.
@MainActor
final class MainWindowController: NSWindowController, NSWindowDelegate, NSMenuItemValidation,
    WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, DashboardActions {

    private let homeURL: URL
    private let webView: WKWebView
    private var retryTimer: Timer?
    private var homeLoadInFlight = false
    private var showingOffline = false

    private static let zoomSteps: [Double] = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
    private static let retryInterval: TimeInterval = 4

    init(homeURL: URL) {
        self.homeURL = homeURL

        let contentController = WKUserContentController()
        let config = WKWebViewConfiguration()
        config.userContentController = contentController
        config.applicationNameForUserAgent = "ClaudeHubMac/1.0"
        config.websiteDataStore = .default()
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.preferences.isElementFullscreenEnabled = true

        webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsMagnification = false
        webView.isInspectable = true // Safari → Develop → this Mac → ClaudeHub
        webView.underPageBackgroundColor = Self.pageColor
        webView.pageZoom = AppSettings.pageZoom

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 840),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "ClaudeHub"
        window.contentMinSize = NSSize(width: 390, height: 600)
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.backgroundColor = Self.pageColor
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.contentView = webView
        window.initialFirstResponder = webView
        window.center()
        window.setFrameAutosaveName("ClaudeHubMainWindow")

        super.init(window: window)
        window.delegate = self
        webView.navigationDelegate = self
        webView.uiDelegate = self
        let handler = WeakScriptMessageHandler(self)
        contentController.add(handler, name: "copy")
        contentController.add(handler, name: "retry")

        loadHome()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    /// The dashboard's `page` token, so there is no white flash before it paints.
    private static let pageColor = NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(srgbRed: 0x0A / 255, green: 0x11 / 255, blue: 0x22 / 255, alpha: 1)
            : NSColor(srgbRed: 0xF4 / 255, green: 0xF6 / 255, blue: 0xFB / 255, alpha: 1)
    }

    // MARK: Loading and the offline page

    private func loadHome() {
        homeLoadInFlight = true
        webView.load(URLRequest(url: homeURL, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 10))
    }

    private func showOffline(detail: String) {
        homeLoadInFlight = false
        if showingOffline {
            // Already on the offline page: just reset its Retry button.
            webView.evaluateJavaScript("window.offlineUpdate && window.offlineUpdate()")
        } else {
            showingOffline = true
            webView.loadHTMLString(OfflinePage.html(url: homeURL, detail: detail), baseURL: nil)
        }
        startRetrying()
    }

    private func startRetrying() {
        guard retryTimer == nil else { return }
        retryTimer = Timer.scheduledTimer(withTimeInterval: Self.retryInterval, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.showingOffline, !self.homeLoadInFlight else { return }
                self.loadHome()
            }
        }
    }

    private func stopRetrying() {
        retryTimer?.invalidate()
        retryTimer = nil
    }

    // MARK: Navigation policy

    private func isDashboard(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == homeURL.scheme?.lowercased() else { return false }
        func port(_ u: URL) -> Int { u.port ?? (u.scheme?.lowercased() == "https" ? 443 : 80) }
        guard port(url) == port(homeURL) else { return false }
        let loopback: Set<String> = ["127.0.0.1", "localhost", "::1", "[::1]"]
        let a = url.host?.lowercased() ?? "", b = homeURL.host?.lowercased() ?? ""
        return a == b || (loopback.contains(a) && loopback.contains(b))
    }

    private func openInBrowser(_ url: URL) {
        // Only web and mail links: transcripts render Markdown written by Claude, so don't hand
        // arbitrary URL schemes (other apps' handlers, file:) to the system.
        guard let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme)
        else { return }
        NSWorkspace.shared.open(url)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else {
            decisionHandler(.allow); return
        }
        if ["about", "data", "blob"].contains(scheme) { decisionHandler(.allow); return }

        let newWindow = navigationAction.targetFrame == nil
        let mainFrame = navigationAction.targetFrame?.isMainFrame ?? false
        let commandClick = navigationAction.navigationType == .linkActivated
            && navigationAction.modifierFlags.contains(.command)

        if newWindow || commandClick || (mainFrame && !isDashboard(url)) {
            openInBrowser(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    // window.open(url) and target=_blank: hand the URL to the default browser, never a new web view.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.absoluteString != "about:blank", !url.absoluteString.isEmpty {
            openInBrowser(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        guard let url = webView.url else { return }
        if isDashboard(url) {
            homeLoadInFlight = false
            showingOffline = false
            stopRetrying()
        } else if url.scheme == "about" {
            // The offline page, possibly reached by swiping back: keep retrying.
            showingOffline = true
            startRetrying()
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { homeLoadInFlight = false; return }
        if ns.domain == "WebKitErrorDomain" && ns.code == 102 { homeLoadInFlight = false; return } // cancelled by policy
        showOffline(detail: ns.localizedDescription)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        loadHome()
    }

    // MARK: Page panels (alert, confirm, prompt, file inputs)

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        present(alert) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        present(alert) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = prompt
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        present(alert) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        guard let window else { completionHandler(nil); return }
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    private func present(_ alert: NSAlert, _ done: @escaping @MainActor (NSApplication.ModalResponse) -> Void) {
        if let window, window.isVisible {
            alert.beginSheetModal(for: window) { done($0) }
        } else {
            done(alert.runModal())
        }
    }

    // MARK: Script messages

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame else { return }
        switch message.name {
        case "copy":
            guard let text = message.body as? String else { return }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
        case "retry":
            if !homeLoadInFlight { loadHome() }
        default:
            break
        }
    }

    // MARK: Menu actions

    @objc func reloadDashboard(_ sender: Any?) {
        if showingOffline || webView.url == nil || !isDashboard(webView.url!) {
            loadHome()
        } else {
            webView.reload()
        }
    }

    @objc func zoomActualSize(_ sender: Any?) { setZoom(1) }

    @objc func zoomInPage(_ sender: Any?) {
        setZoom(Self.zoomSteps.first { $0 > webView.pageZoom + 0.001 } ?? Self.zoomSteps.last!)
    }

    @objc func zoomOutPage(_ sender: Any?) {
        setZoom(Self.zoomSteps.last { $0 < webView.pageZoom - 0.001 } ?? Self.zoomSteps.first!)
    }

    private func setZoom(_ value: Double) {
        webView.pageZoom = value
        AppSettings.pageZoom = value
    }

    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        switch menuItem.action {
        case #selector(zoomActualSize(_:)): return abs(webView.pageZoom - 1) > 0.001
        case #selector(zoomInPage(_:)): return webView.pageZoom < Self.zoomSteps.last! - 0.001
        case #selector(zoomOutPage(_:)): return webView.pageZoom > Self.zoomSteps.first! + 0.001
        default: return true
        }
    }
}

/// WKUserContentController retains its handlers; this keeps it from retaining the controller.
@MainActor
private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: (any WKScriptMessageHandler)?
    init(_ target: any WKScriptMessageHandler) { self.target = target }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
