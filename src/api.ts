import { logger } from './utils/logger';
import type { Demand } from './types';

/* ------------------------------
 * API Types
 * ------------------------------ */

type JsonList<T> = { items: T[] };

/* ------------------------------
 * Config
 * ------------------------------ */
// Pick the base URL from env (production) or fall back to dev proxy.
const RAW_BASE = import.meta.env.VITE_API_BASE ?? '/api';
// Ensure no trailing slash
const BASE = RAW_BASE.replace(/\/+$/, '');
//const BASE = "/api"; // vite proxy to ORDS base

// ORDS typically uses database user authentication
// For development, you may need to configure ORDS to allow anonymous access
// or set up proper authentication credentials
// const ORDS_AUTH = {
//   // Uncomment and configure if your ORDS requires authentication
//   // username: 'your_db_user',
//   // password: 'your_db_password'
// };

/* ------------------------------
 * Utilities
 * ------------------------------ */
export function toUtcMidnight(dateLike?: string | null): string | undefined {
  if (!dateLike) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateLike)) {
    return `${dateLike}T00:00:00Z`;
  }
  return dateLike;
}

function looksLikeHtml(s: string) {
  const t = s.trim().toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html");
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const fullUrl = `${BASE}${path}`;
  const method = init?.method?.toUpperCase() || "GET";
  const isGet = method === "GET";

  logger.debug("API Request:", {
    method,
    url: fullUrl,
    headers: init?.headers,
    // body intentionally omitted
  });

  const res = await fetch(fullUrl, {
    // 👇 Keep this only if you really need cookies/session from ORDS
    // credentials: "include",
    headers: {
      Accept: "application/json",
      // 👇 Only set Content-Type when not GET
      ...(isGet ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers || {}),
    },
    ...init,
  });

  logger.debug("API Response:", {
    status: res.status,
    statusText: res.statusText,
    url: res.url,
  });

  if (res.ok) {
    if (res.status === 204) return undefined as unknown as T;
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  const errText = await res.text();
  logger.error("HTTP Error:", {
    status: res.status,
  });

  if (looksLikeHtml(errText)) {
    const snippet = errText
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
    throw new Error(
      `HTTP ${res.status}: Server returned HTML instead of JSON. This usually means:\n1. Authentication required\n2. CORS/proxy issue\n3. Wrong endpoint URL\n4. Server error page\n\nSnippet: ${snippet}`
    );
  }

  try {
    const j = JSON.parse(errText);
    const msg = j?.message || j?.error || errText;
    throw new Error(`HTTP ${res.status}: ${msg}`);
  } catch {
    throw new Error(`HTTP ${res.status}: ${errText.substring(0, 500)}`);
  }
}


/* ------------------------------
 * Debug/Test Functions
 * ------------------------------ */

// Add this function to test basic connectivity and discover available endpoints
export async function testApiConnection(): Promise<{success: boolean, message: string}> {
  try {
    console.log('Testing API connection and discovering endpoints...');
    
    const testEndpoints = [
      '',           // Root - ORDS should show available services
      'demands/',   // Our target endpoint
      'demand/',    // Alternative singular form
      'DEMANDS/',   // Uppercase (ORDS is case-sensitive)
      'DEMAND/',    // Uppercase singular
    ];
    
    const results: string[] = [];
    
    for (const endpoint of testEndpoints) {
      const testUrl = `${BASE}/${endpoint}`;
      try {
        const response = await fetch(testUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          }
        });
        
        const text = await response.text();
        console.log(`Testing ${endpoint || 'root'}:`, {
          status: response.status,
          url: response.url,
          preview: text.substring(0, 100)
        });
        
        if (response.status === 200) {
          results.push(`✅ ${endpoint || 'root'}: SUCCESS`);
          if (endpoint === 'demands/' || endpoint === 'DEMANDS/') {
            return {
              success: true,
              message: `Found working endpoint: ${endpoint}\nFull URL: ${response.url}`
            };
          }
        } else if (response.status === 404) {
          results.push(`❌ ${endpoint || 'root'}: Not Found (404)`);
        } else if (response.status === 405) {
          results.push(`⚠️  ${endpoint || 'root'}: Method Not Allowed (405) - endpoint exists but needs POST`);
        } else {
          results.push(`❓ ${endpoint || 'root'}: Status ${response.status}`);
        }
        
      } catch (error) {
        results.push(`💥 ${endpoint || 'root'}: ${error}`);
      }
    }
    
    return {
      success: false,
      message: `Endpoint discovery results:\n${results.join('\n')}\n\nTry checking your ORDS REST services configuration.`
    };
    
  } catch (error) {
    console.error('Connection test failed:', error);
    return {
      success: false,
      message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Function to check what REST services are available
export async function discoverOrdsServices(): Promise<{success: boolean, services: string[], message: string}> {
  try {
    console.log('Discovering available ORDS services...');
    
    // Try the root endpoint to see available services
    const response = await fetch(`${BASE}/`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    const text = await response.text();
    console.log('ORDS root response:', {
      status: response.status,
      text: text.substring(0, 500)
    });
    
    if (response.ok) {
      try {
        const json = JSON.parse(text);
        const services = json.items || json.services || [];
        return {
          success: true,
          services: services.map((s: any) => s.name || s.uri || s),
          message: `Found ${services.length} services`
        };
      } catch {
        return {
          success: false,
          services: [],
          message: 'Root endpoint accessible but returned non-JSON response'
        };
      }
    } else {
      return {
        success: false,
        services: [],
        message: `Root endpoint returned status ${response.status}`
      };
    }
    
  } catch (error) {
    return {
      success: false,
      services: [],
      message: `Failed to discover services: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Test function to try a minimal POST request
export async function testCreateDemand(): Promise<{success: boolean, message: string}> {
  try {
    console.log('Testing minimal demand creation...');
    
    const minimalPayload = {
      title: "Test Demand " + new Date().toISOString(),
      type: "Strategic",
      priority: "LOW",
      status: "Draft",
      description: "Test demand creation"
    };

    console.log('Testing with minimal payload:', minimalPayload);

    const response = await fetch(`${BASE}/demands/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-DB-DEFAULTS': 'true'
      },
      body: JSON.stringify(minimalPayload)
    });

    const text = await response.text();
    console.log('Test create response:', {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: text.substring(0, 500)
    });

    if (response.ok) {
      return {
        success: true,
        message: `✅ POST works! Status: ${response.status}\n\nResponse: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`
      };
    } else {
      return {
        success: false,
        message: `❌ POST failed with status ${response.status}\n\nError: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`
      };
    }

  } catch (error) {
    console.error('Test create demand failed:', error);
    return {
      success: false,
      message: `💥 Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Test function to try updating an existing demand
export async function testUpdateDemand(demandId?: string): Promise<{success: boolean, message: string}> {
  try {
    console.log('Testing demand update...');
    
    // First, try to get an existing demand ID if not provided
    if (!demandId) {
      const demands = await listDemands(1);
      if (demands.length === 0) {
        return {
          success: false,
          message: '❌ No existing demands found to test update. Create a demand first.'
        };
      }
      demandId = demands[0].id;
    }

    console.log('Testing update on demand ID:', demandId);

    const updatePayload = {
      description: "Updated description " + new Date().toISOString(),
      last_modified_by: "Test User"
    };

    console.log('Testing with update payload:', updatePayload);

    const response = await fetch(`${BASE}/demands/${encodeURIComponent(demandId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(updatePayload)
    });

    const text = await response.text();
    console.log('Test update response:', {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: text.substring(0, 500)
    });

    if (response.ok) {
      return {
        success: true,
        message: `✅ PUT works! Status: ${response.status}\n\nResponse: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`
      };
    } else {
      return {
        success: false,
        message: `❌ PUT failed with status ${response.status}\n\nError: ${text.substring(0, 300)}${text.length > 300 ? '...' : ''}`
      };
    }

  } catch (error) {
    console.error('Test update demand failed:', error);
    return {
      success: false,
      message: `💥 Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Test different PUT payloads to isolate the SQL constraint issue
export async function diagnosePutError(demandId?: string): Promise<{success: boolean, message: string}> {
  try {
    console.log('=== DIAGNOSING PUT ERROR ===');
    
    // First, get an existing demand
    if (!demandId) {
      const demands = await listDemands(1);
      if (demands.length === 0) {
        return {
          success: false,
          message: '❌ No existing demands found. Create a demand first.'
        };
      }
      demandId = demands[0].id;
    }

    console.log('Using demand ID:', demandId);

    // Test various payloads to isolate the issue
    const testPayloads = [
      { test: 'Empty object', payload: {} },
      { test: 'Only description', payload: { description: 'Test update' } },
      { test: 'Only status', payload: { status: 'Draft' } },
      { test: 'Only stage', payload: { current_stage: 'Intake' } },
      { test: 'Status + Stage', payload: { status: 'Under Review', current_stage: 'Screening' } },
      { test: 'With last_modified', payload: { description: 'Test', last_modified_by: 'Test User' } },
      { test: 'With timestamps', payload: { last_modified_date: new Date().toISOString() } },
    ];

    const results: string[] = [];
    let successCount = 0;

    for (const { test, payload } of testPayloads) {
      try {
        console.log(`\nTesting: ${test}`, payload);
        
        const response = await fetch(`${BASE}/demands/${encodeURIComponent(demandId)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const text = await response.text();
        
        if (response.ok) {
          results.push(`✅ ${test}: SUCCESS`);
          successCount++;
        } else {
          const shortError = text.length > 100 ? text.substring(0, 100) + '...' : text;
          results.push(`❌ ${test}: ${response.status} - ${shortError}`);
        }
        
        console.log(`Result: ${response.status}`, text.substring(0, 200));
        
      } catch (error) {
        results.push(`💥 ${test}: ${error}`);
      }
    }

    return {
      success: successCount > 0,
      message: `PUT Diagnostic Results (${successCount}/${testPayloads.length} succeeded):\n\n${results.join('\n')}\n\nCheck console for detailed logs.`
    };

  } catch (error) {
    return {
      success: false,
      message: `Diagnosis failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Function to check if ORDS resource has proper UPDATE configuration
export async function checkOrdsUpdateCapability(): Promise<{success: boolean, message: string}> {
  try {
    console.log('Checking ORDS UPDATE capability...');
    
    // Try to get resource metadata
    const response = await fetch(`${BASE}/demands/`, {
      method: 'OPTIONS',
      headers: {
        'Accept': 'application/json'
      }
    });

    console.log('OPTIONS response:', {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries())
    });

    const allowedMethods = response.headers.get('Allow') || response.headers.get('allow') || '';
    const text = await response.text();

    return {
      success: response.ok,
      message: `ORDS Resource Info:\n\nAllowed Methods: ${allowedMethods || 'Not specified'}\nStatus: ${response.status}\n\nResponse: ${text.substring(0, 300)}${text.length > 300 ? '...' : ''}`
    };

  } catch (error) {
    return {
      success: false,
      message: `Failed to check ORDS capabilities: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Test alternative HTTP methods for updates
export async function testAlternativeUpdateMethods(demandId?: string): Promise<{success: boolean, message: string}> {
  try {
    console.log('=== TESTING ALTERNATIVE UPDATE METHODS ===');
    
    // Get an existing demand
    if (!demandId) {
      const demands = await listDemands(1);
      if (demands.length === 0) {
        return {
          success: false,
          message: '❌ No existing demands found. Create a demand first.'
        };
      }
      demandId = demands[0].id;
    }

    const testPayload = { description: 'Test update via alternative method' };
    const methods = ['PATCH', 'POST', 'PUT'];
    const results: string[] = [];
    let successCount = 0;

    for (const method of methods) {
      try {
        console.log(`\nTesting ${method} method...`);
        
        // Try both individual resource URL and collection URL with ID
        const urls = [
          `${BASE}/demands/${encodeURIComponent(demandId)}`,
          `${BASE}/demands/`,
        ];
        
        for (const url of urls) {
          const payload = method === 'POST' && url.endsWith('/') 
            ? { ...testPayload, id: demandId } // Include ID in body for POST to collection
            : testPayload;
            
          try {
            const response = await fetch(url, {
              method,
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              body: JSON.stringify(payload)
            });

            const text = await response.text();
            const urlType = url.endsWith('/') ? 'collection' : 'item';
            
            if (response.ok) {
              results.push(`✅ ${method} to ${urlType}: SUCCESS (${response.status})`);
              successCount++;
              console.log(`SUCCESS: ${method} ${urlType}`, response.status);
            } else {
              const shortError = text.substring(0, 50) + (text.length > 50 ? '...' : '');
              results.push(`❌ ${method} to ${urlType}: ${response.status} - ${shortError}`);
              console.log(`FAILED: ${method} ${urlType}`, response.status, text.substring(0, 100));
            }
          } catch (error) {
            const urlType = url.endsWith('/') ? 'collection' : 'item';
            results.push(`💥 ${method} to ${urlType}: ${error}`);
          }
        }
        
      } catch (error) {
        results.push(`💥 ${method}: ${error}`);
      }
    }

    return {
      success: successCount > 0,
      message: `Alternative Method Test Results (${successCount} succeeded):\n\n${results.join('\n')}\n\n${successCount > 0 ? '🎉 Found working method!' : '⚠️  No working update methods found.'}`
    };

  } catch (error) {
    return {
      success: false,
      message: `Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Test all related ORDS endpoints that might be used during approval process
export async function testAllOrdsEndpoints(): Promise<{success: boolean, message: string}> {
  try {
    console.log('=== TESTING ALL ORDS ENDPOINTS ===');
    
    // Define all possible endpoints based on your table structure
    const endpoints = [
      { name: 'DEMANDS', path: 'demands' },
      { name: 'APPROVALS', path: 'approvals' },
      { name: 'COMMENTS', path: 'comments' },
      { name: 'AUDIT', path: 'audit' },
      { name: 'XXITDM_DEMANDS', path: 'xxitdm_demands' },
      { name: 'XXITDM_APPROVALS', path: 'xxitdm_approvals' },
      { name: 'XXITDM_COMMENTS', path: 'xxitdm_comments' },
      { name: 'XXITDM_AUDIT', path: 'xxitdm_audit' },
      // Try with different casing
      { name: 'DEMANDS (upper)', path: 'DEMANDS' },
      { name: 'APPROVALS (upper)', path: 'APPROVALS' },
    ];
    
    const results: string[] = [];
    const workingEndpoints: string[] = [];
    const methods = ['GET', 'POST', 'PUT', 'PATCH'];
    
    for (const endpoint of endpoints) {
      console.log(`\nTesting endpoint: ${endpoint.name}`);
      
      const endpointResults: string[] = [];
      let hasAnyMethod = false;
      
      for (const method of methods) {
        try {
          const response = await fetch(`${BASE}/${endpoint.path}/`, {
            method,
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            body: method !== 'GET' ? JSON.stringify({ test: 'data' }) : undefined
          });
          
          if (response.status !== 404) {
            hasAnyMethod = true;
            const statusIcon = response.ok ? '✅' : response.status < 500 ? '⚠️' : '❌';
            endpointResults.push(`    ${statusIcon} ${method}: ${response.status}`);
            
            if (response.ok) {
              workingEndpoints.push(`${endpoint.path}:${method}`);
            }
          }
          
        } catch (error) {
          // Network errors, ignore for endpoint discovery
        }
      }
      
      if (hasAnyMethod) {
        results.push(`📋 ${endpoint.name} (/${endpoint.path}/):`);
        results.push(...endpointResults);
      } else {
        results.push(`❌ ${endpoint.name}: Not found`);
      }
    }
    
    // Also test individual record access
    if (workingEndpoints.some(e => e.includes('demands'))) {
      try {
        const demands = await listDemands(1);
        if (demands.length > 0) {
          const testId = demands[0].id;
          results.push(`\n📋 Testing individual record access with ID: ${testId}`);
          
          for (const method of ['GET', 'PUT', 'PATCH']) {
            try {
              const response = await fetch(`${BASE}/demands/${encodeURIComponent(testId)}`, {
                method,
                headers: {
                  'Accept': 'application/json',
                  'Content-Type': 'application/json'
                },
                body: method !== 'GET' ? JSON.stringify({ description: 'test' }) : undefined
              });
              
              const statusIcon = response.ok ? '✅' : response.status < 500 ? '⚠️' : '❌';
              results.push(`    ${statusIcon} ${method} /demands/${testId}: ${response.status}`);
              
            } catch (error) {
              results.push(`    💥 ${method} /demands/${testId}: ${error}`);
            }
          }
        }
      } catch (error) {
        results.push(`    ⚠️  Could not test individual record access: ${error}`);
      }
    }
    
    return {
      success: workingEndpoints.length > 0,
      message: `ORDS Endpoint Discovery Results:\n\n${results.join('\n')}\n\n🎯 Working endpoints: ${workingEndpoints.length}\n📝 Check console for detailed logs.`
    };
    
  } catch (error) {
    console.error('Endpoint testing failed:', error);
    return {
      success: false,
      message: `Endpoint testing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Test specific approval-related functionality
export async function testApprovalWorkflow(demandId?: string): Promise<{success: boolean, message: string}> {
  try {
    console.log('=== TESTING APPROVAL WORKFLOW ===');
    
    if (!demandId) {
      const demands = await listDemands(1);
      if (demands.length === 0) {
        return {
          success: false,
          message: '❌ No existing demands found. Create a demand first.'
        };
      }
      demandId = demands[0].id;
    }
    
    const results: string[] = [];
    
    // Test 1: Can we read the current demand?
    try {
      const demand = await getDemand(demandId);
      results.push(`✅ Read demand: Success`);
      results.push(`    Current status: ${demand.status}`);
      results.push(`    Current stage: ${demand.current_stage || demand.currentStage || 'Not set'}`);
    } catch (error) {
      results.push(`❌ Read demand: Failed - ${error}`);
      return { success: false, message: results.join('\n') };
    }
    
    // Test 2: Try minimal status update
    try {
      console.log('Testing minimal status update...');
      const response = await fetch(`${BASE}/demands/${encodeURIComponent(demandId)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ status: 'Under Review' })
      });
      
      const text = await response.text();
      if (response.ok) {
        results.push(`✅ Status update: Success`);
      } else {
        results.push(`❌ Status update: ${response.status} - ${text.substring(0, 100)}`);
      }
    } catch (error) {
      results.push(`❌ Status update: ${error}`);
    }
    
    // Test 3: Try stage update
    try {
      console.log('Testing stage update...');
      const response = await fetch(`${BASE}/demands/${encodeURIComponent(demandId)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ current_stage: 'Screening' })
      });
      
      const text = await response.text();
      if (response.ok) {
        results.push(`✅ Stage update: Success`);
      } else {
        results.push(`❌ Stage update: ${response.status} - ${text.substring(0, 100)}`);
      }
    } catch (error) {
      results.push(`❌ Stage update: ${error}`);
    }
    
    // Test 4: Test approval-related endpoints  
    const approvalEndpoints = ['approvals', 'xxitdm_approvals'];
    
    for (const endpoint of approvalEndpoints) {
      try {
        const response = await fetch(`${BASE}/${endpoint}/`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        });
        
        if (response.status === 404) {
          results.push(`❌ /${endpoint}/: Not configured`);
        } else if (response.ok) {
          results.push(`✅ /${endpoint}/: Available (${response.status})`);
          
          // If xxitdm_approvals works, test if we can POST to it
          if (endpoint === 'xxitdm_approvals') {
            try {
              const testPost = await fetch(`${BASE}/${endpoint}/`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Accept': 'application/json'
                },
                body: JSON.stringify({
                  demand_id: demandId,
                  approver: 'Test User',
                  role: 'Test Role',
                  status: 'Pending'
                })
              });
              
              if (testPost.ok) {
                results.push(`✅   /${endpoint}/ POST: Works (${testPost.status})`);
              } else {
                const errorText = await testPost.text();
                results.push(`⚠️   /${endpoint}/ POST: ${testPost.status} - ${errorText.substring(0, 50)}...`);
              }
            } catch (error) {
              results.push(`💥   /${endpoint}/ POST: ${error}`);
            }
          }
        } else {
          results.push(`⚠️  /${endpoint}/: ${response.status}`);
        }
      } catch (error) {
        results.push(`💥 /${endpoint}/: ${error}`);
      }
    }
    
    const successCount = results.filter(r => r.startsWith('✅')).length;
    
    return {
      success: successCount > 0,
      message: `Approval Workflow Test Results:\n\n${results.join('\n')}\n\n✅ Success: ${successCount} operations`
    };
    
  } catch (error) {
    return {
      success: false,
      message: `Workflow test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Test the exact approval payload that's causing the 555 error
export async function testExactApprovalPayload(demandId?: string): Promise<{success: boolean, message: string}> {
  try {
    console.log('=== TESTING EXACT APPROVAL PAYLOAD ===');
    
    if (!demandId) {
      const demands = await listDemands(1);
      if (demands.length === 0) {
        return {
          success: false,
          message: '❌ No existing demands found. Create a demand first.'
        };
      }
      demandId = demands[0].id;
    }

    // Get the current demand first
    const currentDemand = await getDemand(demandId);
    console.log('Current demand before update:', currentDemand);

    const results: string[] = [];
    
    // Test the exact payloads that approval workflow sends
    const approvalPayloads = [
      {
        name: 'BU Head Approval (Screening)',
        payload: { status: 'Under Review', current_stage: 'Assessment' }
      },
      {
        name: 'ITPMO Approval (Assessment)', 
        payload: { status: 'Under Review', current_stage: 'Authorization' }
      },
      {
        name: 'DBR Final Approval',
        payload: { status: 'Approved', current_stage: 'Service Portfolio Entry' }
      },
      {
        name: 'Status only',
        payload: { status: 'Under Review' }
      },
      {
        name: 'Stage only',
        payload: { current_stage: 'Screening' }
      }
    ];

    for (const test of approvalPayloads) {
      try {
        console.log(`\nTesting: ${test.name}`, test.payload);
        
        const response = await fetch(`${BASE}/demands/${encodeURIComponent(demandId)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(test.payload)
        });

        const text = await response.text();
        console.log(`Response for ${test.name}:`, {
          status: response.status,
          ok: response.ok,
          body: text.substring(0, 200)
        });

        if (response.ok) {
          results.push(`✅ ${test.name}: SUCCESS`);
        } else {
          const errorSnippet = text.length > 150 ? text.substring(0, 150) + '...' : text;
          results.push(`❌ ${test.name}: ${response.status}`);
          
          // If it's a 555 error, try to extract more details
          if (response.status === 555) {
            try {
              const errorJson = JSON.parse(text);
              // Look for various error fields that ORDS might return
              const errorFields = [
                'details', 'message', 'error', 'title', 'detail', 
                'errorDetails', 'cause', 'sqlError', 'exception'
              ];
              
              for (const field of errorFields) {
                if (errorJson[field]) {
                  results.push(`   ${field}: ${errorJson[field]}`);
                }
              }
              
              // Also log the full error object for debugging
              console.error(`Full 555 error object for ${test.name}:`, errorJson);
              
            } catch (parseError) {
              // If it's not JSON, it might be plain text SQL error
              results.push(`   Raw error: ${text.substring(0, 200)}...`);
              console.error(`Raw 555 error text for ${test.name}:`, text);
            }
          } else {
            results.push(`   Error: ${errorSnippet}`);
          }
        }
        
      } catch (error) {
        results.push(`💥 ${test.name}: ${error}`);
      }
    }

    const successCount = results.filter(r => r.startsWith('✅')).length;

    return {
      success: successCount > 0,
      message: `Approval Payload Test Results (${successCount}/${approvalPayloads.length} succeeded):\n\n${results.join('\n')}\n\nCurrent demand ID: ${demandId}\nOriginal status: ${currentDemand.status}\nOriginal stage: ${currentDemand.current_stage || currentDemand.currentStage || 'None'}`
    };

  } catch (error) {
    return {
      success: false,
      message: `Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Test using exact database column names instead of API field names
export async function testDatabaseColumnNames(demandId?: string): Promise<{success: boolean, message: string}> {
  try {
    console.log('=== TESTING DATABASE COLUMN NAMES ===');
    
    if (!demandId) {
      const demands = await listDemands(1);
      if (demands.length === 0) {
        return {
          success: false,
          message: '❌ No existing demands found. Create a demand first.'
        };
      }
      demandId = demands[0].id;
    }

    const results: string[] = [];
    
    // Test with various column name formats that might match your database
    const columnTestPayloads = [
      {
        name: 'Uppercase columns',
        payload: { 
          STATUS: 'Under Review', 
          CURRENT_STAGE: 'Screening',
          TITLE: 'Test Update'
        }
      },
      {
        name: 'Mixed case columns', 
        payload: {
          Status: 'Under Review',
          Current_Stage: 'Screening', 
          Title: 'Test Update'
        }
      },
      {
        name: 'Snake case columns',
        payload: {
          status: 'Under Review',
          current_stage: 'Screening',
          title: 'Test Update'
        }
      },
      {
        name: 'Only required field',
        payload: {
          TITLE: 'Test Title Update Only'
        }
      },
      {
        name: 'With all required fields',
        payload: {
          TITLE: 'Test Update',
          CREATED_DATE: new Date().toISOString()
        }
      }
    ];

    for (const test of columnTestPayloads) {
      try {
        console.log(`\nTesting: ${test.name}`, test.payload);
        
        const response = await fetch(`${BASE}/demands/${encodeURIComponent(demandId)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(test.payload)
        });

        const text = await response.text();
        console.log(`Response for ${test.name}:`, response.status, text.substring(0, 100));

        if (response.ok) {
          results.push(`✅ ${test.name}: SUCCESS`);
        } else if (response.status === 555) {
          results.push(`❌ ${test.name}: 555 SQL Error`);
          // Extract error details
          try {
            const errorJson = JSON.parse(text);
            Object.keys(errorJson).forEach(key => {
              if (errorJson[key] && typeof errorJson[key] === 'string') {
                results.push(`   ${key}: ${errorJson[key].substring(0, 100)}...`);
              }
            });
          } catch {
            results.push(`   Raw: ${text.substring(0, 150)}...`);
          }
        } else {
          results.push(`❌ ${test.name}: ${response.status}`);
        }
        
      } catch (error) {
        results.push(`💥 ${test.name}: ${error}`);
      }
    }

    const successCount = results.filter(r => r.startsWith('✅')).length;

    return {
      success: successCount > 0,
      message: `Column Name Test Results (${successCount}/${columnTestPayloads.length} succeeded):\n\n${results.join('\n')}\n\nDemand ID: ${demandId}`
    };

  } catch (error) {
    return {
      success: false,
      message: `Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Test approval with the corrected database column mapping
export async function testFixedApprovalUpdate(demandId?: string): Promise<{success: boolean, message: string}> {
  try {
    console.log('=== TESTING FIXED APPROVAL UPDATE ===');
    
    if (!demandId) {
      const demands = await listDemands(1);
      if (demands.length === 0) {
        return {
          success: false,
          message: '❌ No existing demands found. Create a demand first.'
        };
      }
      demandId = demands[0].id;
    }

    // Get current demand to preserve required fields
    const currentDemand = await getDemand(demandId);
    console.log('Current demand:', currentDemand);

    const results: string[] = [];
    
    // Test the exact approval payloads with correct database column names
    const approvalTests = [
      {
        name: 'BU Head Approval',
        payload: {
          ID: demandId,
          TYPE: currentDemand.type || 'Strategic',
          STATUS: 'Under Review', 
          CURRENT_STAGE: 'Assessment'
        }
      },
      {
        name: 'Status Update Only',
        payload: {
          ID: demandId,
          TYPE: currentDemand.type || 'Strategic',
          STATUS: 'Under Review'
        }
      },
      {
        name: 'Stage Update Only',
        payload: {
          ID: demandId,
          TYPE: currentDemand.type || 'Strategic',
          CURRENT_STAGE: 'Screening'
        }
      }
    ];

    for (const test of approvalTests) {
      try {
        console.log(`\nTesting: ${test.name}`, test.payload);
        
        const response = await fetch(`${BASE}/demands/${encodeURIComponent(demandId)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(test.payload)
        });

        const text = await response.text();
        console.log(`Response for ${test.name}:`, {
          status: response.status,
          ok: response.ok,
          body: text.substring(0, 200)
        });

        if (response.ok) {
          results.push(`✅ ${test.name}: SUCCESS`);
        } else {
          results.push(`❌ ${test.name}: ${response.status}`);
          
          if (response.status === 555) {
            try {
              const errorJson = JSON.parse(text);
              if (errorJson.message || errorJson.title || errorJson.detail) {
                results.push(`   Error: ${errorJson.message || errorJson.title || errorJson.detail}`);
              }
            } catch {
              results.push(`   Raw: ${text.substring(0, 100)}...`);
            }
          }
        }
        
      } catch (error) {
        results.push(`💥 ${test.name}: ${error}`);
      }
    }

    const successCount = results.filter(r => r.startsWith('✅')).length;

    return {
      success: successCount > 0,
      message: `Fixed Approval Test Results (${successCount}/${approvalTests.length} succeeded):\n\n${results.join('\n')}\n\n✅ Using correct column names:\n- STATUS (not status)\n- CURRENT_STAGE (not current_stage)\n- Including required TYPE field`
    };

  } catch (error) {
    return {
      success: false,
      message: `Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Comprehensive systematic diagnostic - analyze everything step by step
export async function comprehensiveDiagnostic(): Promise<{success: boolean, message: string}> {
  const results: string[] = [];
  let phase = 1;
  
  try {
    // PHASE 1: Database Structure Analysis
    results.push(`🔍 PHASE ${phase++}: BASIC CONNECTIVITY`);
    results.push('=' .repeat(50));
    
    // Test 1.1: Can we read demands?
    try {
      const demands = await listDemands(1);
      results.push(`✅ GET /demands/: SUCCESS (${demands.length} records)`);
      if (demands.length > 0) {
        const sample = demands[0];
        results.push(`   Sample record ID: ${sample.id}`);
        results.push(`   Sample fields: ${Object.keys(sample).join(', ')}`);
      }
    } catch (error) {
      results.push(`❌ GET /demands/: FAILED - ${error}`);
      return { success: false, message: results.join('\n') };
    }

    // PHASE 2: Individual Record Access
    results.push(`\n🔍 PHASE ${phase++}: INDIVIDUAL RECORD ACCESS`);
    results.push('=' .repeat(50));
    
    const demands = await listDemands(1);
    if (demands.length === 0) {
      results.push('❌ No records to test individual access');
      return { success: false, message: results.join('\n') };
    }
    
    const testId = demands[0].id;
    
    // Test 2.1: Can we read individual record?
    try {
      const individual = await getDemand(testId);
      results.push(`✅ GET /demands/${testId}: SUCCESS`);
      results.push(`   Record type: ${typeof individual}`);
      results.push(`   Has ID: ${!!individual.id}`);
      results.push(`   Current status: ${individual.status || 'undefined'}`);
      results.push(`   Current stage: ${individual.current_stage || individual.currentStage || 'undefined'}`);
    } catch (error) {
      results.push(`❌ GET /demands/${testId}: FAILED - ${error}`);
    }

    // PHASE 3: HTTP Methods Analysis  
    results.push(`\n🔍 PHASE ${phase++}: HTTP METHODS ANALYSIS`);
    results.push('=' .repeat(50));
    
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
    for (const method of methods) {
      try {
        const response = await fetch(`${BASE}/demands/${encodeURIComponent(testId)}`, {
          method,
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: method === 'GET' ? undefined : JSON.stringify({ test: 'probe' })
        });
        
        results.push(`${response.ok ? '✅' : '❌'} ${method} /demands/${testId}: ${response.status} ${response.statusText}`);
        
        if (response.status === 555) {
          const text = await response.text();
          results.push(`   555 Error details: ${text.substring(0, 100)}...`);
        }
        
      } catch (error) {
        results.push(`💥 ${method}: Network error - ${error}`);
      }
    }

    // PHASE 4: Minimal Payload Testing
    results.push(`\n🔍 PHASE ${phase++}: MINIMAL PAYLOAD TESTING`);  
    results.push('=' .repeat(50));
    
    const minimalPayloads = [
      { name: 'Empty object', data: {} },
      { name: 'Single field', data: { test: 'value' } },
      { name: 'ID only', data: { ID: testId } },
      { name: 'ID + one field', data: { ID: testId, STATUS: 'Draft' } }
    ];
    
    for (const payload of minimalPayloads) {
      try {
        console.log(`Testing minimal payload: ${payload.name}`, payload.data);
        
        const response = await fetch(`${BASE}/demands/${encodeURIComponent(testId)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload.data)
        });
        
        const text = await response.text();
        results.push(`${response.ok ? '✅' : '❌'} ${payload.name}: ${response.status}`);
        
        if (!response.ok && text) {
          // Try to extract meaningful error
          try {
            const errorObj = JSON.parse(text);
            const errorMsg = errorObj.message || errorObj.title || errorObj.detail || 'No message';
            results.push(`   Error: ${errorMsg.substring(0, 100)}`);
          } catch {
            results.push(`   Raw error: ${text.substring(0, 100)}`);
          }
        }
        
        console.log(`Minimal payload ${payload.name} result:`, response.status, text.substring(0, 200));
        
      } catch (error) {
        results.push(`💥 ${payload.name}: ${error}`);
      }
    }

    // PHASE 5: ORDS Metadata Analysis
    results.push(`\n🔍 PHASE ${phase++}: ORDS METADATA ANALYSIS`);
    results.push('=' .repeat(50));
    
    // Check ORDS endpoints
    const endpointTests = ['', 'metadata-catalog', 'openapi'];
    for (const endpoint of endpointTests) {
      try {
        const response = await fetch(`${BASE}/${endpoint}`, {
          headers: { 'Accept': 'application/json' }
        });
        
        results.push(`${response.ok ? '✅' : '❌'} /${endpoint}: ${response.status}`);
        
        if (response.ok && endpoint === 'openapi') {
          const text = await response.text();
          if (text.includes('PUT')) {
            results.push('   OpenAPI shows PUT is supported');
          } else {
            results.push('   OpenAPI does NOT show PUT support');
          }
        }
        
      } catch (error) {
        results.push(`💥 /${endpoint}: ${error}`);
      }
    }

    // PHASE 6: Content-Type Variations
    results.push(`\n🔍 PHASE ${phase++}: CONTENT-TYPE VARIATIONS`);
    results.push('=' .repeat(50));
    
    const contentTypes = [
      'application/json',
      'application/json; charset=utf-8',
      'text/plain',
      'application/x-www-form-urlencoded'
    ];
    
    for (const contentType of contentTypes) {
      try {
        const testData = contentType.includes('form-urlencoded') 
          ? 'STATUS=Draft'
          : JSON.stringify({ STATUS: 'Draft' });
          
        const response = await fetch(`${BASE}/demands/${encodeURIComponent(testId)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': contentType,
            'Accept': 'application/json'
          },
          body: testData
        });
        
        results.push(`${response.ok ? '✅' : '❌'} Content-Type: ${contentType}: ${response.status}`);
        
      } catch (error) {
        results.push(`💥 ${contentType}: ${error}`);
      }
    }

    const successCount = results.filter(r => r.includes('✅')).length;
    const failureCount = results.filter(r => r.includes('❌')).length;
    
    results.push(`\n📊 SUMMARY: ${successCount} successes, ${failureCount} failures`);
    
    return {
      success: successCount > failureCount,
      message: results.join('\n')
    };
    
  } catch (error) {
    results.push(`💥 DIAGNOSTIC FAILED: ${error}`);
    return {
      success: false,
      message: results.join('\n')
    };
  }
}

/* ------------------------------
 * CRUD – Demands
 * ------------------------------ */

// List
export async function listDemands(limit = 100): Promise<Demand[]> {
  // Add cache-busting parameter to prevent stale data
  const timestamp = new Date().getTime();
  const qs = `?limit=${limit}&_format=json&_t=${timestamp}`;
  const data = await http<JsonList<Demand>>(`/demands/${qs}`);
  return data.items ?? [];
}

// Read one
export function getDemand(id: string): Promise<Demand> {
  return http<Demand>(`/demands/${encodeURIComponent(id)}?_format=json`);
}

// Create
export async function createDemand(form: Partial<Demand>): Promise<Demand> {
  console.log('Creating demand with form data:', form);
  
  const payload: Partial<Demand> = {
    title: form.title ?? "",
    type: form.type ?? "Strategic",
    priority: form.priority ?? "MEDIUM",
    status: form.status ?? "Draft",
    current_stage: form.current_stage ?? "Intake",
    expected_delivery: toUtcMidnight(form.expected_delivery),
    description: form.description ?? "",
    requestor: form.requestor ?? "John Smith",
    department: form.department ?? "IT Operations",
    progress: form.progress ?? 0,

    business_justification: form.business_justification ?? undefined,
    expected_benefits: form.expected_benefits ?? undefined,
    risk_assessment: form.risk_assessment ?? undefined,
    success_criteria: form.success_criteria ?? undefined,
    estimated_cost: form.estimated_cost ?? undefined,
    budget_source: form.budget_source ?? undefined,
    cost_category: form.cost_category ?? undefined,
    roi: form.roi ?? undefined,
    expected_start_date: toUtcMidnight(form.expected_start_date),
  };

  // Clean undefined values
  Object.keys(payload).forEach((key) => {
    const k = key as keyof Demand;
    if (payload[k] === undefined) delete payload[k];
  });

  console.log('Final payload for POST:', payload);
  console.log('Payload size:', JSON.stringify(payload).length, 'characters');

  try {
    return await http<Demand>(`/demands/`, {
      method: "POST",
      headers: { 
        "X-DB-DEFAULTS": "true",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error('Create demand failed:', error);
    console.error('Was attempting to POST to:', `${BASE}/demands/`);
    throw error;
  }
}

// 15-09-2025
// Update (full row) — send a complete payload to AutoREST, so nothing is nulled.
export async function updateDemand(id: string, patch: Partial<Demand>): Promise<Demand> {
  // 1) Read current row from AutoREST item endpoint
  //    (this should return the full record; if it doesn't, see notes below)
  const cur = await getDemand(id);

  // 2) Merge your changes; patch values win when defined
  const m: any = { ...cur, ...patch };

  // 3) Build a FULL payload. Use the same attribute names AutoREST returns.
  //    If your GET returns camelCase, keep camelCase; if it returns lowercase_with_underscores, use that.
  const payload: Record<string, any> = {
    id,
    title: m.title ?? "(Untitled)",
    type: m.type ?? null,
    priority: m.priority ?? null,
    status: m.status ?? null,
    current_stage: m.current_stage ?? m.currentStage ?? null,
    description: m.description ?? null,
    requestor: m.requestor ?? null,
    department: m.department ?? null,

    expected_start_date: toUtcMidnight(m.expected_start_date ?? m.expectedStartDate) ?? null,
    expected_delivery:   toUtcMidnight(m.expected_delivery   ?? m.expectedDelivery)   ?? null,

    business_justification: m.business_justification ?? null,
    expected_benefits:      m.expected_benefits      ?? null,
    risk_assessment:        m.risk_assessment        ?? null,
    success_criteria:       m.success_criteria       ?? null,

    estimated_cost: m.estimated_cost ?? null,
    budget_source:  m.budget_source  ?? null,
    cost_category:  m.cost_category  ?? null,
    roi:            m.roi            ?? null,
    progress:       m.progress       ?? null,

    // IMPORTANT: keep original created date on update
    created_date: cur.created_date ?? cur.createdDate ?? null,
  };

  // 4) PUT to the AutoREST item endpoint
  return http<Demand>(`/demands/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(payload),
  });
}

