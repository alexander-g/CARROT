#!/bin/python
import os, shutil, sys
import datetime


build_name = '%s_DigIT_WoodAnatomy'%(datetime.datetime.now().strftime('%Y%m%d_%Hh%Mm%Ss') )
build_dir  = 'builds/%s'%build_name

os.system(f'''pyinstaller --noupx                                 \
             --hidden-import=torchvision                          \
             --hidden-import=sklearn.utils._cython_blas           \
             --hidden-import=skimage.io._plugins.tifffile_plugin  \
             --additional-hooks-dir=./hooks                       \
             --distpath {build_dir} main.py''')


shutil.copytree('HTML',   build_dir+'/HTML')
shutil.copytree('models', build_dir+'/models')
shutil.copyfile('settings.json', build_dir+'/settings.json')

if 'linux' in sys.platform:
    os.symlink('main/main', build_dir+'/MAIN')
else:
    open(build_dir+'/main.bat', 'w').write(r'main\main.exe')

shutil.rmtree('./build')
os.remove('./main.spec')

#hiddenimport doesnt work; copying the whole folder
import torchvision
shutil.copytree(os.path.dirname(torchvision.__file__), build_dir+'/main/torchvision')

from PyInstaller.compat import is_win
if is_win:
    #scipy hook doesnt work
    import scipy
    scipy_dir = os.path.dirname(scipy.__file__)
    shutil.copytree(os.path.join(scipy_dir, '.libs'), build_dir+'/main/scipy/.libs')
