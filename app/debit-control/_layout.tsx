import { PulseProductShell } from "@/features/product-shell/PulseProductShell";
import { routeStackScreenOptions } from "@/lib/routeStackOptions";
import { Stack } from "expo-router";

export default function DebitControlLayout() {
  return (
    <PulseProductShell productId="pod">
      <Stack screenOptions={routeStackScreenOptions} />
    </PulseProductShell>
  );
}
