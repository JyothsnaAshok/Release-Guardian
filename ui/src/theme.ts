import type { ComponentProps } from 'react';
import type { TrueForgeUI } from '@truefoundry/trueforge-ui';

type ThemeConfig = NonNullable<ComponentProps<typeof TrueForgeUI>['theme']>;

/**
 * The TrueForge preset is already a well-resolved dark/light system, so we leave
 * the chrome alone and spend the brand budget in exactly two places: the top bar
 * (App.tsx) and the two slot overrides. The only token we touch is the primary
 * action colour, so an Approve button reads as a Release Guardian control.
 */
export const theme: ThemeConfig = {
  preset: 'trueforge',
  tokens: {
    primaryButtonBg: '#c2410c',
    primaryButtonHover: '#9a3412',
    primaryButtonText: '#fff7ed',
    focusRing: '#c2410c',
  },
};

/**
 * Verdict palette — the one place check-status colour is defined. Amber is the
 * brand hue and also means "attention / conditional", which is deliberate: a
 * conditional-go is the state the operator most needs to look at.
 */
export const verdict = {
  ok: '#3f9142',
  warn: '#c2410c',
  bad: '#c0392b',
  unknown: '#6b7280',
} as const;