/*
// Update (partial) - Fixed with correct required fields based on actual schema
export async function updateDemand(id: string, patch: Partial<Demand>): Promise<Demand> {
  console.log('Updating demand:', id, 'with patch:', patch);
  
  // Get current demand first to ensure we have required fields
  const currentDemand = await getDemand(id);
  
  // Based on actual schema analysis - ensure all required NOT NULL fields are present
  const dbPayload: Record<string, any> = {
    // REQUIRED NOT NULL fields (from actual schema: ID, TITLE, CREATED_DATE)
    ID: id,
    TITLE: patch.title || currentDemand.title || '(Untitled)',
    CREATED_DATE: currentDemand.created_date || currentDemand.createdDate || new Date().toISOString(),
  };
  
  // Add optional fields if provided (TYPE is NULLABLE according to actual schema)
  if (patch.status !== undefined) {
    dbPayload.STATUS = patch.status;
  }
  
  if (patch.current_stage !== undefined) {
    dbPayload.CURRENT_STAGE = patch.current_stage;
  }
  
  if (patch.type !== undefined) {
    dbPayload.TYPE = patch.type;
  }
  
  if (patch.priority !== undefined) {
    dbPayload.PRIORITY = patch.priority;
  }
  
  if (patch.description !== undefined) {
    dbPayload.DESCRIPTION = patch.description;
  }
  
  if (patch.requestor !== undefined) {
    dbPayload.REQUESTOR = patch.requestor;
  }
  
  if (patch.department !== undefined) {
    dbPayload.DEPARTMENT = patch.department;
  }
  
  if (patch.expected_delivery !== undefined) {
    dbPayload.EXPECTED_DELIVERY = patch.expected_delivery ? toUtcMidnight(patch.expected_delivery) : null;
  }
  
  if (patch.progress !== undefined) {
    dbPayload.PROGRESS = patch.progress;
  }
  
  console.log('Database payload with exact column names:', dbPayload);
  console.log('Update URL:', `${BASE}/demands/${encodeURIComponent(id)}`);
  
  try {
    return http<Demand>(`/demands/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(dbPayload),
    });
  } catch (error) {
    console.error('Update demand failed:', error);
    console.error('Was attempting to PUT to:', `${BASE}/demands/${encodeURIComponent(id)}`);
    throw error;
  }
}
*/

