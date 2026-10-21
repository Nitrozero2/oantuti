"""Standalone rules/runtime tests. No imports from the ordinary worker/backend."""
import ast
import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock
import httpx
import pytest
from finals_runner.game import FinalsGame, RULES
from finals_runner import agent
from finals_runner.__main__ import process, offline

CYCLE = [
    {'from_col': 1, 'from_row': 3, 'to_col': 0, 'to_row': 3},
    {'from_col': 7, 'from_row': 5, 'to_col': 8, 'to_row': 5},
    {'from_col': 0, 'from_row': 3, 'to_col': 1, 'to_row': 3},
    {'from_col': 8, 'from_row': 5, 'to_col': 7, 'to_row': 5},
]


def test_independent_engine_threefold_and_legacy_interface():
    game = FinalsGame()
    obs = game.observation()
    assert len(obs['board']) == 81 and len(obs['board_2d']) == 9
    assert obs['valid_moves'] and obs['finals']['terrain'] == []
    for move in CYCLE * 2:
        game.step(move)
    assert game.outcome == 'draw'
    assert '3' in game.reason
    assert game.engine.state.move_count == 8
    with pytest.raises(ValueError):
        game.step(CYCLE[0])


def test_move_limit_and_invalid_action_do_not_silently_forfeit():
    game = FinalsGame()
    game.engine.state.move_count = 149
    game.step(CYCLE[0])
    assert game.outcome == 'draw' and '150' in game.reason
    game = FinalsGame()
    with pytest.raises(ValueError):
        game.step({'from_col': 99})
    assert game.outcome is None
    with pytest.raises(ValueError):
        FinalsGame({**RULES, 'max_moves': 300})


def test_normal_engine_is_not_a_runtime_dependency():
    for file in Path(__file__).parent.glob('*.py'):
        tree = ast.parse(file.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                assert not (node.module or '').startswith(('worker', 'backend'))
            elif isinstance(node, ast.Import):
                assert all(not name.name.startswith(('worker', 'backend')) for name in node.names)


@pytest.mark.asyncio
async def test_judge0_preserves_agent_contract_and_uses_private_finals_configuration(monkeypatch):
    captured = []
    def handler(request):
        data = json.loads(request.content); captured.append(data)
        # Compile syntax only; never execute untrusted agent source in this process.
        compile(data['source_code'], '<agent-wrapper>', 'exec')
        return httpx.Response(201, json={'status': {'id': 3}, 'stdout': json.dumps(CYCLE[0])})
    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    result = await agent.execute('def agent(observation, configuration):\n    return {}', FinalsGame().observation(), RULES)
    assert result == CYCLE[0]
    assert json.loads(captured[0]['stdin'])['configuration']['finals_rules'] == RULES


@pytest.mark.asyncio
async def test_persists_each_move_and_waits_for_admin_on_any_error(monkeypatch):
    import finals_runner.__main__ as program
    class DB:
        def __init__(self):
            self.steps = []; self.errors = []
        def step(self, job, expected, move, state, outcome, reason):
            self.steps.append((expected, move, outcome)); return True
        def fail(self, job, error):
            self.errors.append(str(error))
        def renew(self, *args):
            return True
    db = DB(); job = {'rules': RULES, 'game_id': 1, 'attempt_id': 1, 'token': 'x', 'agent1_code': 'a', 'agent2_code': 'b'}
    execute = AsyncMock(side_effect=CYCLE*2)
    monkeypatch.setattr(program, 'execute', execute)
    await process(db, job)
    assert len(db.steps) == 8 and db.steps[-1][2] == 'draw' and not db.errors
    db = DB(); execute = AsyncMock(side_effect=RuntimeError('Judge0 unavailable'))
    monkeypatch.setattr(program, 'execute', execute)
    await process(db, job)
    assert execute.await_count == 1 and not db.steps and db.errors


@pytest.mark.asyncio
async def test_offline_record_is_exclusive_and_does_not_require_database(monkeypatch, tmp_path):
    import finals_runner.__main__ as program
    from types import SimpleNamespace
    bundle = tmp_path/'test.bundle.json'; output = tmp_path/'test.record.json'
    bundle.write_text(json.dumps({'format': 'ott-finals-bundle-v1', 'edition': {'rules': RULES},
        'games': [{'id': 5, 'seed1': 1, 'seed2': 2}],
        'entrants': [{'seed': i, 'code': 'private', 'code_hash': str(i)} for i in [1, 2]]}))
    monkeypatch.setattr(program, 'execute', AsyncMock(side_effect=CYCLE*2))
    await offline(SimpleNamespace(bundle=str(bundle), game=5, output=str(output)))
    record = json.loads(output.read_text())
    assert record['game_id'] == 5 and record['outcome'] == 'draw' and len(record['moves']) == 8
    assert 'private' not in output.read_text()
    assert output.stat().st_mode & 0o777 == 0o600
    monkeypatch.setattr(program, 'execute', AsyncMock(side_effect=CYCLE*2))
    with pytest.raises(FileExistsError):
        await offline(SimpleNamespace(bundle=str(bundle), game=5, output=str(output)))
