import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { SignInScreen } from "../screens/auth/SignInScreen";
import { TutorialScreen } from "../screens/welcome/TutorialScreen";
import { WelcomeScreen } from "../screens/welcome/WelcomeScreen";
import { useSession } from "../session/SessionProvider";
import { useNavigationTheme } from "./navigationTheme";
import type { AuthParams } from "./types";

const Stack = createNativeStackNavigator<AuthParams>();

/**
 * Everything before signing in: the welcome and its tutorial, then the sign-in, which finds the
 * instance and hands over to its Propolis in the authentication browser (sign-up, the forgotten
 * password and the second factor are Propolis's pages there). A session that ended, or one adding
 * an instance from the app, starts at sign-in; anyone else at the welcome.
 */
export function AuthNavigator() {
  const theme = useNavigationTheme();
  const { state, cancel } = useSession();
  const toSignIn = (state.kind === "signedOut" && state.reason !== undefined) || cancel !== undefined;
  return (
    <NavigationContainer theme={theme}>
      <Stack.Navigator initialRouteName={toSignIn ? "signIn" : "welcome"} screenOptions={{ headerShown: false }}>
        <Stack.Screen name="welcome" component={WelcomeScreen} />
        <Stack.Screen name="tutorial" component={TutorialScreen} />
        <Stack.Screen name="signIn" component={SignInScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
