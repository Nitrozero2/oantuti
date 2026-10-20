# Worker supervisor

Run `python worker.py`, or `./run_worker.sh`. The resident supervisor remains online
when the match-processing child is stopped from `/admin/workers`, so it can be started
again from the web UI. Judge0 and the machine itself are not managed by these controls.

The admin page supports start, pause/resume, graceful stop, immediate stop and changing
the concurrent match limit (1–64). Lowering the limit never cancels existing matches.
Immediate stop returns unfinished jobs to the queue without counting them as losses.
An individual Judge0 submission already executing may finish inside Judge0; its result
is discarded when the owning runtime is terminated.

## Multiple consoles

The default name is `default`, or `WORKER_ID` from `.env`. Opening the same worker from
another console, even another checkout, reports the existing supervisor PID and exits
before any recovery or network registration. To deliberately run two independent workers:

```bash
python worker.py --name alpha
python worker.py --name beta
```

The stable identity combines the hashed machine identity with the worker name. Each
supervisor and child runtime also has a fresh instance ID. Workers with different names
share Judge0 capacity; their concurrent limits add up. Their controls and leases are isolated.
Set `MACHINE_ID` only if the host has no stable machine ID or cloned machines share one.

## Persistence and recovery

Desired running/paused/stopped state and limits persist in Redis without a TTL. `MAX_CONCURRENT`
from `.env` is used only for the initial registration. Supervisor ownership expires after
15 seconds without a heartbeat. Commands are polled every 3 seconds; UI confirmation follows
the runtime acknowledgement. Redis/network failure stops processing before ownership expires;
the supervisor reconnects without accepting jobs under stale ownership.

Unexpected child crashes are retried up to three times within five minutes (1/5/15-second
minimum backoff). Afterwards, inspect the error and click Start. Manual stop never auto-restarts.
Local shutdown signals terminate the child and return its owned jobs; if Redis is unreachable,
the lease reaper recovers them later.

## systemd

Run the supervisor, not the private `--runtime` child:

```ini
[Service]
Type=simple
WorkingDirectory=/path/to/Oantuti/worker
EnvironmentFile=/path/to/Oantuti/worker/.env
ExecStart=/path/to/venv/bin/python worker.py --name default
Restart=on-failure
RestartSec=5
KillMode=mixed
TimeoutStopSec=20
```

Use a different service name and `--name` for each worker. Deploy backend first, then
frontend, then the worker files (`worker.py`, `supervisor.py`, `runtime.py`, `game_engine.py`).
Drain existing workers before replacing their supervisor process. The deploy script only
copies files; it no longer kills every Python worker on the remote host.

Existing old workers remain visible as read-only until upgraded. Legacy startup recovery
now only requeues expired leases; opening a second old console cannot steal live jobs.

## Adaptive rating

The runtime claims existing queued work before requesting another rating match.
The dispatcher returns `reason` and `retry_after_seconds` (5–60 seconds); network
errors back off for 15 seconds. Normal claim polling and supervisor heartbeats
continue independently. Idle capacity is expected when agents are stable, have
exhausted their daily budget, or have no eligible opponent. Pausing automatic
rating from `/admin/rating` does not pause workers or self-play validation.
