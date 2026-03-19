import io
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

import pytest

from util import subprocess_fixture, wait_until_port_available, file_upload


#DEFAULT_CMD = [sys.executable, "-u", "main.py"]
DEFAULT_CMD = f"{sys.executable} -u main.py"
CMD = os.environ.get('CMD', default=DEFAULT_CMD).split(' ')
print('CMD:', CMD)

fixture = pytest.mark.parametrize(
    "subprocess_fixture",
    [ {"cmd":CMD} ],
    indirect=True
)

HARDCODED_HOST = 'http://localhost:5000'




@fixture
def test_process_basics0(subprocess_fixture:subprocess.Popen):
    assert subprocess_fixture.poll() is None
    time.sleep(3)
    assert subprocess_fixture.poll() is None

    wait_until_port_available('localhost', 5000, timeout=60)

    with urllib.request.urlopen(f'{HARDCODED_HOST}/') as response:
        responsedata = response.read()
        assert b'<html>' in responsedata
        assert b'CARROT' in responsedata
    
    with urllib.request.urlopen(f'{HARDCODED_HOST}/index.tsx.js') as response:
        responsedata = response.read()
        assert len(responsedata) > 10000
    

    file_upload(f'{HARDCODED_HOST}/file_upload', 'tests/testcases/assets/ELD_QURO_635A_3_crop.jpg')

    args = "?" + urllib.parse.urlencode({
        'cells':     'true',
        'treerings': 'true',
        'displaywidth':  1000,
        'displayheight': 1500,
        'og_width' : 3016,
        'og_height': 4224,
        'px_per_um': 2.0,
    })
    with urllib.request.urlopen(f'{HARDCODED_HOST}/process/ELD_QURO_635A_3_crop.jpg'+args) as response:
        responsedata = response.read()
        
        buffer = io.BytesIO(responsedata)
        with zipfile.ZipFile(buffer) as z:
            files_in_zip = z.namelist()
            assert len(files_in_zip) > 0
