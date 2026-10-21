"""python -m finals_runner [--concurrency 1] or --bundle FILE --game ID --output FILE."""
import argparse
import asyncio
import json
import logging
import os
import signal
from pathlib import Path
from .agent import execute
from .game import FinalsGame

log = logging.getLogger('finals')


async def offline(args):
    bundle = json.loads(Path(args.bundle).read_text())
    if bundle.get('format') != 'ott-finals-bundle-v1':
        raise ValueError('Unsupported bundle format')
    job = next(g for g in bundle['games'] if int(g['id']) == args.game)
    entrants = {int(e['seed']): e for e in bundle['entrants']}
    game = FinalsGame(bundle['edition']['rules']); moves = []
    while not game.outcome:
        seed = job['seed1'] if game.engine.state.current_turn == 1 else job['seed2']
        action = await execute(entrants[seed]['code'], game.observation(), game.rules)
        moves.append(game.step(action))
        log.info('Local game %s move %s', args.game, len(moves))
    record = {'format': 'ott-finals-record-v1', 'game_id': args.game, 'rules': game.rules,
              'agent1_hash': entrants[job['seed1']]['code_hash'], 'agent2_hash': entrants[job['seed2']]['code_hash'],
              'outcome': game.outcome, 'reason': game.reason, 'moves': moves}
    # Exclusive creation protects existing recordings. Bundles and records stay private on disk.
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(record, stream, ensure_ascii=False)


async def process(db, job):
    game = FinalsGame(job['rules'])
    current = asyncio.current_task()

    async def renewal():
        while True:
            await asyncio.sleep(5)
            try:
                if not await asyncio.to_thread(db.renew, job['attempt_id'], job['token']):
                    current.cancel(); return
            except Exception:
                current.cancel(); return

    renewing = asyncio.create_task(renewal())
    try:
        while not game.outcome:
            before = game.engine.state.move_count
            code = job['agent1_code'] if game.engine.state.current_turn == 1 else job['agent2_code']
            action = await execute(code, game.observation(), game.rules)
            move = game.step(action)
            ok = await asyncio.to_thread(db.step, job, before, move, game.snapshot(), game.outcome, game.reason)
            if not ok:
                raise RuntimeError('Execution fenced; move not committed')
            log.info('Game %s move %s committed', job['game_id'], before+1)
    except asyncio.CancelledError:
        try:
            await asyncio.to_thread(db.fail, job, 'Execution interrupted or lease lost; admin intervention required')
        except Exception:
            pass
        raise
    except Exception as error:
        log.error('Game %s needs admin: %s', job['game_id'], type(error).__name__)
        try:
            await asyncio.to_thread(db.fail, job, type(error).__name__+': '+str(error))
        except Exception:
            log.error('Could not save failure; expired lease will require admin intervention')
    finally:
        renewing.cancel(); await asyncio.gather(renewing, return_exceptions=True)


async def online(args):
    from .db import Database
    db = Database(); stop = asyncio.Event(); active = set()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    async def heartbeat():
        while not stop.is_set():
            try:
                await asyncio.to_thread(db.heartbeat, args.concurrency)
            except Exception:
                stop.set()
                for task in active:
                    task.cancel()
                raise
            await asyncio.sleep(5)
    await asyncio.to_thread(db.heartbeat, args.concurrency)
    heart = asyncio.create_task(heartbeat())
    try:
        while not stop.is_set():
            active = {task for task in active if not task.done()}
            if len(active) < args.concurrency:
                job = await asyncio.to_thread(db.claim)
                if job:
                    active.add(asyncio.create_task(process(db, job)))
                    continue
            try:
                await asyncio.wait_for(stop.wait(), timeout=1)
            except asyncio.TimeoutError:
                pass
    finally:
        heart.cancel()
        for task in active:
            task.cancel()
        await asyncio.gather(heart, *active, return_exceptions=True)
        try:
            await asyncio.to_thread(db.release)
        except Exception:
            log.warning('Could not release worker registration; its heartbeat will expire')
        await asyncio.to_thread(db.close)


def main():
    parser = argparse.ArgumentParser(description='Standalone SQL-only finals runner (never consumes rating jobs)')
    parser.add_argument('--concurrency', type=int, choices=range(1, 9), default=1)
    parser.add_argument('--bundle'); parser.add_argument('--game', type=int); parser.add_argument('--output')
    args = parser.parse_args()
    if args.bundle and (not args.game or not args.output):
        parser.error('--bundle requires --game and --output')
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(name)s %(message)s')
    asyncio.run(offline(args) if args.bundle else online(args))


if __name__ == '__main__':
    main()
