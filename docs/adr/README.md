# Decisions of this repository

Numbered from `0001`: `NNNN-short-title.md`, with a status, a date, the context, the decision and its
consequences. An accepted ADR is never rewritten: a later one supersedes it.

| ADR | Decision |
|---|---|
| [0001](0001-native-apps.md) | Native apps with Expo and React Native as libraries, no hosted Expo service, sessions kept in the Keychain (moved from the former monolith) |
| [0002](0002-several-instances-in-the-apps.md) | The phone and desktop apps hold several instances at once; the web stays one instance per tab (moved from the former monolith) |

Both were written for the former monolith, whose API delivered sessions itself. The app now signs in
with Propolis (`@ruchoir/native-client`) and calls each product with an access token of its own
([`AGENTS.md`](../../AGENTS.md), "Rules"); what they decide about Expo, hosted services and several
instances at once still holds.

Decisions that touch several repositories live in
[Ruchoir/.github](https://github.com/Ruchoir/.github/tree/main/docs/adr).
