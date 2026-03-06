import os
import subprocess
import sys
import time
import urllib.request

import pytest

from util import subprocess_fixture


DEFAULT_CMD = [sys.executable, "-u", "main.py"]
CMD = os.environ.get('CMD', default=DEFAULT_CMD)

fixture = pytest.mark.parametrize(
    "subprocess_fixture",
    [ {"cmd":CMD} ],
    indirect=True
)

@fixture
def test_process_basics0(subprocess_fixture:subprocess.Popen):
    assert subprocess_fixture.poll() is None
    time.sleep(3)
    with urllib.request.urlopen('http://localhost:5000/') as response:
        responsedata = response.read()
        assert b'<html>' in responsedata
        assert b'CARROT' in responsedata
    
    with urllib.request.urlopen('http://localhost:5000/index.tsx.js') as response:
        responsedata = response.read()
        assert len(responsedata) > 10000
    
    


