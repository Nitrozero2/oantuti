"""Untrusted code executes only inside Judge0, never in the finals process."""
import asyncio
import json
import os
import time
import httpx

WRAPPER = '''import json, sys
data = json.loads(sys.stdin.read())
{code}
try:
    result = agent(data["observation"], data["configuration"])
    print(json.dumps(result))
except Exception as error:
    print(json.dumps({{"error": str(error)}}))
'''


async def execute(code, observation, rules):
    url = os.getenv('FINALS_JUDGE0_URL', 'http://localhost:2358').rstrip('/')
    headers = {'X-Auth-Token': os.environ['FINALS_JUDGE0_API_KEY']} if os.getenv('FINALS_JUDGE0_API_KEY') else {}
    payload = {'language_id': int(os.getenv('FINALS_JUDGE0_LANGUAGE_ID', '71')), 'source_code': WRAPPER.format(code=code),
               'stdin': json.dumps({'observation': observation, 'configuration': {'finals_rules': rules}}),
               'cpu_time_limit': 2, 'wall_time_limit': 4, 'memory_limit': 128000}
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(url+'/submissions', json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()
        deadline = time.monotonic()+30
        while data.get('status', {}).get('id', 0) in (0, 1, 2):
            if not data.get('token') or time.monotonic() >= deadline:
                raise RuntimeError('Judge0 execution deadline exceeded')
            await asyncio.sleep(0.1)
            response = await client.get(url+'/submissions/'+data['token'], headers=headers)
            response.raise_for_status(); data = response.json()
        if data.get('status', {}).get('id') != 3:
            raise RuntimeError('Judge0: '+str(data.get('status', {}).get('description', 'execution failed')))
        lines = [s for s in (data.get('stdout') or '').splitlines() if s.strip()]
        if not lines:
            raise ValueError('Agent produced no action')
        action = json.loads(lines[-1])
        if not isinstance(action, dict) or 'error' in action:
            raise ValueError('Agent did not produce a valid action')
        return action
