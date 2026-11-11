# Ruchoir mobile

The phone app of Ruchoir, a self-hosted, European collaboration suite: chat, files, calendar, with one
identity service. It is one Expo app for iOS and Android that holds every Ruchoir instance you belong
to at once: the conversations, the files and the agenda of each, its notifications, and widgets.
No hosted Expo service is used in what is built or shipped, and the Expo CLI always runs with
`EXPO_NO_TELEMETRY=1`.

[Propolis](https://github.com/Ruchoir/propolis) signs you in, in the system's authentication
browser, and its pages manage your account and your organisations; [the
hub](https://github.com/Ruchoir/hub) describes each instance in its manifest and brings the inbox,
the live events and the phone notifications (through its push relay); [core](https://github.com/Ruchoir/core)
holds the shared packages the app builds on (`@ruchoir/native-client`, `@ruchoir/permissions-logic`,
`@ruchoir/design-system`). The app talks to [the chat](https://github.com/Ruchoir/chat), [the
drive](https://github.com/Ruchoir/drive) and [the calendar](https://github.com/Ruchoir/calendar)
through their public APIs, each with an access token of its own. How the pieces fit:
[architecture](https://github.com/Ruchoir/.github/blob/main/docs/architecture.md).

## Status

The app moved here from the former monolith with its history. It signs in with Propolis (RFC 8252,
one refresh token per issuer in the Keychain), holds several instances at once, and reaches each
product of an instance on its own origin: the hub, the chat, the drive and the calendar. A product's
tab and widgets show only when the instance's manifest lists it.

Not there yet: what the screens were written for and no product serves yet (search, profiles and
avatars, files sent in a message, new office documents, imports, among others: the list is
`src/products/unavailable.ts`); those screens are hidden. The release workflow is written, and runs
once the repository has Actions minutes.

## Prerequisites

- Node 24 and pnpm 11 (`corepack enable` picks the version in `package.json`).
- A GitHub token with the `read:packages` scope, for the `@ruchoir` packages (GitHub Packages asks
  for one even to read a public package): put `//npm.pkg.github.com/:_authToken=<token>` in your user
  `~/.npmrc`, never in the repository.
- Expo Go on a phone or an emulator.

## Running it

```sh
pnpm install
pnpm start
```

starts Metro in Expo Go mode (`expo start --go`, telemetry off). Open it in Expo Go and type an
instance's domain; `EXPO_PUBLIC_DEFAULT_SERVER` in an untracked `.env.local` names the one offered
first. On a physical iPhone, Expo Go opens a project only when the Expo CLI signs it: a free Expo
account signed in on the development machine (`npx expo login`) and in Expo Go, and
`EXPO_DEV_PROJECT_ID` in `.env.local`, never in the repository. That is the one exception to "no
hosted Expo service", for development only ([ADR 0001](docs/adr/0001-native-apps.md)).

What Expo Go cannot host (phone notifications, the widgets, the document scanner) needs the real
app, built from a version tag: [`docs/mobile-builds.md`](docs/mobile-builds.md). For an instance to
sign in to, see [getting started](https://github.com/Ruchoir/.github/blob/main/docs/getting-started.md).

## Testing it

```sh
pnpm typecheck
pnpm lint
pnpm test
CI=1 pnpm bundle:ios   # proves Metro resolves and bundles the app
```

`pnpm test` runs the pure logic under Node's own test runner (`test/`).

## Settings

In development, an untracked `.env.local` may hold `EXPO_PUBLIC_DEFAULT_SERVER` and
`EXPO_DEV_PROJECT_ID` (above). The release workflow gives `app.config.ts` the rest (the build number,
the Apple team, the Firebase file); its secrets and variables are listed in [`AGENTS.md`](AGENTS.md),
"Releasing".

## Documentation

- [`docs/mobile-builds.md`](docs/mobile-builds.md): how the iPhone and Android apps are built,
  signed, published and installed, and what to do when a build fails.
- [`docs/adr/`](docs/adr/README.md): the decisions of this repository.
- [`AGENTS.md`](AGENTS.md): how to work here, written for contributors and their tools. It opens
  with the common rules of the organization.
- The decisions that span several repositories:
  [Ruchoir/.github, `docs/adr`](https://github.com/Ruchoir/.github/tree/main/docs/adr).

## Contributing

Contributions are welcome. Read [`CONTRIBUTING.md`](https://github.com/Ruchoir/.github/blob/main/CONTRIBUTING.md):
your first pull request asks you to sign the [contributor licence agreement](https://github.com/Ruchoir/.github/blob/main/CLA.md).
Report a vulnerability privately, never in an issue: [`SECURITY.md`](https://github.com/Ruchoir/.github/blob/main/SECURITY.md).

## Licence

`AGPL-3.0-only` (`LICENSE`).
