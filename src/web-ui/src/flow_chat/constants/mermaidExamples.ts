/**
 * Mermaid interactive example data
 * Used to demonstrate the Mermaid dual-mode editor
 */
type DemoNodeCategory = 'entry' | 'process' | 'decision' | 'error' | 'exit';

interface DemoNode {
  id: string;
  line: number;
  label: string;
  description: string;
  tooltip: string;
  category: DemoNodeCategory;
}

type DemoNodeRow = [string, number, string, string, string, DemoNodeCategory];

const LOGIN_NODE_ROWS: DemoNodeRow[] = [
  ['A', 45, 'User login entry', 'Handle login request and capture username and request_id', 'Capture: username, request_id', 'entry'],
  ['B', 52, 'Validate username', 'Check username format and length', 'Validate: username length > 3', 'process'],
  ['C', 58, 'Username exists?', 'Query the database to check whether the username exists', 'DB query: SELECT * FROM users WHERE username = ?', 'decision'],
  ['D', 65, 'Validate password', 'Verify password hash with bcrypt', 'Password verification: bcrypt::verify(password, hash)', 'process'],
  ['E', 72, 'Return error', 'Username not found, return error message', 'Error: username not found', 'error'],
  ['F', 78, 'Password correct?', 'Check password verification result', 'Check password verification result', 'decision'],
  ['G', 85, 'Generate token', 'Generate access token with JWT', 'JWT generation: jwt::encode(payload, secret)', 'process'],
  ['H', 92, 'Password incorrect', 'Password verification failed, record attempt count', 'Error: incorrect password, attempts +1', 'error'],
  ['I', 98, 'Login success', 'Return success response and token', 'Success: return token and user info', 'exit'],
  ['J', 105, 'Record failure log', 'Write login failure log to file', 'Log: record failure reason and timestamp', 'process'],
];

const LOGIN_NODE_DATA: DemoNode[] = LOGIN_NODE_ROWS.map(([id, line, label, description, tooltip, category]) => ({
  id,
  line,
  label,
  description,
  tooltip,
  category,
}));

const nodeMetadata = Object.fromEntries(
  LOGIN_NODE_DATA.map(({ id, line, label, description, tooltip, category }, index) => [
    id,
    {
      file_path: 'src/auth/login.rs',
      line_number: line,
      label,
      description,
      tooltip,
      category,
      trace_id: `TRACE_LOGIN_${String(index + 1).padStart(3, '0')}`,
    },
  ]),
);

export const MERMAID_INTERACTIVE_EXAMPLE = {
  mermaid_code: `graph TD
    A[LOGIN_001<br/>User login entry] --> B[LOGIN_002<br/>Validate username]
    B --> C{LOGIN_003<br/>Username exists?}
    C -->|Yes| D[LOGIN_004<br/>Validate password]
    C -->|No| E[LOGIN_005<br/>Return error]
    D --> F{LOGIN_006<br/>Password correct?}
    F -->|Yes| G[LOGIN_007<br/>Generate token]
    F -->|No| H[LOGIN_008<br/>Password incorrect]
    G --> I[LOGIN_009<br/>Login success]
    E --> J[LOGIN_010<br/>Record failure log]
    H --> J
    
    %% Semantic styles - error nodes (red) and success node (green)
    style E fill:#fef2f2,stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 3,color:#b91c1c
    style H fill:#fef2f2,stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 3,color:#b91c1c
    style I fill:#f0fdf4,stroke:#16a34a,stroke-width:2px,color:#15803d`,
  title: 'Mermaid dual-mode demo - user login flow',
  session_id: `demo-${Date.now()}`,
  mode: 'interactive',
  allow_mode_switch: true,
  interactive_config: {
    node_metadata: nodeMetadata,
    highlights: {
      executed: ['A', 'B', 'C'],
      failed: ['E'],
      current: 'D',
      warnings: []
    },
    enable_navigation: true,
    enable_tooltips: true
  }
};

