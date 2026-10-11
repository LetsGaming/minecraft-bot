import { definePreset } from "@primevue/themes";
import Aura from "@primevue/themes/aura";

const ramp = (scale: "primary" | "surface", step: number) => `var(--ramp-${scale}-${step})`;

const PRIMARY_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const SURFACE_STEPS = [0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

/**
 * Neutral surfaces do the heavy lifting; the green marks only what is live or
 * actionable. Every value is a reference to a role in tokens.css.
 */
export const MinecraftPreset = definePreset(Aura, {
  semantic: {
    primary: Object.fromEntries(PRIMARY_STEPS.map((step) => [step, ramp("primary", step)])),
    focusRing: {
      width: "2px",
      style: "solid",
      color: "var(--focus)",
      offset: "2px",
    },
    colorScheme: {
      dark: {
        surface: Object.fromEntries(SURFACE_STEPS.map((step) => [step, ramp("surface", step)])),
        primary: {
          color: "var(--accent)",
          contrastColor: "var(--on-accent)",
          hoverColor: "var(--accent-hover)",
          activeColor: "var(--accent-strong)",
        },
        content: {
          background: "var(--surface-nav)",
          hoverBackground: "var(--surface)",
          borderColor: "var(--border)",
          color: "var(--text)",
          hoverColor: "var(--ramp-surface-0)",
        },
        text: {
          color: "var(--text)",
          hoverColor: "var(--ramp-surface-0)",
          mutedColor: "var(--text-dim)",
          hoverMutedColor: "var(--ramp-surface-200)",
        },
      },
    },
  },
  components: {
    button: {
      colorScheme: {
        dark: {
          // Aura draws secondary outlined and text buttons in {surface.400},
          // 3.2:1 on a card; the dim text role reads at 5.9:1.
          outlined: {
            secondary: { borderColor: "var(--border-strong)", color: "var(--text-dim)" },
          },
          text: {
            secondary: { color: "var(--text-dim)" },
          },
        },
      },
    },
    toggleswitch: {
      colorScheme: {
        dark: {
          root: {
            // Aura's dark off-state track is {surface.700}, the same value as the
            // hairline border here, so the track vanished and the handle read as a
            // bullet instead of a switch.
            background: "{surface.600}",
            hoverBackground: "{surface.500}",
            borderColor: "{surface.500}",
            hoverBorderColor: "{surface.400}",
            checkedBackground: "{primary.color}",
            checkedHoverBackground: "{primary.hover.color}",
          },
          handle: {
            background: "{surface.200}",
            hoverBackground: "{surface.100}",
          },
        },
      },
    },
  },
});
