import { TrueForgeUI } from '@truefoundry/trueforge-ui';
import { theme } from './theme';
import { CheckLane } from './slots/CheckLane';
import { GateApprovalBar } from './slots/GateApprovalBar';

const baseUrl = import.meta.env.VITE_TRUEFORGE_BASE_URL ?? '';

/**
 * Release Guardian console — the TrueForge UI SDK pinned to the release-guardian
 * agent, with a brand theme and two slot overrides:
 *   - CheckLane        — the three parallel checks as labelled status lanes
 *   - GateApprovalBar  — an unmistakable banner on each of the two approval gates
 * The streaming, session history, MCP-OAuth popups and approval round-trip are the
 * SDK's; we only reshape what the operator sees.
 */
export default function App() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          padding: '10px 16px',
          background: '#0f172a',
          color: '#f1f5f9',
        }}
      >
        <strong style={{ fontSize: 15, letterSpacing: 0.2 }}>Release Guardian</strong>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>
          decides whether a release is safe to ship — every check read or executed, both
          irreversible steps gated
        </span>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <TrueForgeUI
          server={{ type: 'trueforge', baseUrl }}
          layout="sidebar"
          agentConfig={{ mode: 'SingleAgent', name: 'release-guardian' }}
          theme={theme}
          overrides={{ SubAgentCard: CheckLane, ToolApprovalBar: GateApprovalBar }}
        />
      </div>
    </div>
  );
}
