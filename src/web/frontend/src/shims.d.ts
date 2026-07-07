// PrimeVue attaches $toast and $confirm to the component instance via its
// services (ToastService / ConfirmationService, registered in main.ts).
// Declare them so the Options-API `this.$toast` / `this.$confirm` calls
// typecheck under vue-tsc.
import type { ToastServiceMethods } from "primevue/toastservice";
import type { ConfirmationServiceMethods } from "primevue/confirmationservice";

declare module "vue" {
  interface ComponentCustomProperties {
    $toast: ToastServiceMethods;
    $confirm: ConfirmationServiceMethods;
  }
}

export {};
