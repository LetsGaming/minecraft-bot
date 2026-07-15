import { createApp } from "vue";
import PrimeVue from "primevue/config";
import { definePreset } from "@primevue/themes";
import Aura from "@primevue/themes/aura";
import ToastService from "primevue/toastservice";
import ConfirmationService from "primevue/confirmationservice";
import Tooltip from "primevue/tooltip";
import App from "./App.vue";
import SchemaField from "./components/schema/SchemaField.vue";
import "primeicons/primeicons.css";
import "./style.css";

// ── Refined Minecraft dark theme ──
// Slate's disciplined structure + Signal's modern selection cues (border
// accent + gradient fade, no neon) + Soft's botanical green translated
// into dark mode. Neutral surfaces do the heavy lifting; the green marks
// only what's live or actionable.
const MinecraftPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: "#eafaf0",
      100: "#c9f0d8",
      200: "#9ce3b6",
      300: "#6fdb98",
      400: "#5cc985",
      500: "#34c56a", // botanical green — selection / live
      600: "#2f9d57", // primary buttons
      700: "#268049",
      800: "#1f6339",
      900: "#17472a",
      950: "#0c2617",
    },
    colorScheme: {
      dark: {
        surface: {
          0: "#ffffff",
          50: "#f5f6f7",
          100: "#e1e3e6",
          200: "#c4c8cd",
          300: "#8a9099",
          400: "#6b7280",
          500: "#4a4f57",
          600: "#333842", // strong borders
          700: "#24272c", // hairline borders
          800: "#191b1f", // cards / panels
          900: "#15171a", // app background
          950: "#101114",
        },
        primary: {
          color: "#34c56a",
          contrastColor: "#eafff0",
          hoverColor: "#5cc985",
          activeColor: "#2f9d57",
        },
        content: {
          background: "#191b1f",
          hoverBackground: "#22252a",
          borderColor: "#24272c",
          color: "#e7e9ec",
          hoverColor: "#ffffff",
        },
        text: {
          color: "#e7e9ec",
          hoverColor: "#ffffff",
          mutedColor: "#8a9099",
          hoverMutedColor: "#c4c8cd",
        },
      },
    },
  },
});

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
