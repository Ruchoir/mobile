// The iPhone's Notification Service Extension (ADR 0006).
//
// The relay's push carries nothing but a placeholder ("Ruchoir", "…") and `mutable-content`, so iOS
// hands it here before showing it. The push does not say which instance sent it, so the extension
// asks the hub of every instance the phone is signed in to for its unread inbox (ADR 0007;
// `GET /api/v1/me/inbox?unread=true`, decided on 2026-11-10), at once, with the hub access tokens
// the app shares in its keychain group (`src/push/phone.ts`), and shows the newest entry of all
// instead: its title and text (the `title` and `body` its product set in `variables`, else the
// product and the kind), its conversation as the thread, and what the app needs to open it on a
// tap, its instance included (under `body`, where expo-notifications reads a remote notification's
// data). The same answer gives each instance's unread count, whose total goes on the app's icon, as
// the bell counts them. When no hub can be reached (its token expired before the app renewed it, or
// the network is down), or nothing is unread any more, it says only "New activity".
//
// The extension holds short-lived access tokens only, never a refresh token: the app renews them
// when it comes to the foreground and from its background task (`src/push/refresh.ts`).
//
// Whatever it shows, it then tells WidgetKit to read again: something new is waiting, and the home
// screen's widgets would otherwise keep the old count until their own quarter hour (which iOS
// stretches to an hour or more).

import Foundation
import Security
import UserNotifications
import WidgetKit

final class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var content: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    let content =
      (request.content.mutableCopy() as? UNMutableNotificationContent) ?? UNMutableNotificationContent()
    content.title = "Ruchoir"
    content.body = Fallback.newActivity()
    self.contentHandler = contentHandler
    self.content = content

    let accounts = SharedKeychain.accounts()
    guard !accounts.isEmpty else {
      finish()
      return
    }
    // Every hub at once; the newest entry of those that answered is shown once all are in.
    let group = DispatchGroup()
    let answers = Answers()
    for account in accounts {
      guard let url = URL(string: account.server + "/api/v1/me/inbox?unread=true&limit=5") else { continue }
      var asking = URLRequest(url: url, timeoutInterval: 20)
      asking.setValue("Bearer " + account.token, forHTTPHeaderField: "Authorization")
      asking.setValue("application/json", forHTTPHeaderField: "Accept")
      group.enter()
      URLSession.shared.dataTask(with: asking) { data, response, _ in
        defer { group.leave() }
        guard
          let http = response as? HTTPURLResponse, http.statusCode == 200,
          let data,
          let page = try? JSONDecoder().decode(InboxPage.self, from: data)
        else { return }
        answers.add(account.server, page)
      }.resume()
    }
    group.notify(queue: .global()) { [weak self] in
      defer { self?.finish() }
      guard let self, let content = self.content else { return }
      let answered = answers.all
      if !answered.isEmpty { content.badge = NSNumber(value: answered.reduce(0) { $0 + $1.page.unread_count }) }
      let entries = answered.flatMap { answer in answer.page.entries.map { (server: answer.server, entry: $0) } }
      guard let newest = entries.max(by: { $0.entry.created_at < $1.entry.created_at }) else { return }
      let entry = newest.entry
      content.title = entry.text("title") ?? entry.product.capitalized
      let body = entry.text("body") ?? entry.kind
      content.body = entries.count > 1 ? body + "\n" + Fallback.more(entries.count - 1) : body
      if let conversation = entry.text("conversation_id") { content.threadIdentifier = conversation }
      // Its id too, so a read on another device can take it off the screen (the app's `syncRead`).
      var tap: [String: String] = ["server": newest.server, "notification_id": entry.id, "link": entry.link]
      if let value = entry.organisation { tap["space_id"] = value }
      for key in ["conversation_id", "message_id", "event_id", "channel_name", "actor_name"] {
        if let value = entry.text(key) { tap[key] = value }
      }
      content.userInfo = ["body": tap]
    }
  }

  /// iOS is about to give up on the extension: show what there is.
  override func serviceExtensionTimeWillExpire() {
    finish()
  }

  private func finish() {
    guard let handler = contentHandler, let content else { return }
    contentHandler = nil
    handler(content)
    WidgetCenter.shared.reloadAllTimelines()
  }
}

/// `GET /api/v1/me/inbox` of the hub (`Page`), the fields used here.
private struct InboxPage: Decodable {
  let entries: [Entry]
  let unread_count: Int

  /// An inbox entry (`Entry`): the product, its kind, and the `variables` its sentence is drawn from.
  struct Entry: Decodable {
    let id: String
    let product: String
    let kind: String
    let link: String
    let organisation: String?
    let created_at: String
    let variables: [String: Value]?

    /// A string of `variables`, when the product set one.
    func text(_ key: String) -> String? {
      if case .text(let value) = variables?[key], !value.isEmpty { return value }
      return nil
    }
  }

  /// A value of `variables`: only strings are read.
  enum Value: Decodable {
    case text(String)
    case other

    init(from decoder: Decoder) throws {
      let container = try decoder.singleValueContainer()
      if let value = try? container.decode(String.self) { self = .text(value) } else { self = .other }
    }
  }
}

/// What the hubs answered, gathered from URLSession's queue behind a lock.
private final class Answers: @unchecked Sendable {
  private let lock = NSLock()
  private var list: [(server: String, page: InboxPage)] = []

  func add(_ server: String, _ page: InboxPage) {
    lock.lock()
    list.append((server, page))
    lock.unlock()
  }

  var all: [(server: String, page: InboxPage)] {
    lock.lock()
    defer { lock.unlock() }
    return list
  }
}

/// A signed-in instance as the app hands it over (`src/push/shared.ts`): its hub and a short-lived
/// access token for it. The calendar and the chat it may also carry are the widgets'.
private struct SharedAccount: Decodable {
  let server: String
  let token: String
}

/// The items the app wrote with expo-secure-store under the service `ruchoir.push`, in the keychain
/// group it shares with this extension. expo-secure-store stores the key as data in the account and
/// suffixes the service with `:no-auth`.
private enum SharedKeychain {
  /// Every signed-in instance (`push.accounts`); an entry that is not an `https://` address is left out.
  static func accounts() -> [SharedAccount] {
    guard let json = read("push.accounts"), let data = json.data(using: .utf8),
      let list = try? JSONDecoder().decode([SharedAccount].self, from: data)
    else { return [] }
    return list.filter { $0.server.hasPrefix("https://") }
  }

  static func read(_ key: String) -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "ruchoir.push:no-auth",
      kSecAttrAccount as String: Data(key.utf8),
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var found: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &found) == errSecSuccess,
      let data = found as? Data
    else { return nil }
    return String(data: data, encoding: .utf8)
  }
}

/// The words the extension says by itself, in the app's six languages.
private enum Fallback {
  private static var language: String {
    let preferred = Locale.preferredLanguages.first ?? "en"
    return String(preferred.prefix(2))
  }

  static func newActivity() -> String {
    switch language {
    case "fr": return "Nouvelle activité"
    case "es": return "Nueva actividad"
    case "de": return "Neue Aktivität"
    case "it": return "Nuova attività"
    case "pl": return "Nowa aktywność"
    default: return "New activity"
    }
  }

  static func more(_ count: Int) -> String {
    switch language {
    case "fr": return "et \(count) de plus"
    case "es": return "y \(count) más"
    case "de": return "und \(count) weitere"
    case "it": return "e altri \(count)"
    case "pl": return "i \(count) więcej"
    default: return "and \(count) more"
    }
  }
}
