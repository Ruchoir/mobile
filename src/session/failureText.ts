import { key } from "../i18n";
import type { FailureCode } from "./SessionProvider";

/** The sentence each sign-in failure is told with. */
export const FAILURE_TEXT = {
  empty: key("auth.error.empty"),
  insecure: key("auth.error.insecure"),
  invalid: key("auth.error.invalid"),
  unreachable: key("auth.error.unreachable"),
  notRuchoir: key("auth.error.notRuchoir"),
  alreadyAdded: key("auth.error.alreadyAdded"),
  unknown: key("auth.error.unknown"),
} satisfies Record<FailureCode, string>;
