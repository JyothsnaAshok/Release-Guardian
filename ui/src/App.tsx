import { TrueForgeUI } from '@truefoundry/trueforge-ui';
import { theme } from './theme';
import { CheckLane } from './slots/CheckLane';
import { GateApprovalBar } from './slots/GateApprovalBar';
import { SubmitPrompt } from './slots/SubmitPrompt';
import './app.css';

const baseUrl = import.meta.env.VITE_TRUEFORGE_BASE_URL ?? '';

/**
 * Release Guardian console — the TrueForge UI SDK pinned to the release-guardian
 * agent. The SDK's chrome, streaming, history, approval round-trip and MCP-OAuth
 * popups are left as-is; the identity is one top bar and two slot overrides:
 *   CheckLane        — each check as a status lane (the parallel-fan-out view)
 *   GateApprovalBar  — a banner naming the irreversible action at each gate
 */
export default function App() {
  return (
    <div className="rg-app">
      <header className="rg-bar">
        <span className="rg-mark" aria-hidden="true">
          <svg width="15" height="17" viewBox="0 0 15 17" fill="none">
            <path
              d="M7.5 1 1 3.4v4.3c0 4 2.8 6.7 6.5 8 3.7-1.3 6.5-4 6.5-8V3.4L7.5 1Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path d="M4.7 8.6 6.8 10.8 10.5 6.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="rg-word">Release&nbsp;Guardian</span>
        <span className="rg-sep" aria-hidden="true" />
        <span className="rg-tag">Ship or don&rsquo;t — every check read or executed, both gates held</span>
      </header>

      <div className="rg-body">
        <TrueForgeUI
          server={{ type: 'trueforge', baseUrl }}
          layout="sidebar"
          agentConfig={{ mode: 'SingleAgent', name: 'release-guardian' }}
          theme={theme}
          overrides={{
            SubAgentCard: CheckLane,
            ToolApprovalBar: GateApprovalBar,
            WelcomeScreen: SubmitPrompt,
          }}
        />
      </div>
    </div>
  );
}
