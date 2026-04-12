import io
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import urllib.parse
import uuid

import numpy as np
import pytest

from util import (
    subprocess_fixture, 
    wait_until_port_available, 
    fixture, 
    file_upload
)


HARDCODED_HOST = 'http://localhost:5000'

HARDCODED_SAM3_ENCODER_URL = 'https://github.com/alexander-g/sam3-onnx/releases/download/v2026-03-13/sam3_image_encoder_full.onnx'
HARDCODED_SAM3_DECODER_URL = 'https://github.com/alexander-g/sam3-onnx/releases/download/v2026-03-13/sam3_decoder_with_box_feats.onnx'


@fixture
def test_sam3_basics0(subprocess_fixture:subprocess.Popen):
    assert subprocess_fixture.poll() is None
    time.sleep(3)
    assert subprocess_fixture.poll() is None

    wait_until_port_available('localhost', 5000, timeout=60)

    encoder_filename = os.path.basename(HARDCODED_SAM3_ENCODER_URL)
    decoder_filename = os.path.basename(HARDCODED_SAM3_DECODER_URL)
    samdir = 'models/sam'
    os.makedirs(samdir, exist_ok=True)
    encoder_path = f'{samdir}/{encoder_filename}'
    decoder_path = f'{samdir}/{decoder_filename}'

    if not os.path.exists( encoder_path ):
        with open(encoder_filename, "wb") as outf:
            with urllib.request.urlopen(HARDCODED_SAM3_ENCODER_URL) as response:
                outf.write(response.read())
    if not os.path.exists( decoder_path ):
        with open(decoder_filename, "wb") as outf:
            with urllib.request.urlopen(HARDCODED_SAM3_DECODER_URL) as response:
                outf.write(response.read())
    
    file_upload(f'{HARDCODED_HOST}/upload_model/sam/{encoder_filename}', encoder_filename)
    file_upload(f'{HARDCODED_HOST}/upload_model/sam/{decoder_filename}', decoder_filename)


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

    args = "?" + urllib.parse.urlencode({
        'box':[1570,811, 2180,1400],
        'displaywidth': 3000,
        'displayheight':4200,
        'full': 'false'
    })
    with urllib.request.urlopen(f'http://localhost:5000/sam3/{imagename}'+args) as response:
        assert response.status == 200

        flatmask = np.frombuffer(response.read(), dtype='uint8')
        assert len(flatmask) == 3000*4200

    
    args = "?" + urllib.parse.urlencode({
        #'box':[1570,811, 2180,1400],
        # bug:
        'box':[765.7696258253852,1523.5486831171647,931.8033749082906,1650.5174319881498],
        'displaywidth': 3000,
        'displayheight':4200,
        'full': 'true'
    })
    with urllib.request.urlopen(f'http://localhost:5000/sam3/{imagename}'+args) as response:
        assert response.status == 200

        flatmask = np.frombuffer(response.read(), dtype='uint8')
        assert len(flatmask) == 3000*4200



