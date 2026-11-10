import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";

import { DEFAULT_SERVER } from "../../config";
import { useTranslation } from "../../i18n";
import { FAILURE_TEXT } from "../../session/failureText";
import { AuthFailure, useSession } from "../../session/SessionProvider";
import { styleCache } from "../../theme/themedStyles";
import { useTheme, useThemedStyles } from "../../theme/useTheme";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Screen } from "../../ui/Screen";
import { Text } from "../../ui/Text";
import { AuthTop } from "./AuthTop";
import { hostOf, ServerField } from "./ServerField";

/**
 * Sign-in: the instance's address, then its Propolis in the authentication browser, where the
 * person signs in (or creates an account, or recovers a password) and comes back signed in
 * (RFC 8252, `products/auth.ts`). The address is changed in place; with none chosen yet, its field
 * is open from the start.
 */
export function SignInScreen() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const session = useSession();
  const server = "server" in session.state ? session.state.server : null;
  const reason = session.state.kind === "signedOut" ? session.state.reason : undefined;

  const [editing, setEditing] = useState(server === null);
  // Adding another instance from the app: the default one is most likely there already.
  const offered = session.cancel ? null : DEFAULT_SERVER;
  const [serverDraft, setServerDraft] = useState(server ? hostOf(server) : offered ? hostOf(offered) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthFailure | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editing || !server) {
        await session.chooseServer(serverDraft);
        setEditing(false);
      }
      await session.signIn();
    } catch (err) {
      setError(err instanceof AuthFailure ? err : new AuthFailure("unknown"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <AuthTop />
      <View style={styles.head}>
        <View style={[styles.markTile, { borderColor: c.lineStrong }]}>
          <Image source={require("../../../assets/mark.png")} style={[styles.mark, { tintColor: c.brand }]} />
        </View>
        <Text variant="display">{t("signIn.submit")}</Text>
      </View>

      {reason === "expired" && !error ? <Banner tone="danger" text={t("signIn.expired")} /> : null}
      {reason === "locked" && !error ? <Banner tone="danger" text={t("signIn.locked")} /> : null}

      <ServerField server={server} editing={editing} draft={serverDraft} onDraft={setServerDraft} onEdit={() => setEditing(true)} />

      {error ? <Banner tone="danger" text={t(FAILURE_TEXT[error.code])} /> : null}

      <Button label={t("signIn.submit")} onPress={() => void submit()} busy={busy} disabled={!server && !serverDraft.trim()} />
    </Screen>
  );
}

const makeStyles = styleCache((shape) =>
  StyleSheet.create({
    head: { gap: 14, paddingTop: 12 },
    markTile: {
      width: 56,
      height: 56,
      borderRadius: shape.radius.l,
      borderWidth: shape.hairline,
      backgroundColor: "#f7f3ed",
      alignItems: "center",
      justifyContent: "center",
    },
    mark: { width: 34, height: 34, marginTop: 4 },
  }),
);
