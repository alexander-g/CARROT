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




import sys
sys.path.append('./')

from backend.sam import (
    find_suitable_grid,
    postprocess_sam3_masks,
)
from base.backend.processing import ImageSize

import numpy as np



def test_suitable_cropbox():
    cropbox0 = find_suitable_cropbox(
        imagesize = ImageSize(width=1600, height=1200),
        objectbox = (100,100,260,260),
        acceptable_fraction = (0.1, 0.2),
    )
    # full image
    assert cropbox0 == (0,0, 1600, 1200)


    cropbox1 = find_suitable_cropbox(
        imagesize = ImageSize(width=1600, height=1200),
        objectbox = (100,100,200,200),
        acceptable_fraction = (0.1, 0.2),
    )
    assert (np.array(cropbox1) >= 0).all()
    assert cropbox1[2] > cropbox1[0]
    assert cropbox1[3] > cropbox1[1]
    assert 0.1 <= 100/(cropbox1[2] - cropbox1[0]) <= 0.2
    assert 0.1 <= 100/(cropbox1[3] - cropbox1[1]) <= 0.2


def test_suitable_grid():
    grid0, best_cell0, slack = find_suitable_grid(
        imagesize = ImageSize(width=1600, height=1200),
        objectbox = (100,100,260,260),
        acceptable_fraction = (0.1, 0.2),
    )
    # full image
    assert grid0.shape == (1,1,4)
    #assert np.all(grid0[0,0] == (0,0,1600,1200))
    assert np.all(grid0[0,0] == (0,0,1200,1600))


    grid1, best_cell1, slack = find_suitable_grid(
        imagesize = ImageSize(width=1600, height=1200),
        objectbox = (100,100,200,200),
        acceptable_fraction = (0.1, 0.2),
    )
    assert (np.array(best_cell1) >= 0).all()
    assert best_cell1[2] > best_cell1[0]
    assert best_cell1[3] > best_cell1[1]
    assert 0.1 <= 100/(best_cell1[2] - best_cell1[0]) <= 0.2
    assert 0.1 <= 100/(best_cell1[3] - best_cell1[1]) <= 0.2


def test_postprocess_sam3_masks_filters_border_and_size():
    masks = np.zeros([3, 20, 20], dtype=bool)

    # valid object
    masks[0, 5:9, 5:9] = True
    # invalid: touches border
    masks[1, 0:4, 10:14] = True
    # invalid: too small
    masks[2, 14:15, 14:15] = True

    box = (0, 0, 4, 4)
    merged = postprocess_sam3_masks(masks, box)

    expected = np.zeros([20, 20], dtype=bool)
    expected[5:9, 5:9] = True

    assert merged.dtype == np.bool_
    assert np.array_equal(merged, expected)

