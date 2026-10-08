import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var windowController: MainWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = MainMenu.build()
        let controller = MainWindowController(homeURL: AppSettings.homeURL)
        windowController = controller
        controller.showWindow(nil)
        NSApp.activate()
    }

    // Closing the window keeps the app running; the Dock icon brings it back.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { windowController?.showWindow(nil) }
        return true
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    // View menu commands also work while no window is key (the window controller handles them
    // first when its window is key; these forward to it otherwise).
    @objc func reloadDashboard(_ sender: Any?) { windowController?.reloadDashboard(sender) }
    @objc func zoomActualSize(_ sender: Any?) { windowController?.zoomActualSize(sender) }
    @objc func zoomInPage(_ sender: Any?) { windowController?.zoomInPage(sender) }
    @objc func zoomOutPage(_ sender: Any?) { windowController?.zoomOutPage(sender) }
}

enum AppSettings {
    static let defaultURL = URL(string: "http://127.0.0.1:4317")!

    /// `defaults write com.claudehub.app url http://host:port` overrides the dashboard address
    /// (the CLAUDEHUB_URL environment variable works too, for one-off launches).
    static var homeURL: URL {
        let raw = UserDefaults.standard.string(forKey: "url")
            ?? ProcessInfo.processInfo.environment["CLAUDEHUB_URL"]
        if let raw, let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
           let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https", url.host != nil {
            return url
        }
        return defaultURL
    }

    static var pageZoom: Double {
        get {
            let value = UserDefaults.standard.double(forKey: "pageZoom")
            return value > 0 ? value : 1
        }
        set { UserDefaults.standard.set(newValue, forKey: "pageZoom") }
    }
}
