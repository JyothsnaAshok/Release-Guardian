import type { ComponentProps } from 'react';
import type { TrueForgeUI } from '@truefoundry/trueforge-ui';

type ThemeConfig = NonNullable<ComponentProps<typeof TrueForgeUI>['theme']>;

/**
 * Release Guardian brand theme. `SemanticTokens` is a flat set applied over the
 * chosen preset, so we override only the brand-critical surfaces (slate chrome,
 * amber primary action) and let the preset carry the rest, including dark mode.
 * Verdict colours (green / amber / red) are reserved for the check statuses and
 * live in `verdict` below, not in the chat tokens.
 */
export const theme: ThemeConfig = {
  preset: 'trueforge',
  tokens: {
    sidebarBg: '#0f172a',
    topbarBg: '#0f172a',
    primaryButtonBg: '#b45309',
    primaryButtonHover: '#92400e',
    primaryButtonText: '#ffffff',
    focusRing: '#b45309',
    fontFamily:
      'ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
};

/** Verdict colours — the one place check status colour is defined. */
export const verdict = {
  ok: '#15803d',
  warn: '#b45309',
  bad: '#b91c1c',
  unknown: '#64748b',
} as const;
