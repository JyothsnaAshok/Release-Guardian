/**
 * No theme overrides — the TrueForge preset's dark/light system is left entirely
 * alone. The only Release Guardian colour is the verdict palette below, used by
 * the two slot overrides for check status. Amber doubles as the brand hue and as
 * "attention / conditional", which is the state the operator most needs to see.
 */
export const verdict = {
  ok: '#3f9142',
  warn: '#c2410c',
  bad: '#c0392b',
  unknown: '#6b7280',
} as const;
