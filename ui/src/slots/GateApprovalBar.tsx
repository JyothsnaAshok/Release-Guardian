import { ToolApprovalBar, type ToolApprovalBarProps } from '@truefoundry/trueforge-ui';
import { verdict } from '../theme';

/**
 * ToolApprovalBar override. The SDK's Allow/Deny bar still does the work — this
 * frames the two gates that matter so the operator sees *which* irreversible
 * action they are signing off, before it runs. Every other tool passes straight
 * through untouched.
 */
const GATES: Record<string, { eyebrow: string; line: string; tone: string }> = {
  commit_release_decision: {
    eyebrow: 'Gate 1 · Release decision',
    line: 'Approving records the go / no-go. A wrong call puts real risk on production.',
    tone: verdict.bad,
  },
  handoff_comms: {
    eyebrow: 'Gate 2 · Release comms',
    line: 'Approving hands the Slack summary and the stakeholder email off to send. An org-wide message cannot be unsent.',
    tone: verdict.warn,
  },
};

function gateFor(toolName: string) {
  for (const key of Object.keys(GATES)) if (toolName.includes(key)) return GATES[key];
  return null;
}

export function GateApprovalBar(props: ToolApprovalBarProps) {
  const gate = gateFor(props.toolName);
  if (!gate) return <ToolApprovalBar {...props} />;

  return (
    <div
      style={{
        border: `1px solid var(--border)`,
        borderTop: `2px solid ${gate.tone}`,
        borderRadius: 'var(--radius, 6px)',
        background: 'var(--card-bg)',
        margin: '8px 0',
        padding: '11px 13px',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: gate.tone,
        }}
      >
        {gate.eyebrow}
      </div>
      <p style={{ margin: '5px 0 10px', fontSize: 13, lineHeight: 1.45, color: 'var(--text-secondary)' }}>
        {gate.line}
      </p>
      <ToolApprovalBar {...props} />
    </div>
  );
}
