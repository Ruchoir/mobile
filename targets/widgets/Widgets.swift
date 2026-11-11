// The widgets the app offers: the agenda and the discussions.

import SwiftUI
import WidgetKit

@main
struct RuchoirWidgets: WidgetBundle {
  var body: some Widget {
    AgendaWidget()
    DiscussionsWidget()
  }
}
