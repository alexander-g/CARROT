import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

import pytest

from util import subprocess_fixture, wait_until_port_available, fixture



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
    
    


