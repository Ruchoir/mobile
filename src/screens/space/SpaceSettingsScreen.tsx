/**
 * The current organisation's settings. Its members, roles, groups, journal and licence are
 * Propolis's (decision 5 of the restructuring plan): each row opens Propolis's page in the
 * authentication browser, where the person's Propolis session lives.
 */
import { ChevronRight, FileText, KeyRound, type LucideIcon, Shield, SlidersHorizontal, UserRound, Users } from "lucide-react-native";
import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useApi } from "../../api/useApi";
import { useTranslation } from "../../i18n";
import { openPropolisPage } from "../../products/auth.ts";
import { useSpace } from "../../space/SpaceProvider";
import { styleCache } from "../../theme/themedStyles";
import { useTheme, useThemedStyles } from "../../theme/useTheme";
import { ActionRow } from "../../ui/ActionRow";
import { BackHeader } from "../../ui/BackHeader";

type Section = "general" | "members" | "roles" | "groups" | "audit" | "licence";

const SECTIONS: { key: Section; title: string; icon: LucideIcon }[] = [
  { key: "general", title: "spaceAdmin.general", icon: SlidersHorizontal },
  { key: "members", title: "details.members", icon: UserRound },
  { key: "roles", title: "spaceSections.roles", icon: Shield },
  { key: "groups", title: "spaceSections.groups", icon: Users },
  { key: "audit", title: "spaceSections.audit", icon: FileText },
  { key: "licence", title: "spaceSections.licence", icon: KeyRound },
];

export function SpaceSettingsScreen() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { instance } = useApi();
  const { current } = useSpace();
  const tint: Record<Section, string> = { general: c.sky, members: c.mint, roles: c.violet, groups: c.pink, audit: c.sun, licence: c.lime };
  // Propolis has no page per organisation section yet: its account page is where they will be.
  const open = () => void openPropolisPage(instance.issuer, "/account");

  return (
    <SafeAreaView edges={["top"]} style={[styles.fill, { backgroundColor: c.bg }]}>
      <BackHeader title={t("spaceAdmin.settings")} subtitle={current?.name} />
      <ScrollView contentContainerStyle={styles.page}>
        {SECTIONS.map((section) => (
          <ActionRow
            key={section.key}
            icon={section.icon}
            tint={tint[section.key]}
            title={t(section.title as never)}
            onPress={open}
            trailing={<ChevronRight size={18} color={c.muted} />}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = styleCache(() =>
  StyleSheet.create({
    fill: { flex: 1 },
    page: { paddingHorizontal: 16, paddingBottom: 32 },
  }),
);
