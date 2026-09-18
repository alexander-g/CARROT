#!/bin/python
import argparse
import datetime
import glob
import os
import shutil
import subprocess
import sys
import zipfile


if not 'win32' in sys.platform:
    print('ERROR: This build script currently only supports Windows')
    sys.exit(1)


parser = argparse.ArgumentParser()
parser.add_argument('--zip', action='store_true')
args = parser.parse_args()


os.environ['DO_NOT_RELOAD'] = 'true'
from backend.app import App
App().recompile_static(force=True)        #make sure the static/ folder is up to date

build_name = f'{datetime.datetime.now().strftime("%Y-%m-%d_%Hh%Mm%Ss")}_CARROT'
build_dir  = f'builds/{build_name}'

rc = subprocess.call(' '.join([
    #'pyi-makespec',
    'pyinstaller',
    '--noupx',
    '--hidden-import=sklearn.utils._cython_blas',
    '--hidden-import=skimage.io._plugins.tifffile_plugin',
    '--hidden-import=skimage.morphology',
    '--hidden-import=skimage.graph',
    '--hidden-import=skimage.graph.heap',
    '--hidden-import=torchvision',
    '--hidden-import=torchvision.models.feature_extraction',
    '--hidden-import=imagecodecs._imcd',
    '--hidden-import=traininglib',
    '--hidden-import=traininglib.unet',
    '--exclude-module=tkinter',
    '--hidden-import=ultralytics',
    f'--paths={os.path.abspath("carrot_ml/ultralytics/")}',
    '--exclude-module=_bootlocale',
    '--additional-hooks-dir=./hooks',
    '--icon=frontend/favicon.ico',
    f'--distpath={build_dir} ',
    'main.py',
]), shell=True)

if rc!=0:
    print(f'PyInstaller (main.py) exited with code {rc}')
    sys.exit(rc)

rc = subprocess.call(' '.join([
    #'pyi-makespec',
    'pyinstaller',
    '--exclude-module=_bootlocale',
    '--icon=frontend/favicon.ico',
    '--onefile',
    f'--distpath={build_dir} ',
    'wrapper.py',
]), shell=True)

if rc!=0:
    print(f'PyInstaller (wrapper.py) exited with code {rc}')
    sys.exit(rc)




shutil.copytree('static', build_dir+'/static')
os.makedirs(build_dir+'/models/')
shutil.copy('models/pretrained_models.txt', build_dir+'/models/')
shutil.copy(build_dir+'/wrapper/wrapper.exe', build_dir+'/CARROT.exe')
shutil.rmtree(build_dir+'/wrapper')


shutil.rmtree('./build')

print()
print(open('./main.spec').read())
print()
os.remove('./main.spec')

# cleanup
for folder in (
    glob.glob( os.path.join(build_dir, 'static', '*-*-*', '**', 'frontend'), recursive=True )
    + glob.glob( os.path.join(build_dir, '**', '__pycache__'), recursive=True )
    + glob.glob( os.path.join(build_dir, '**', 'ultralytics', 'assets'), recursive=True )
    + glob.glob( os.path.join(build_dir, '**', 'ultralytics', 'solutions'), recursive=True )
):
    print('Cleaning up: ', folder)
    shutil.rmtree(folder)


# ultralytics/docs/
# ultralytics/assets/
# ultralytics/examples/
# build/extracted/main/_internal/_tcl_data/


if args.zip:
    shutil.rmtree(build_dir+'/cache', ignore_errors=True)

    print('Zipping full package...')
    shutil.make_archive(build_dir, "zip", build_dir)

print('Done')
