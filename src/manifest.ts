export interface Capability {
  capability: string;
  description?: string;
  input_modes?: string[];
  output_modes?: string[];
  input_schema?: unknown;
  output_schema?: unknown;
  
  async?: boolean;
  preferredMode?: 'websocket' | 'webhook';
}

export interface Route {
  type: 'direct' | 'relay';
  address?: string;
  relay?: string;
  session_id?: string;
}

export interface AgentInfo {
  platform?: string;
  runtime?: string;
  heartbeat_interval?: number;
}

export interface Manifest {
  protocol: string;
  agent_id: string;
  display_name: string;
  description?: string;
  capabilities: (string | Capability)[];
  routes: Route[];
  agent_info?: AgentInfo;
  updated_at: string;
}

export function createManifest(
  agentId: string,
  displayName: string,
  capabilities: (string | Capability)[],
  routes: Route[],
  options?: {
    description?: string;
    agentInfo?: AgentInfo;
  }
): Manifest {
  return {
    protocol: 'adp/0.2',
    agent_id: agentId,
    display_name: displayName,
    description: options?.description,
    capabilities,
    routes,
    agent_info: options?.agentInfo,
    updated_at: new Date().toISOString(),
  };
}

export function hasCapability(manifest: Manifest, capability: string): boolean {
  return manifest.capabilities.some(
    (cap) => typeof cap === 'string' ? cap === capability : cap.capability === capability
  );
}

export function getCapability(manifest: Manifest, capability: string): Capability | undefined {
  return manifest.capabilities.find(
    (cap): cap is Capability => typeof cap !== 'string' && cap.capability === capability
  );
}
