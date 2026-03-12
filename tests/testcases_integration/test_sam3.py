import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import urllib.parse
import uuid

import pytest

from util import subprocess_fixture, wait_until_port_available, fixture



@fixture
def test_sam3_basics0(subprocess_fixture:subprocess.Popen):
    assert subprocess_fixture.poll() is None
    time.sleep(3)
    assert subprocess_fixture.poll() is None

    wait_until_port_available('localhost', 5000, timeout=60)

    imagename = 'banana.jpg'
    try:
        with urllib.request.urlopen(f'http://localhost:5000/sam3/{imagename}') as response:
            # not ok because no file uploaded
            assert response.status != 200
    except urllib.error.HTTPError:
        # expected 
        pass

    
    HARDCODED_TEST_IMAGE = 'tests/testcases/assets/ELD_QURO_635A_3_crop.jpg'
    imagename = os.path.basename(HARDCODED_TEST_IMAGE)    

    file_upload('http://localhost:5000/file_upload', HARDCODED_TEST_IMAGE)

    args = "?" + urllib.parse.urlencode({'box':[1570,811, 2180,1400]})
    with urllib.request.urlopen(f'http://localhost:5000/sam3/{imagename}'+args) as response:
        assert response.status == 200



def file_upload(url:str, path:str):
    with open(path, "rb") as f:
        data = f.read()

    boundary = uuid.uuid4().hex
    crlf = "\r\n"
    filename = os.path.basename(path)

    part = (
        f"--{boundary}{crlf}"
        f'Content-Disposition: form-data; name="files"; filename="{filename}"{crlf}'
        f"Content-Type: application/octet-stream{crlf}{crlf}"
    ).encode() + data + f"{crlf}".encode()
    closing = f"--{boundary}--{crlf}".encode()
    body = part + closing

    request = urllib.request.Request(url, data=body, method="POST")
    request.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    request.add_header("Content-Length", str(len(body)))

    with urllib.request.urlopen(request) as response:
        assert response.status == 200




