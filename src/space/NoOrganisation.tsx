/**
 * An account in no organisation: creating one or joining one with an invitation are Propolis's,
 * so the button opens its page in the authentication browser; coming back, the list is read again.
 */
import { Users } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useApi } from "../api/useApi";
import { useTranslation } from "../i18n";
import { openPropolisPage } from "../products/auth.ts";
import { useTheme } from "../theme/useTheme";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/States";
import { useSpace } from "./SpaceProvider";

export function NoOrganisation() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const { issuer } = useApi().instance;
  const { spaces } = useSpace();
  const open = async () => {
    await openPropolisPage(issuer, "/account").catch(() => {});
    spaces.reload();
  };
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]}>
      <View style={styles.body}>
        <EmptyState icon={Users} title={t("joinSpace.title")} text={t("joinSpace.subtitle")} />
        <Button label={t("joinSpace.modalTitle")} onPress={() => void open()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { flex: 1, justifyContent: "center", paddingHorizontal: 24, gap: 16 },
});
