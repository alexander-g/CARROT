import os
import signal
import socket
import subprocess
import sys
import time

import pytest
import _pytest



DEFAULT_CMD = f"{sys.executable} -u main.py"
CMD = os.environ.get('CMD', default=DEFAULT_CMD).split(' ')

fixture = pytest.mark.parametrize(
    "subprocess_fixture",
    [ {"cmd":CMD} ],
    indirect=True
)



IS_WINDOWS = sys.platform.startswith("win")

def _terminate_posix(p):
    try:
        os.killpg(os.getpgid(p.pid), signal.SIGTERM)
        p.wait(timeout=3)
    except Exception:
        try:
            os.killpg(os.getpgid(p.pid), signal.SIGKILL)
            p.wait(timeout=2)
        except Exception:
            pass

def _terminate_windows(p):
    try:
        # send CTRL_BREAK_EVENT to the process group (graceful)
        p.send_signal(signal.CTRL_BREAK_EVENT) # type: ignore[attr-defined]
        p.wait(timeout=3)
    except Exception:
        try:
            p.terminate()  # forceful TerminateProcess
            p.wait(timeout=2)
        except Exception:
            pass

@pytest.fixture
def subprocess_fixture(request:_pytest.fixtures.SubRequest):
    cmd = request.param.get("cmd")
    shell = request.param.get("shell", False)
    cwd = request.param.get("cwd", None)
    env = request.param.get("env", None)

    if IS_WINDOWS:
        kw = {'creationflags':subprocess.CREATE_NEW_PROCESS_GROUP} # type: ignore
    else:
        kw = {'preexec_fn':os.setsid}


    p = subprocess.Popen(cmd, shell = shell, cwd = cwd, env = env, **kw)
    yield p
    # teardown: attempt graceful then forceful stop
    if IS_WINDOWS:
        _terminate_windows(p)
    else:
        _terminate_posix(p)



def wait_until_port_available(host:str, port:int, timeout=30, interval=1):
    deadline = time.time() + timeout
    while True:
        try:
            with socket.create_connection((host, port), timeout=interval):
                return True
        except OSError:
            if time.time() > deadline:
                raise TimeoutError(f"{host}:{port} not available after {timeout}s")
            time.sleep(interval)


