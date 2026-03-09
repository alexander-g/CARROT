import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

import pytest

from util import subprocess_fixture


#DEFAULT_CMD = [sys.executable, "-u", "main.py"]
DEFAULT_CMD = f"{sys.executable} -u main.py"
CMD = os.environ.get('CMD', default=DEFAULT_CMD).split(' ')
print('CMD:', CMD)

fixture = pytest.mark.parametrize(
    "subprocess_fixture",
    [ {"cmd":CMD} ],
    indirect=True
)


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


@fixture
def test_process_basics0(subprocess_fixture:subprocess.Popen):
    assert subprocess_fixture.poll() is None
    time.sleep(3)
    assert subprocess_fixture.poll() is None

    wait_until_port_available('localhost', 5000, timeout=60)

    with urllib.request.urlopen('http://localhost:5000/') as response:
        responsedata = response.read()
        assert b'<html>' in responsedata
        assert b'CARROT' in responsedata
    
    with urllib.request.urlopen('http://localhost:5000/index.tsx.js') as response:
        responsedata = response.read()
        assert len(responsedata) > 10000
    
    


