import Foundation

/// Shown when the agent can't be reached. The app retries on its own every few seconds;
/// the Retry button posts to `window.webkit.messageHandlers.retry`.
enum OfflinePage {
    static let restartCommand = "launchctl kickstart -k gui/$(id -u)/com.claudehub.agent"

    static func html(url: URL, detail: String) -> String {
        """
        <!doctype html>
        <html lang="en">
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>ClaudeHub</title>
        <style>
          :root {
            color-scheme: light dark;
            --ink: #08204F; --ink-2: #415373; --ink-3: #63718A; --page: #F4F6FB;
            --glass: rgba(255, 255, 255, .72); --ring: rgba(8, 32, 79, .06); --hi: rgba(255, 255, 255, .7);
            --shadow: 0 8px 28px rgba(8, 32, 79, .08);
            --accent: #1059FC; --accent-pressed: #0A45CC; --on-accent: #FFFFFF;
            --neutral: rgba(8, 32, 79, .06); --neutral-pressed: rgba(8, 32, 79, .1);
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --ink: #F5F8FF; --ink-2: #C2CEE2; --ink-3: #91A2BF; --page: #0A1122;
              --glass: rgba(255, 255, 255, .06); --ring: rgba(255, 255, 255, .08); --hi: rgba(255, 255, 255, .06);
              --shadow: 0 8px 28px rgba(0, 0, 0, .3);
              --accent: #4A82FF; --accent-pressed: #7BA3FF; --on-accent: #0A1122;
              --neutral: rgba(255, 255, 255, .08); --neutral-pressed: rgba(255, 255, 255, .14);
            }
          }
          html, body { height: 100%; margin: 0; }
          body {
            background: var(--page); color: var(--ink);
            font: 16px/24px -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
            -webkit-font-smoothing: antialiased; display: grid; place-items: center;
          }
          main { box-sizing: border-box; width: 100%; max-width: 600px; padding: 32px 16px; }
          h1 { font-size: 24px; line-height: 30px; font-weight: 600; letter-spacing: -.48px; margin: 0 0 8px; }
          p { margin: 0 0 24px; color: var(--ink-2); }
          .cmd {
            display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 16px; margin-bottom: 24px;
            background: var(--glass); border-radius: 16px;
            box-shadow: inset 0 1px 0 var(--hi), 0 0 0 1px var(--ring), var(--shadow);
          }
          code {
            flex: 1; min-width: 0; font: 13px/20px ui-monospace, SFMono-Regular, Menlo, monospace;
            color: var(--ink); -webkit-user-select: all; user-select: all; white-space: nowrap; overflow-x: auto;
          }
          button {
            font: inherit; font-weight: 500; border: 0; cursor: default; border-radius: 12px;
            transition: background-color .15s ease, transform .15s ease;
          }
          button:active { transform: scale(.97); }
          button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
          .copy { padding: 6px 12px; font-size: 14px; background: var(--neutral); color: var(--ink); }
          .copy:active { background: var(--neutral-pressed); }
          .retry { padding: 10px 20px; background: var(--accent); color: var(--on-accent); }
          .retry:active { background: var(--accent-pressed); }
          .retry:disabled { opacity: .6; }
          .meta { margin-top: 16px; font-size: 12px; line-height: 16px; color: var(--ink-3); }
          @media (prefers-reduced-motion: reduce) { button { transition: none; } button:active { transform: none; } }
        </style>
        </head>
        <body>
        <main>
          <h1>ClaudeHub agent isn't running</h1>
          <p>Nothing is answering at \(escape(url.absoluteString)). Start the agent in Terminal:</p>
          <div class="cmd">
            <code id="cmd">\(escape(restartCommand))</code>
            <button class="copy" id="copy" type="button">Copy</button>
          </div>
          <button class="retry" id="retry" type="button">Retry</button>
          <div class="meta" id="meta">Trying again every few seconds. \(escape(detail))</div>
        </main>
        <script>
          const retry = document.getElementById('retry');
          const copy = document.getElementById('copy');
          const post = (name, body) => window.webkit?.messageHandlers?.[name]?.postMessage(body);
          retry.addEventListener('click', () => {
            retry.disabled = true; retry.textContent = 'Checking\\u2026';
            post('retry', '');
          });
          copy.addEventListener('click', () => {
            post('copy', document.getElementById('cmd').textContent);
            copy.textContent = 'Copied';
            setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
          });
          window.offlineUpdate = () => { retry.disabled = false; retry.textContent = 'Retry'; };
        </script>
        </body>
        </html>
        """
    }

    private static func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
}
