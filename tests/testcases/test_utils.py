from backend import util

import os
import tempfile

import PIL.Image
import numpy as np
import time



def test_get_jpg_size():
    tmpdir = tempfile.TemporaryDirectory()
    size   = np.random.randint(100,5000, size=[2])
    path   = os.path.join(tmpdir.name, 'image.jpg')
    image  = PIL.Image.fromarray((np.random.random(size[::-1]) * 255).astype('uint8'))
    image.save(path)
    
    t0 = time.time()
    result = util.get_jpg_size(path)
    t1 = time.time()

    print(result, size, t1-t0)
    assert result == tuple(size)


def test_get_png_size():
    tmpdir = tempfile.TemporaryDirectory()
    size   = np.random.randint(100,5000, size=[2])
    path   = os.path.join(tmpdir.name, 'image.png')
    image  = PIL.Image.fromarray((np.random.random(size[::-1]) * 255).astype('uint8'))
    image.save(path)
    
    t0 = time.time()
    result = util.get_png_size(path)
    t1 = time.time()

    print(result, size, t1-t0)
    assert result == tuple(size)


def test_get_tiff_size():
    tmpdir = tempfile.TemporaryDirectory()
    size   = np.random.randint(100,5000, size=[2])
    path   = os.path.join(tmpdir.name, 'image.tiff')
    image  = PIL.Image.fromarray((np.random.random(size[::-1]) * 255).astype('uint8'))
    #image.save(path)
    image.save(path)
    
    t0 = time.time()
    result = util.get_tiff_size(path)
    t1 = time.time()

    print(result, size, t1-t0)
    assert result == tuple(size)

def test_get_tiff_size_bigtiff():
    size = (58, 23)
    path = 'base/tests/testcases_deno/assets/bigtiff.tif'
    
    t0 = time.time()
    result = util.get_tiff_size(path)
    t1 = time.time()

    print(result, size, t1-t0)
    assert result == tuple(size)








if __name__ == '__main__':
    test_get_jpg_size()
    test_get_png_size()
    test_get_tiff_size()
    test_get_tiff_size_bigtiff()

