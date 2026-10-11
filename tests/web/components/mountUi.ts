import type { App } from "vue";
import PrimeVue from "primevue/config";
import ConfirmationService from "primevue/confirmationservice";
import ToastService from "primevue/toastservice";
import Tooltip from "primevue/tooltip";

/** The app-level installs main.ts makes, without the theme. */
export const uiGlobal = {
  plugins: [
    [PrimeVue, { theme: "none" }],
    ConfirmationService,
    ToastService,
    {
      install(app: App) {
        app.directive("tooltip", Tooltip);
      },
    },
  ] as never[],
  // Real transitions, so PrimeVue's dialog runs its focus hooks.
  stubs: { transition: false },
};

/** Let PrimeVue's dialog finish its enter or leave hooks. */
export async function settle(ms = 30): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
