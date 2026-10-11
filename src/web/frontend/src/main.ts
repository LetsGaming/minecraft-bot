import { createApp } from "vue";
import { createWebHashHistory } from "vue-router";
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
import { discardPrompt } from "./composables/useDiscardPrompt";
import { createAppRouter } from "./router";
import { t } from "./i18n";
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

const confirm = app.config.globalProperties.$confirm;
app.use(
  createAppRouter(createWebHashHistory(), (reason) =>
    discardPrompt(confirm, t(reason === "server" ? "leave.messageServer" : "leave.message"))(),
  ),
);
app.mount("#app");
