import { createApp } from "vue";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import ConfirmationService from "primevue/confirmationservice";
import Tooltip from "primevue/tooltip";
import App from "./App.vue";
import SchemaField from "./components/schema/SchemaField.vue";
import "primeicons/primeicons.css";
import { MinecraftPreset } from "./preset";
import { installStatusTokens } from "./statusTokens";
import { initDensity } from "./composables/useDensity";
import "./tokens.css";
import "./style.css";

installStatusTokens();
initDensity();

const app = createApp(App);
app.use(PrimeVue, {
  theme: {
    preset: MinecraftPreset,
    options: {
      darkModeSelector: ".dark",
      cssLayer: {
        name: "primevue",
        order: "theme, base, primevue",
      },
    },
  },
});
app.use(ToastService);
app.use(ConfirmationService);
app.directive("tooltip", Tooltip);
// Registered globally so the recursive field renderers (MapField / ArrayField)
// can use <SchemaField> without importing it (which would create an import
// cycle). See shims.d.ts for the matching type declaration.
app.component("SchemaField", SchemaField);
app.mount("#app");
