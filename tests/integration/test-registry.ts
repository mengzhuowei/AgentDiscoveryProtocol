#!/usr/bin/env node

import http from 'http';

const REGISTRY_URL = 'http://localhost:3000';

async function request(
  method: string,
  path: string,
  body?: any
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, REGISTRY_URL);
    const options: http.RequestOptions = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : null;
          resolve({ status: res.statusCode || 0, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode || 0, data });
        }
      });
    });
    
    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function testRegistry() {
  console.log('Testing ADP Registry...');
  
  try {
    // 1. Health check
    console.log('\n1. Health check:');
    const health = await request('GET', '/health');
    console.log(`   Status: ${health.status}`);
    console.log(`   Response:`, health.data);
    
    if (health.status !== 200) {
      throw new Error('Registry not healthy');
    }
    
    // 2. Create test agent
    console.log('\n2. Register test agent:');
    const testAgentId = 'adp://test1234567890123456789012345678901234567890@test.namespace/test-agent';
    const registration = await request('POST', '/v1/agents', {
      agent_id: testAgentId,
      manifest: {
        protocol: 'adp/0.2',
        agent_id: testAgentId,
        display_name: 'Test Agent',
        capabilities: ['adp:ping', 'adp:capability.query', 'custom:test'],
        routes: [{ type: 'direct', address: 'localhost:9800' }],
        updated_at: new Date().toISOString()
      },
      routes: [{ type: 'direct', address: 'localhost:9800' }]
    });
    console.log(`   Status: ${registration.status}`);
    console.log(`   Response:`, registration.data);
    
    if (registration.status !== 201) {
      throw new Error('Registration failed');
    }
    
    // 3. Get agent
    console.log('\n3. Get agent:');
    const agent = await request('GET', `/v1/agents/${encodeURIComponent(testAgentId)}`);
    console.log(`   Status: ${agent.status}`);
    console.log(`   Response:`, agent.data);
    
    if (agent.status !== 200) {
      throw new Error('Get agent failed');
    }
    
    // 4. Search agents
    console.log('\n4. Search agents:');
    const search = await request('GET', '/v1/agents');
    console.log(`   Status: ${search.status}`);
    console.log(`   Found: ${search.data.agents.length} agents`);
    
    // 5. Search by capability
    console.log('\n5. Search by capability:');
    const searchCap = await request('GET', '/v1/agents?capability=custom%3Atest');
    console.log(`   Status: ${searchCap.status}`);
    console.log(`   Found: ${searchCap.data.agents.length} agents with custom:test`);
    
    // 6. Update agent
    console.log('\n6. Update agent:');
    const update = await request('PUT', `/v1/agents/${encodeURIComponent(testAgentId)}`, {
      agent_id: testAgentId,
      manifest: {
        protocol: 'adp/0.2',
        agent_id: testAgentId,
        display_name: 'Test Agent Updated',
        capabilities: ['adp:ping', 'adp:capability.query', 'custom:test', 'custom:new'],
        routes: [{ type: 'direct', address: 'localhost:9800' }],
        updated_at: new Date().toISOString()
      },
      routes: [{ type: 'direct', address: 'localhost:9800' }]
    });
    console.log(`   Status: ${update.status}`);
    console.log(`   Response:`, update.data);
    
    // 7. Delete agent
    console.log('\n7. Delete agent:');
    const del = await request('DELETE', `/v1/agents/${encodeURIComponent(testAgentId)}`);
    console.log(`   Status: ${del.status}`);
    console.log(`   Response:`, del.data);
    
    // 8. Verify deletion
    console.log('\n8. Verify deletion:');
    const verifyDel = await request('GET', `/v1/agents/${encodeURIComponent(testAgentId)}`);
    console.log(`   Status: ${verifyDel.status}`);
    if (verifyDel.status === 404) {
      console.log('   OK - Agent correctly deleted');
    }
    
    console.log('\n✅ All tests passed!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

testRegistry();