// Delete
export async function deleteDemand(id: string): Promise<void> {
  try {
    // ORDS sometimes requires a JSON body even for DELETE operations
    await http<void>(`/demands/${encodeURIComponent(id)}`, { 
      method: "DELETE",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ID: id })  // Provide the required JSON body
    });
  } catch (error) {
    console.error(`Delete failed for demand ${id}:`, error);
    throw error;
  }
}

// Test DELETE functionality and provide alternatives
export async function testDeleteOperation(testId: string): Promise<{success: boolean, message: string, alternatives?: string[]}> {
  try {
    console.log(`Testing DELETE operation for demand: ${testId}`);
    
    // Test 1: Standard DELETE
    try {
      const response = await fetch(`${BASE}/demands/${encodeURIComponent(testId)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ID: testId })  // Include JSON body as ORDS expects
      });
      
      console.log(`DELETE /demands/${testId}: ${response.status} ${response.statusText}`);
      
      if (response.ok) {
        return {
          success: true,
          message: `DELETE operation successful for ${testId}`
        };
      } else {
        const errorText = await response.text();
        console.log('DELETE error response:', errorText);
        
        return {
          success: false,
          message: `DELETE failed: HTTP ${response.status}. ${errorText}`,
          alternatives: [
            'Option 1: Use UPDATE to set a STATUS=\'DELETED\' instead of physical delete',
            'Option 2: Check if ORDS auto-rest DELETE is enabled for the table',
            'Option 3: Create a custom DELETE endpoint in ORDS',
            'Option 4: Use a soft delete approach (mark as inactive instead of removing)'
          ]
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `DELETE test failed: ${error}`,
        alternatives: [
          'Network or connection issue - check ORDS configuration',
          'Try soft delete approach instead of hard delete'
        ]
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `Delete test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Alternative: Soft delete using UPDATE - ultra-simplified approach
export async function softDeleteDemand(id: string): Promise<void> {
  console.log(`🔄 Performing soft delete for demand: ${id}`);
  
  try {
    // Ultra-simple approach: just try to update with minimal data
    // This avoids potential issues with getDemand or complex field updates
    const response = await fetch(`${BASE}/demands/${encodeURIComponent(id)}`, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ID: id,
        TITLE: `DELETED-${id}`,
        CREATED_DATE: new Date().toISOString()
      })
    });
    
    console.log(`🔄 Soft delete response: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Soft delete failed with response:', errorText);
      throw new Error(`Soft delete HTTP ${response.status}: ${errorText}`);
    }
    
    console.log('✅ Soft delete successful');
  } catch (error) {
    console.error('❌ Soft delete failed:', error);
    throw new Error(`Soft delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Even simpler alternative - just hide from UI without DB changes
export function markAsDeletedInUI(demands: Demand[], deletedId: string): Demand[] {
  return demands.filter(d => d.id !== deletedId);
}

// Test ORDS authentication and permissions
export async function testOrdsAuth(): Promise<{success: boolean, message: string, details?: any}> {
  try {
    console.log('Testing ORDS authentication and permissions...');
    
    // Test 1: GET operation (should work if auto-rest is enabled)
    console.log('Test 1: GET demands (read permission)');
    try {
      const response = await fetch(`${BASE}/demands/`, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      console.log(`GET /demands/: ${response.status} ${response.statusText}`);
      
      if (response.status === 401) {
        return {
          success: false,
          message: 'Authentication required for ORDS. GET operations returning 401.',
          details: {
            status: response.status,
            statusText: response.statusText,
            suggestion: 'Configure ORDS authentication or enable anonymous access for auto-rest services'
          }
        };
      }
    } catch (error) {
      console.log('GET test failed:', error);
    }
    
    // Test 2: Check if we can do a simple PUT to a test endpoint
    console.log('Test 2: PUT operation (write permission)');
    try {
      // Try a minimal PUT that should fail gracefully if no auth
      const response = await fetch(`${BASE}/demands/TEST`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ID: 'TEST' })
      });
      
      console.log(`PUT /demands/TEST: ${response.status} ${response.statusText}`);
      
      if (response.status === 401) {
        const responseText = await response.text();
        return {
          success: false,
          message: 'HTTP 401: ORDS requires authentication for write operations',
          details: {
            status: response.status,
            response: responseText,
            solution: 'You need to either:\n1. Configure ORDS to allow anonymous write access\n2. Set up database authentication\n3. Configure OAuth2 or other auth method'
          }
        };
      }
    } catch (error) {
      console.log('PUT test failed:', error);
    }
    
    return {
      success: true,
      message: 'Authentication tests completed. Check console for details.'
    };
    
  } catch (error) {
    return {
      success: false,
      message: `Authentication test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}
