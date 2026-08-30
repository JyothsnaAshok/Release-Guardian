import { ToolApprovalBar, type ToolApprovalBarProps } from '@truefoundry/trueforge-ui';
import { verdict } from '../theme';

/**
 * ToolApprovalBar override. The generic Allow/Deny bar still does the work — this
 * wraps it in an unmistakable banner for the two gates that matter, so the human
 * sees *which* irreversible action they are approving, before it runs.
 */
const GATES: Record<string, { title: string; blurb: string; tone: string }> = {
  commit_release_decision: {
    title: 'Release decision — approval required',
    blurb: 'Approving proceeds with the go / no-go for this release. A wrong call is not easily undone.',
    tone: verdict.bad,
  },
  handoff_comms: {
    title: 'Release comms — approval required',
    blurb: 'Approving hands both the Slack summary and the stakeholder email off to be sent. An org-wide message cannot be unsent.',
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
        border: `1px solid ${gate.tone}`,
        borderRadius: 10,
        overflow: 'hidden',
        margin: '10px 0',
      }}
    >
      <div style={{ background: gate.tone, color: '#fff', padding: '8px 12px', fontSize: 13, fontWeight: 600 }}>
        {gate.title}
      </div>
      <div style={{ padding: '10px 12px', background: 'var(--aui-card-bg, #fff)' }}>
        <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--aui-text-secondary, #475569)' }}>
          {gate.blurb}
        </p>
        <ToolApprovalBar {...props} />
      </div>
    </div>
  );
}
