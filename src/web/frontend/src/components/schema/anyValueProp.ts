import type { PropType } from "vue";

/**
 * The `modelValue` prop of a schema-driven field: any JSON value, null included.
 * Vue's `type: null` skips the runtime check; the cast gives it the type a
 * `PropType` needs, in one place instead of in every field component.
 */
export const anyValueProp = {
  type: null as unknown as PropType<unknown>,
  required: false,
} as const;
